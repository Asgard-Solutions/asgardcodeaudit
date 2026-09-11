"""Bounded, read-only snapshot capture.

Permitted files are copied into an application-owned temporary directory OUTSIDE
every audited root, and it is those captured bytes that are later indexed — never
the live project directory. Nothing here executes target code, follows symlinks
out of a root, copies excluded/credential files, or mutates the source.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from ..config import Settings
from ..storage.models import Project, Snapshot, SnapshotFile
from .provenance import read_provenance
from .scope import CaptureLimits, Scope, resolve_scope, within_root


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass
class _Acc:
    included: list[dict] = field(default_factory=list)
    excluded: int = 0
    unreadable: int = 0
    total_bytes: int = 0
    limitations: list[str] = field(default_factory=list)
    result: str = "Complete"
    consistency: str = "consistent"


def _detect_encoding(data: bytes) -> str | None:
    """Return 'utf-8' for decodable text, else None (binary -> not captured)."""
    try:
        data.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError:
        return None


def _walk_root(root: Path, scope: Scope, dest: Path, acc: _Acc, limits: CaptureLimits) -> None:
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        cur = Path(dirpath)
        # Prune excluded directories in place (bounded: we never descend them).
        kept = []
        for d in dirnames:
            child = cur / d
            rel = child.relative_to(root).as_posix() + "/"
            if scope.spec.match_file(rel):
                acc.excluded += 1
                continue
            if child.is_symlink() and not within_root(root, child):
                acc.excluded += 1  # symlink dir escaping the root is refused
                continue
            kept.append(d)
        dirnames[:] = kept

        for name in filenames:
            src = cur / name
            rel = src.relative_to(root).as_posix()
            if scope.spec.match_file(rel):
                acc.excluded += 1
                continue
            # Enforce the root boundary at open time (symlink/junction escape).
            if not within_root(root, src):
                acc.excluded += 1
                continue
            if acc.result == "Partial":
                continue
            if len(acc.included) >= limits.max_files:
                acc.result = "Partial"
                acc.limitations.append(f"file count limit reached ({limits.max_files})")
                continue
            try:
                size = src.stat().st_size
            except OSError:
                acc.unreadable += 1
                continue
            if size > limits.max_file_bytes:
                acc.excluded += 1
                acc.limitations.append(f"oversized file skipped: {rel} ({size} bytes)")
                continue
            if acc.total_bytes + size > limits.max_total_bytes:
                acc.result = "Partial"
                acc.limitations.append(f"aggregate byte limit reached ({limits.max_total_bytes})")
                continue
            try:
                data = src.read_bytes()
            except OSError:
                acc.unreadable += 1
                continue
            enc = _detect_encoding(data)
            if enc is None:
                acc.excluded += 1  # binary content is not captured/indexed
                continue
            digest = _sha256(data)
            # Copy captured bytes into the app-owned snapshot dir (outside all roots).
            out = dest / _root_key(root) / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
            # Re-read the source after copy; a mid-capture change => inconsistent/Partial.
            try:
                after = _sha256(src.read_bytes())
            except OSError:
                after = None
            if after != digest:
                acc.consistency = "inconsistent"
                acc.result = "Partial"
                acc.limitations.append(f"source changed during capture: {rel}")
            acc.included.append(
                {"root": _root_key(root), "rel": rel, "size": size, "encoding": enc, "sha256": digest}
            )
            acc.total_bytes += size


def _root_key(root: Path) -> str:
    return hashlib.sha1(str(root).encode("utf-8")).hexdigest()[:12]


def capture_snapshot(
    db: Session, project: Project, settings: Settings, limits: CaptureLimits | None = None
) -> Snapshot:
    scope: Scope = resolve_scope(project, settings, limits)
    lim = scope.limits
    snap_id = os.urandom(16).hex()
    dest = settings.snapshots_dir / snap_id
    dest.mkdir(parents=True, exist_ok=True)

    started = _now()
    acc = _Acc()
    for root in scope.roots:
        _walk_root(root, scope, dest, acc, lim)

    prov = read_provenance(scope.roots[0]) if scope.roots else None

    snap = Snapshot(
        id=snap_id,
        project_id=project.id,
        consistency=acc.consistency,
        result=acc.result,
        roots=json.dumps([str(r) for r in scope.roots]),
        exclusions=json.dumps(scope.exclusions),
        limits=json.dumps(lim.as_dict()),
        included_count=len(acc.included),
        excluded_count=acc.excluded,
        unreadable_count=acc.unreadable,
        included_bytes=acc.total_bytes,
        limitations=json.dumps(acc.limitations),
        storage_path=str(dest),
        revision=(prov or {}).get("revision"),
        provenance=json.dumps(prov) if prov else None,
        capture_started_at=started,
        capture_finished_at=_now(),
    )
    db.add(snap)
    db.flush()
    for f in acc.included:
        db.add(
            SnapshotFile(
                snapshot_id=snap.id,
                rel_path=f"{f['root']}/{f['rel']}",
                size=f["size"],
                encoding=f["encoding"],
                sha256=f["sha256"],
                inclusion_reason="included",
            )
        )
    db.commit()
    db.refresh(snap)
    return snap


def cleanup_snapshot_bytes(snap: Snapshot) -> None:
    """Remove the raw captured bytes; the manifest/inventory rows persist."""
    p = Path(snap.storage_path)
    if p.exists():
        shutil.rmtree(p, ignore_errors=True)
