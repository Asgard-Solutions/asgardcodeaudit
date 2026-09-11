"""Optional, read-only local source-version provenance.

Uses a vetted absolute `git` executable with a sanitized environment. It only
reads the current revision/branch and modified-state; it never writes, contacts
a remote, inspects history, follows config to run helpers, or executes any
project-provided program. An ordinary (non-versioned) folder returns None and the
snapshot identity is used instead — no revision is fabricated.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

# Hardened, non-interactive, no-hook, no-pager environment.
_SAFE_ENV = {
    "GIT_TERMINAL_PROMPT": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "GIT_PAGER": "cat",
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_CONFIG_GLOBAL": "/dev/null",
    "HOME": "/dev/null",
    "PATH": "/usr/bin:/bin",
    "GIT_ALLOW_PROTOCOL": "",  # no network transports
    "LC_ALL": "C",
}


def _git_path() -> str | None:
    return shutil.which("git")


def _run(git: str, root: Path, args: list[str], timeout: float = 5.0) -> str | None:
    try:
        proc = subprocess.run(
            [git, "-C", str(root), "--no-pager", *args],
            capture_output=True, text=True, timeout=timeout, env=_SAFE_ENV, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    return proc.stdout.strip()


def read_provenance(root: Path) -> dict | None:
    git = _git_path()
    if git is None:
        return None
    inside = _run(git, root, ["rev-parse", "--is-inside-work-tree"])
    if inside != "true":
        return None
    revision = _run(git, root, ["rev-parse", "HEAD"])
    if not revision:
        return None
    branch = _run(git, root, ["rev-parse", "--abbrev-ref", "HEAD"])
    status = _run(git, root, ["status", "--porcelain"])
    return {
        "source": "git",
        "revision": revision,
        "branch": branch if branch and branch != "HEAD" else None,
        "modified": bool(status),
    }
