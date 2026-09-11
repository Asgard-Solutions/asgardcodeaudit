"""Approved capture scope resolution and per-open boundary enforcement.

Access is resolved from registered project records — never from an arbitrary
filesystem path supplied by the caller. Roots are canonicalized and validated,
and the root boundary is re-checked when each file is opened (not only at
selection time), so a symlink/junction cannot escape an approved root.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

import pathspec

from ..config import Settings
from ..projects.pathcheck import PathValidationError, canonicalize_root
from ..projects.service import DEFAULT_EXCLUSIONS
from ..storage.models import Project

# Credential-ish names always excluded from capture (never copied/indexed).
CREDENTIAL_PATTERNS = [
    "*.pem", "*.key", "*.pfx", "*.p12", "*.keystore", "id_rsa", "id_dsa",
    "id_ecdsa", "id_ed25519", "*.env", ".env", ".env.*", "*.crt", "*.cer",
]


@dataclass
class CaptureLimits:
    max_files: int = 50_000
    max_file_bytes: int = 2 * 1024 * 1024        # 2 MiB
    max_total_bytes: int = 250 * 1024 * 1024     # 250 MiB

    def as_dict(self) -> dict:
        return {
            "max_files": self.max_files,
            "max_file_bytes": self.max_file_bytes,
            "max_total_bytes": self.max_total_bytes,
        }


@dataclass
class Scope:
    roots: list[Path]
    exclusions: list[str]
    spec: pathspec.PathSpec = field(repr=False)
    limits: CaptureLimits


def _load_json_list(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        v = json.loads(raw)
        return [str(x) for x in v] if isinstance(v, list) else []
    except (ValueError, TypeError):
        return []


def resolve_scope(project: Project, settings: Settings, limits: CaptureLimits | None = None) -> Scope:
    """Resolve validated canonical roots + effective exclusions for a project.

    Raises PathValidationError if the primary root fails validation. Associated
    roots that fail validation are dropped (they cannot widen access).
    """
    roots: list[Path] = [canonicalize_root(project.root_path, settings.data_dir)]

    user_exclusions: list[str] = []
    if project.settings is not None:
        user_exclusions = _load_json_list(project.settings.exclusions)
        for extra in _load_json_list(project.settings.associated_roots):
            try:
                r = canonicalize_root(extra, settings.data_dir)
                if r not in roots:
                    roots.append(r)
            except PathValidationError:
                continue  # an unvalidated associated root cannot authorize access

    effective = list(dict.fromkeys([*DEFAULT_EXCLUSIONS, *CREDENTIAL_PATTERNS, *user_exclusions]))
    spec = pathspec.PathSpec.from_lines("gitignore", effective)
    return Scope(roots=roots, exclusions=effective, spec=spec, limits=limits or CaptureLimits())


def within_root(root: Path, path: Path) -> bool:
    """True only if realpath(path) stays inside realpath(root) — blocks symlink/junction escape."""
    try:
        real_root = Path(os.path.realpath(root))
        real = Path(os.path.realpath(path))
    except OSError:
        return False
    if real == real_root:
        return True
    return real_root in real.parents
