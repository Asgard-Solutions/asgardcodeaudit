"""ORM models for Phase 1 (projects + settings + app meta)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    root_path: Mapped[str] = mapped_column(Text, nullable=False)
    original_path: Mapped[str] = mapped_column(Text, nullable=False)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False, default="local")  # local|fixture
    fixture_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tags: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON array
    profile: Mapped[str] = mapped_column(String(40), nullable=False, default="standard-static")
    source_sharing_policy: Mapped[str] = mapped_column(String(20), nullable=False, default="offline")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")  # active|archived
    created_at: Mapped[str] = mapped_column(String(40), nullable=False, default=_now_iso)
    updated_at: Mapped[str] = mapped_column(String(40), nullable=False, default=_now_iso, onupdate=_now_iso)

    settings: Mapped["ProjectSettings"] = relationship(
        back_populates="project", cascade="all, delete-orphan", uselist=False
    )

    __table_args__ = (
        Index("ix_projects_root_path", "root_path"),
        Index("ix_projects_status", "status"),
        # At most one ACTIVE registration per canonical root (enforced in DB).
        Index(
            "uq_projects_active_root",
            "root_path",
            unique=True,
            sqlite_where=text("status = 'active'"),
        ),
    )


class ProjectSettings(Base):
    __tablename__ = "project_settings"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    exclusions: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON array
    associated_roots: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON array
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_at: Mapped[str] = mapped_column(String(40), nullable=False, default=_now_iso, onupdate=_now_iso)

    project: Mapped[Project] = relationship(back_populates="settings")


class AppMeta(Base):
    """Small key/value markers. Never used to reseed application data."""
    __tablename__ = "app_meta"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
