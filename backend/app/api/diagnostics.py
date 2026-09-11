from __future__ import annotations

import shutil

from fastapi import APIRouter, Depends

from ..build_info import build_identity
from ..config import get_settings
from ..security import require_session
from ..storage.db import sqlite_pragmas_report

# Unauthenticated startup handshake: readiness + build identity ONLY, no data.
public_router = APIRouter(prefix="/api/v1", tags=["startup"])

# Authenticated diagnostics/build/health.
router = APIRouter(prefix="/api/v1", tags=["diagnostics"], dependencies=[Depends(require_session)])


@public_router.get("/startup/handshake")
def startup_handshake():
    ident = build_identity()
    return {
        "status": "ready",
        "name": ident["name"],
        "version": ident["version"],
        "source_revision": ident["source_revision"],
        "mode": get_settings().mode,
    }


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/build")
def build():
    return build_identity()


def _credential_store_status() -> dict:
    # No OS credential store in the Linux preview container. Provider credentials
    # are a later phase; reported here honestly so nothing implies availability.
    return {
        "secret_tool": shutil.which("secret-tool") is not None,
        "gnome_keyring": shutil.which("gnome-keyring-daemon") is not None,
        "available": (shutil.which("secret-tool") is not None),
        "note": "Windows Credential Manager is the desktop target; provider "
                "credential persistence is out of Phase 1 scope (open gate G-5).",
    }


@router.get("/diagnostics")
def diagnostics():
    settings = get_settings()
    ident = build_identity()
    return {
        "build": ident,
        "mode": settings.mode,
        "storage": {
            "data_dir": str(settings.data_dir),
            "db_path": str(settings.db_path),
            "sqlite": sqlite_pragmas_report(),
        },
        "credential_store": _credential_store_status(),
        "optional_scanners": {
            "gitleaks": {"installed": shutil.which("gitleaks") is not None, "status": "not_configured"},
            "osv_scanner": {"installed": shutil.which("osv-scanner") is not None, "status": "not_configured"},
        },
        "preview_limitations": (
            [
                "Native folder picker unavailable — registration restricted to synthetic fixtures.",
                "No OS credential store — provider credential persistence unavailable (out of Phase 1 scope).",
                "Cannot reach the private LAN AI Server; no LM Studio/OpenAI in this phase.",
                "This preview does not verify the Windows installer or native desktop gates.",
            ]
            if settings.is_preview
            else []
        ),
    }
