from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from ..config import get_settings
from ..security.auth import issue_dev_token

# Development-only handshake for the browser preview. Returns 404 in desktop mode.
router = APIRouter(prefix="/api/v1", tags=["dev"])


def _forwarded_proto(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-proto")
    if fwd:
        return fwd.split(",")[0].strip().lower()
    return request.url.scheme


def _reject_foreign_origin(request: Request, settings) -> None:
    """Issue a token only for a same-origin or explicitly approved origin.

    A cross-site page (including an unapproved sibling on the same hosting
    domain) must not obtain a working session token. Requests without an Origin
    header are permitted as documented non-browser / same-origin GET access; an
    Origin header is not treated as user authentication.
    """
    origin = request.headers.get("origin")
    host = request.headers.get("host")
    if not settings.origin_allowed(origin, host, _forwarded_proto(request)):
        raise HTTPException(status_code=403, detail="Origin not allowed")


@router.post("/dev/session")
def dev_session(request: Request):
    settings = get_settings()
    if not settings.is_preview:
        raise HTTPException(status_code=404, detail="Not found")
    _reject_foreign_origin(request, settings)
    token = issue_dev_token()
    return {"token": token, "mode": settings.mode}
