"""Approved synthetic preview fixtures.

In preview mode the native folder picker is unavailable, so registration is
restricted to these clearly-labeled synthetic repositories. They are real
directories on disk that the backend actually reads (no fabricated data). They
are NOT the user's machine and do not stand in for the Windows native picker.
"""
from __future__ import annotations

from pathlib import Path

FIXTURES_ROOT = Path(__file__).resolve().parent.parent / "fixtures_data"

_FIXTURES = [
    {
        "id": "py-fastapi-sample",
        "label": "Synthetic: Python / FastAPI service",
        "description": "Small FastAPI project fixture (manifests + a couple of modules).",
    },
    {
        "id": "js-react-sample",
        "label": "Synthetic: JavaScript / React app",
        "description": "Small React app fixture (package.json + source).",
    },
]


def list_fixtures() -> list[dict]:
    out = []
    for f in _FIXTURES:
        path = FIXTURES_ROOT / f["id"]
        out.append({**f, "path": str(path), "available": path.is_dir()})
    return out


def resolve_fixture(fixture_id: str) -> Path | None:
    for f in _FIXTURES:
        if f["id"] == fixture_id:
            path = FIXTURES_ROOT / fixture_id
            return path if path.is_dir() else None
    return None
