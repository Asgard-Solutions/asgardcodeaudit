"""Single application-metadata module.

The working name lives here so it can be changed without a structural rewrite
(spec: keep the name in one application-metadata module).
"""
from __future__ import annotations

import os
import platform
import sqlite3
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

APP_NAME = "Asgard CodeAudit"
APP_VERSION = "0.1.0-phase1"
SCHEMA_VERSION = "0001"

_REPO_ROOT = Path(__file__).resolve().parents[2]


def _git(*args: str) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(_REPO_ROOT), *args],
            capture_output=True,
            text=True,
            timeout=5,
            env={"PATH": os.environ.get("PATH", ""), "GIT_TERMINAL_PROMPT": "0"},
        )
        if out.returncode == 0:
            return out.stdout.strip()
    except Exception:
        return None
    return None


@lru_cache(maxsize=1)
def build_identity() -> dict:
    rev = _git("rev-parse", "--short", "HEAD")
    dirty = None
    status = _git("status", "--porcelain")
    if status is not None:
        dirty = bool(status.strip())
    return {
        "name": APP_NAME,
        "version": APP_VERSION,
        "schema_version": SCHEMA_VERSION,
        "source_revision": rev,
        "source_dirty": dirty,
        "python_version": sys.version.split()[0],
        "python_implementation": platform.python_implementation(),
        "sqlite_runtime": sqlite3.sqlite_version,
        "platform": platform.platform(),
        "arch": platform.machine(),
    }
