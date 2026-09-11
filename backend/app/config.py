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
from dotenv import load_dotenv

# Load backend/.env so deployment config (e.g. ASGARD_PREVIEW_ORIGINS) is present.
# Existing process env (and test monkeypatches) take precedence (override=False).
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

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

        # Allowed browser origins for the preview harness (comma-separated).
        # In desktop mode the renderer uses IPC, so this is empty/ignored.
        self.preview_origins = [
            o.strip()
            for o in os.environ.get("ASGARD_PREVIEW_ORIGINS", "").split(",")
            if o.strip()
        ]
        # Trusted hostname suffixes for the platform preview domain. A same-origin
        # request or a request from these controlled domains may obtain a dev
        # session token; genuinely foreign sites are rejected.
        self.preview_origin_suffixes = [
            s.strip()
            for s in os.environ.get(
                "ASGARD_PREVIEW_ORIGIN_SUFFIXES", "preview.emergentagent.com"
            ).split(",")
            if s.strip()
        ]

    def origin_allowed(self, origin: str | None, host_header: str | None) -> bool:
        from urllib.parse import urlparse

        if origin is None:
            return True  # non-browser / same-origin GET without an Origin header
        host = (urlparse(origin).hostname or "").lower()
        if origin in self.preview_origins:
            return True
        if host in ("localhost", "127.0.0.1"):
            return True
        if host_header:
            if host == host_header.split(":")[0].lower():
                return True  # same-origin
        for suf in self.preview_origin_suffixes:
            if host == suf or host.endswith("." + suf):
                return True
        return False

    def cors_origin_regex(self) -> str | None:
        parts = []
        for suf in self.preview_origin_suffixes:
            esc = suf.replace(".", r"\.")
            parts.append(rf"https?://([a-z0-9-]+\.)*{esc}(:\d+)?")
        parts.append(r"http://localhost(:\d+)?")
        parts.append(r"http://127\.0\.0\.1(:\d+)?")
        return "^(" + "|".join(parts) + ")$" if parts else None

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
