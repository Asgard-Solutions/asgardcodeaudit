"""Single-instance ownership of the app-data directory (F09).

Uses an exclusive advisory file lock. On desktop the Electron main process ALSO
holds an OS single-instance lock; this backend lock guarantees that only one
backend can own a given app-data directory. Verified on Linux (preview);
Windows native single-instance remains an open gate (G-2).
"""
from __future__ import annotations

from pathlib import Path

try:
    import fcntl  # POSIX
    _HAVE_FCNTL = True
except Exception:  # pragma: no cover - Windows
    _HAVE_FCNTL = False

try:
    import msvcrt  # Windows
    _HAVE_MSVCRT = True
except Exception:
    _HAVE_MSVCRT = False


class SingleInstanceError(RuntimeError):
    pass


class SingleInstanceLock:
    def __init__(self, lock_path: Path) -> None:
        self.lock_path = Path(lock_path)
        self._fh = None

    def acquire(self) -> "SingleInstanceLock":
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = open(self.lock_path, "a+")
        try:
            if _HAVE_FCNTL:
                fcntl.flock(self._fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            elif _HAVE_MSVCRT:  # pragma: no cover - Windows path
                msvcrt.locking(self._fh.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError as exc:
            self._fh.close()
            self._fh = None
            raise SingleInstanceError(
                f"Another instance already owns {self.lock_path}"
            ) from exc
        return self

    def release(self) -> None:
        if self._fh is not None:
            try:
                if _HAVE_FCNTL:
                    fcntl.flock(self._fh.fileno(), fcntl.LOCK_UN)
                elif _HAVE_MSVCRT:  # pragma: no cover
                    msvcrt.locking(self._fh.fileno(), msvcrt.LK_UNLCK, 1)
            finally:
                self._fh.close()
                self._fh = None

    def __enter__(self):
        return self.acquire()

    def __exit__(self, *_exc):
        self.release()


def acquire_single_instance_lock(lock_path: Path) -> SingleInstanceLock:
    return SingleInstanceLock(lock_path).acquire()
