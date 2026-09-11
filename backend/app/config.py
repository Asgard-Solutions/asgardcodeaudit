"""Runtime configuration and mode selection.

Mode is either 'preview' (browser dev harness behind the platform ingress) or
'desktop' (Electron-owned loopback backend). Business logic is identical; only
transport/registration boundaries differ.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import platformdirs

APP_DIR_NAME = "AsgardCodeAudit"


class Settings:
    def __init__(self) -> None:
        self.mode: str = os.environ.get("ASGARD_MODE", "preview").strip().lower()
        if self.mode not in ("preview", "desktop"):
            self.mode = "preview"

        override = os.environ.get("ASGARD_DATA_DIR")
        if override:
            self.data_dir = Path(override).expanduser().resolve()
        else:
            self.data_dir = Path(platformdirs.user_data_dir(APP_DIR_NAME, appauthor=False)).resolve()

    @property
    def is_desktop(self) -> bool:
        return self.mode == "desktop"

    @property
    def is_preview(self) -> bool:
        return self.mode == "preview"

    @property
    def db_dir(self) -> Path:
        return self.data_dir / "db"

    @property
    def db_path(self) -> Path:
        return self.db_dir / "audit.sqlite3"

    @property
    def db_url(self) -> str:
        return f"sqlite:///{self.db_path}"

    @property
    def snapshots_dir(self) -> Path:
        return self.data_dir / "snapshots"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    @property
    def exports_dir(self) -> Path:
        return self.data_dir / "exports"

    @property
    def lock_path(self) -> Path:
        return self.data_dir / "instance.lock"

    def ensure_dirs(self) -> None:
        for d in (self.data_dir, self.db_dir, self.snapshots_dir, self.logs_dir, self.exports_dir):
            d.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
