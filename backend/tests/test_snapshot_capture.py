"""Phase 2 Increment 1: safe snapshot capture + scope + provenance.

Covers acceptance items exercisable in this Linux env: D04 (provenance/ordinary
folder), D05 (source unchanged), D06 (symlink escape), D07 (changing file ->
inconsistent/Partial), D08 (excluded/oversized/limit -> Partial), D12 (target
config not executed). Native Windows D09 stays open.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from app.config import get_settings
from app.inventory import capture as capmod
from app.inventory.capture import capture_snapshot
from app.inventory.scope import CaptureLimits, within_root
from app.storage.db import Base, engine_for
from app.storage.models import Project, ProjectSettings, SnapshotFile


def _sha_tree(root: Path) -> dict[str, str]:
    out = {}
    for p in sorted(root.rglob("*")):
        if p.is_file() and not p.is_symlink():
            out[str(p.relative_to(root))] = hashlib.sha256(p.read_bytes()).hexdigest()
    return out


@pytest.fixture()
def env(tmp_path, monkeypatch):
    data_dir = tmp_path / "appdata"
    src = tmp_path / "src"
    src.mkdir()
    monkeypatch.setenv("ASGARD_MODE", "desktop")
    monkeypatch.setenv("ASGARD_DATA_DIR", str(data_dir))
    get_settings.cache_clear()
    settings = get_settings()
    settings.ensure_dirs()
    engine = engine_for(f"sqlite:///{tmp_path / 't.sqlite3'}")
    Base.metadata.create_all(engine)
    db = Session(engine)

    def make_project(exclusions=None, associated=None) -> Project:
        p = Project(
            name="P", root_path=str(src.resolve()), original_path=str(src),
            source_type="local", profile="standard-static", source_sharing_policy="offline", status="active",
        )
        p.settings = ProjectSettings(
            exclusions=json.dumps(exclusions or []),
            associated_roots=json.dumps(associated or []),
        )
        db.add(p)
        db.commit()
        db.refresh(p)
        return p

    yield {"settings": settings, "db": db, "src": src, "make_project": make_project, "data_dir": data_dir}
    db.close()
    get_settings.cache_clear()


def test_capture_hashes_and_source_unmutated_and_no_execution(env):
    src: Path = env["src"]
    (src / "app.py").write_text("x = 1\n")
    (src / "pkg").mkdir()
    (src / "pkg" / "mod.py").write_text("y = 2\n")
    # D12 tripwire: a setup/build script that WOULD create a marker if executed.
    (src / "setup.py").write_text("open('EXECUTED_MARKER','w').write('ran')\n")
    (src / "package.json").write_text('{"scripts": {"postinstall": "touch EXECUTED_MARKER"}}')

    before = _sha_tree(src)
    snap = capture_snapshot(env["db"], env["make_project"](), env["settings"])

    assert snap.result == "Complete"
    assert snap.consistency == "consistent"
    assert snap.included_count >= 4  # app.py, mod.py, setup.py, package.json
    # captured bytes live OUTSIDE the source root, under app data
    assert str(env["data_dir"]) in snap.storage_path
    assert not str(env["src"]) in snap.storage_path.replace(str(env["data_dir"]), "")
    # D05: source unchanged; D12: nothing executed
    assert _sha_tree(src) == before
    assert not (src / "EXECUTED_MARKER").exists()
    assert not Path("EXECUTED_MARKER").exists()
    files = env["db"].query(SnapshotFile).filter_by(snapshot_id=snap.id).all()
    assert all(len(f.sha256) == 64 for f in files)


def test_symlink_escape_not_captured(env):
    src: Path = env["src"]
    (src / "real.py").write_text("ok\n")
    secret_dir = env["data_dir"].parent / "outside"
    secret_dir.mkdir()
    (secret_dir / "secret.txt").write_text("TOP SECRET\n")
    try:
        os.symlink(secret_dir / "secret.txt", src / "link.txt")
        os.symlink(secret_dir, src / "linkdir")
    except OSError:
        pytest.skip("symlinks unsupported on this platform")

    snap = capture_snapshot(env["db"], env["make_project"](), env["settings"])
    rels = {f.rel_path for f in env["db"].query(SnapshotFile).filter_by(snapshot_id=snap.id).all()}
    assert not any("secret" in r for r in rels)
    # nothing containing the secret content was copied into the snapshot store
    for p in Path(snap.storage_path).rglob("*"):
        if p.is_file():
            assert "TOP SECRET" not in p.read_text(errors="ignore")
    assert within_root(src, src / "real.py") is True
    assert within_root(src, src / "link.txt") is False


def test_excluded_credentials_and_oversized(env):
    src: Path = env["src"]
    (src / "keep.py").write_text("a\n")
    (src / ".env").write_text("SECRET=zzz\n")            # credential -> excluded
    (src / "node_modules").mkdir()
    (src / "node_modules" / "dep.js").write_text("//dep\n")  # default-excluded dir
    (src / "big.py").write_text("#" * 5000 + "\n")       # oversized under tiny limit

    snap = capture_snapshot(
        env["db"], env["make_project"](), env["settings"], CaptureLimits(max_file_bytes=1000)
    )
    rels = {f.rel_path.split("/", 1)[1] for f in env["db"].query(SnapshotFile).filter_by(snapshot_id=snap.id).all()}
    assert "keep.py" in rels
    assert ".env" not in rels
    assert "node_modules/dep.js" not in rels
    assert "big.py" not in rels
    assert snap.excluded_count >= 1
    assert any("oversized" in x for x in json.loads(snap.limitations))


def test_aggregate_limit_yields_partial(env):
    src: Path = env["src"]
    for i in range(5):
        (src / f"f{i}.py").write_text("z" * 500 + "\n")
    snap = capture_snapshot(
        env["db"], env["make_project"](), env["settings"], CaptureLimits(max_total_bytes=800)
    )
    assert snap.result == "Partial"
    assert any("aggregate" in x for x in json.loads(snap.limitations))


def test_changing_file_marks_inconsistent_partial(env, monkeypatch):
    src: Path = env["src"]
    (src / "a.py").write_text("original\n")
    calls = {"n": 0}
    real = capmod._sha256

    def flaky(data):
        calls["n"] += 1
        # second call (post-copy re-read) returns a different digest => mid-capture change
        return real(data) if calls["n"] == 1 else real(data + b"changed")

    monkeypatch.setattr(capmod, "_sha256", flaky)
    snap = capture_snapshot(env["db"], env["make_project"](), env["settings"])
    assert snap.consistency == "inconsistent"
    assert snap.result == "Partial"
    assert any("changed during capture" in x for x in json.loads(snap.limitations))


def test_ordinary_folder_has_no_fabricated_revision(env):
    (env["src"] / "a.py").write_text("a\n")
    snap = capture_snapshot(env["db"], env["make_project"](), env["settings"])
    assert snap.revision is None
    assert snap.provenance is None
