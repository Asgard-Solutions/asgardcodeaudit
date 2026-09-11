from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from ..config import get_settings
from ..security.auth import issue_dev_token

# Development-only handshake for the browser preview. Returns 404 in desktop mode.
router = APIRouter(prefix="/api/v1", tags=["dev"])


@router.post("/dev/session")
def dev_session(_request: Request):
    settings = get_settings()
    if not settings.is_preview:
        raise HTTPException(status_code=404, detail="Not found")
    token = issue_dev_token()
    return {"token": token, "mode": settings.mode}
