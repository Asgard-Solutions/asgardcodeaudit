"""F09 evidence (backend part): single-instance lock on the app-data directory.

Verified on Linux (preview). Windows-native single-instance (Electron
app.requestSingleInstanceLock) remains open gate G-2.
"""
import pytest

from app.storage.lock import (
    SingleInstanceError,
    SingleInstanceLock,
    acquire_single_instance_lock,
)


def test_second_owner_is_rejected(tmp_path):
    lock_path = tmp_path / "instance.lock"
    first = acquire_single_instance_lock(lock_path)
    try:
        with pytest.raises(SingleInstanceError):
            SingleInstanceLock(lock_path).acquire()
    finally:
        first.release()

    # After release, a new owner can acquire it.
    second = acquire_single_instance_lock(lock_path)
    second.release()
