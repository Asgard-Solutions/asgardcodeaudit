"""SQLite engine with the Phase 1 pragmas.

Phase 1 uses rollback-journal (DELETE) mode. Evidence (see docs/DECISIONS.md
C-5): the preview *service* runs on Python 3.11 which bundles SQLite 3.40.1
(2022-12-28), which predates several WAL hardening fixes. WAL is deferred until
the actually packaged SQLite version is validated against upstream advisories.
Do NOT infer the SQLite patch level from the Python version.
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from ..config import get_settings

# Phase 1 pragma choices.
JOURNAL_MODE = "DELETE"      # rollback journal (not WAL) — see C-5
SYNCHRONOUS = "FULL"
BUSY_TIMEOUT_MS = 5000


class Base(DeclarativeBase):
    pass


def _apply_pragmas(dbapi_connection, _connection_record) -> None:
    cur = dbapi_connection.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute(f"PRAGMA journal_mode={JOURNAL_MODE}")
    cur.execute(f"PRAGMA synchronous={SYNCHRONOUS}")
    cur.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
    cur.close()


def engine_for(db_url: str) -> Engine:
    # check_same_thread=False because FastAPI serves sync endpoints from a
    # threadpool; writes are still serialized by SQLite + a single worker.
    eng = create_engine(
        db_url,
        connect_args={"check_same_thread": False},
        future=True,
    )
    event.listen(eng, "connect", _apply_pragmas)
    return eng


_engine: Engine | None = None
_SessionLocal: sessionmaker | None = None


def get_engine() -> Engine:
    global _engine, _SessionLocal
    if _engine is None:
        settings = get_settings()
        settings.ensure_dirs()
        _engine = engine_for(settings.db_url)
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False, class_=Session)
    return _engine


def _session_factory() -> sessionmaker:
    if _SessionLocal is None:
        get_engine()
    assert _SessionLocal is not None
    return _SessionLocal


def get_session() -> Iterator[Session]:
    """FastAPI dependency."""
    db = _session_factory()()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    db = _session_factory()()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def sqlite_pragmas_report(engine: Engine | None = None) -> dict:
    eng = engine or get_engine()
    with eng.connect() as conn:
        def scalar(sql: str):
            return conn.exec_driver_sql(sql).scalar()
        return {
            "journal_mode": scalar("PRAGMA journal_mode"),
            "foreign_keys": bool(scalar("PRAGMA foreign_keys")),
            "synchronous": scalar("PRAGMA synchronous"),
            "busy_timeout_ms": scalar("PRAGMA busy_timeout"),
        }
