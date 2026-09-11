"""Local-instance session authentication (adapted from the integration playbook).

Authenticates the application instance, not a user. One random per-launch bearer
secret kept in memory only. No JWT, OAuth, user DB, provider credentials, or
Universal Key. A missing OS credential store never weakens this auth; the secret
is mandatory. Comparison is constant-time (hmac.compare_digest).
"""
from __future__ import annotations

import hmac
import json
import secrets
import sys
from collections import deque

_desktop_secret: bytes | None = None
_dev_tokens: deque[bytes] = deque(maxlen=32)  # bounded set of issued preview tokens


def set_desktop_secret(secret: str | bytes) -> None:
    global _desktop_secret
    raw = secret.encode("ascii") if isinstance(secret, str) else secret
    if len(raw) < 32:
        raise ValueError("session secret too short")
    _desktop_secret = raw


def read_desktop_secret_from_stdin() -> None:
    """Desktop mode: read one newline-delimited JSON startup message from stdin.

    Expected: {"mode": "desktop", "session_secret": "<>=32 chars>"}
    The secret is never taken from argv, URL, env, logs, or a config file.
    """
    line = sys.stdin.buffer.readline(8192)
    if not line:
        raise RuntimeError("missing private startup message on stdin")
    try:
        msg = json.loads(line)
        secret = msg["session_secret"]
        mode = msg["mode"]
    except (ValueError, KeyError, TypeError) as exc:
        raise RuntimeError("invalid startup message") from exc
    if mode != "desktop" or not isinstance(secret, str):
        raise RuntimeError("invalid startup mode or secret")
    set_desktop_secret(secret)


def has_desktop_secret() -> bool:
    return _desktop_secret is not None


def issue_dev_token() -> str:
    """Preview mode only: mint an in-memory browser session token."""
    token = secrets.token_urlsafe(32).encode("ascii")
    _dev_tokens.append(token)
    return token.decode("ascii")


def _matches(candidate: bytes) -> bool:
    ok = False
    if _desktop_secret is not None and hmac.compare_digest(candidate, _desktop_secret):
        ok = True
    for tok in _dev_tokens:
        if hmac.compare_digest(candidate, tok):
            ok = True
    return ok


def verify_authorization(authorization: str | None) -> bool:
    if not authorization or not authorization.startswith("Bearer "):
        return False
    candidate = authorization[7:].encode("ascii", errors="ignore")
    if not candidate:
        return False
    return _matches(candidate)


def reset_for_tests() -> None:
    global _desktop_secret
    _desktop_secret = None
    _dev_tokens.clear()
