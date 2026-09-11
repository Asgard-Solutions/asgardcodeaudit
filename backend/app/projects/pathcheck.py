"""Canonical source-root validation.

Read-only: nothing here mutates the audited source. Registration only records a
canonicalized path; the folder itself is never modified or deleted.
"""
from __future__ import annotations

import os
from pathlib import Path


class PathValidationError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _is_special(path: Path) -> bool:
    # Reject device/special filesystem locations on POSIX.
    bad_prefixes = ("/proc", "/sys", "/dev")
    s = str(path)
    return any(s == p or s.startswith(p + "/") for p in bad_prefixes)


def canonicalize_root(raw_path: str, app_data_dir: Path) -> Path:
    """Return the canonical directory for a candidate source root, or raise.

    Enforces: existence, is-a-directory, no traversal escapes (via realpath),
    no special/device paths, and separation from the application-data directory
    (F07) in both directions.
    """
    if not raw_path or not str(raw_path).strip():
        raise PathValidationError("empty", "A folder path is required.")

    candidate = Path(str(raw_path)).expanduser()
    try:
        real = Path(os.path.realpath(candidate))
    except OSError as exc:
        raise PathValidationError("invalid", f"Path could not be resolved: {exc}") from exc

    if not real.exists():
        raise PathValidationError("not_found", "That folder does not exist or is not accessible.")
    if not real.is_dir():
        raise PathValidationError("not_a_directory", "The selected path is not a directory.")
    if _is_special(real):
        raise PathValidationError("special_path", "Special/device paths cannot be registered.")

    app_real = Path(os.path.realpath(app_data_dir))
    if real == app_real:
        raise PathValidationError("overlaps_app_data", "This is the application-data directory.")
    if app_real in real.parents:
        raise PathValidationError(
            "overlaps_app_data", "The folder is inside the application-data directory."
        )
    if real in app_real.parents:
        raise PathValidationError(
            "overlaps_app_data", "The folder would contain the application-data directory."
        )
    return real
