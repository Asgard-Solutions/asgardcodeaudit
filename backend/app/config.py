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
        raw_mode = os.environ.get("ASGARD_MODE")
        if raw_mode is None:
            self.mode = "preview"  # default only when UNSET
        else:
            m = raw_mode.strip().lower()
            if m not in ("preview", "desktop"):
                raise ValueError(
                    f"Invalid ASGARD_MODE {raw_mode!r}; expected 'preview' or 'desktop'. "
                    "A desktop launch must not silently become a preview service."
                )
            self.mode = m

        override = os.environ.get("ASGARD_DATA_DIR")
        if override:
            self.data_dir = Path(override).expanduser().resolve()
        else:
            self.data_dir = Path(platformdirs.user_data_dir(APP_DIR_NAME, appauthor=False)).resolve()

        # Explicitly approved deployment origins (exact scheme://host[:port]),
        # comma-separated. No hosting-domain suffix wildcard and no blanket
        # localhost: a token is issued only to an approved origin or to a genuine
        # same-origin request (Origin tuple == this deployment's own origin).
        self.preview_origins = [
            o.strip().rstrip("/")
            for o in os.environ.get("ASGARD_PREVIEW_ORIGINS", "").split(",")
            if o.strip()
        ]

    def origin_allowed(self, origin: str | None, host_header: str | None, proto: str | None) -> bool:
        # No Origin header => not a cross-site browser request (documented
        # non-browser / same-origin GET access). An Origin header is never
        # treated as user authentication.
        if origin is None:
            return True
        origin = origin.rstrip("/")
        if origin in self.preview_origins:
            return True
        # Same-origin: the request's own origin, reconstructed from the
        # (ingress-forwarded) scheme + Host, must match the Origin tuple exactly.
        if host_header:
            own = f"{(proto or 'https').lower()}://{host_header}".rstrip("/")
            if origin == own:
                return True
        return False

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
