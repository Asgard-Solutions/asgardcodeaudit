"""Preview-harness entrypoint for the platform supervisor.

The supervisor runs `uvicorn server:app` in /app/backend. The real application
lives in the `app` package (which maps to apps/backend/app in the deliverable
repo). This thin shim exposes it unchanged so preview and desktop run identical
business logic, API schema, and SQLite persistence.
"""
from app.main import app  # noqa: F401
