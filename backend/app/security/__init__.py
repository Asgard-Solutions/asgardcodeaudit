from fastapi import Depends, Header, HTTPException, status

from .auth import verify_authorization

__all__ = ["require_session", "verify_authorization"]


async def require_session(authorization: str | None = Header(default=None)) -> None:
    if not verify_authorization(authorization):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing session",
            headers={"WWW-Authenticate": "Bearer"},
        )
