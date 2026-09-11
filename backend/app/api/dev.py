from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from ..config import get_settings
from ..security.auth import issue_dev_token

# Development-only handshake for the browser preview. Returns 404 in desktop mode.
router = APIRouter(prefix="/api/v1", tags=["dev"])


def _reject_foreign_origin(request: Request, settings) -> None:
    """Only mint a browser token for a same-origin or trusted platform origin.

    A cross-site page must not be able to obtain a working session token.
    Requests without an Origin (same-origin GET, local tooling) are permitted.
    """
    origin = request.headers.get("origin")
    host = request.headers.get("host")
    if not settings.origin_allowed(origin, host):
        raise HTTPException(status_code=403, detail="Origin not allowed")


@router.post("/dev/session")
def dev_session(request: Request):
    settings = get_settings()
    if not settings.is_preview:
        raise HTTPException(status_code=404, detail="Not found")
    _reject_foreign_origin(request, settings)
    token = issue_dev_token()
    return {"token": token, "mode": settings.mode}
