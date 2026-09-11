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


# --- Phase 2: safe snapshot + real inventory -------------------------------


class ProjectComponent(Base):
    """A component boundary discovered from actual manifests within approved roots."""
    __tablename__ = "project_components"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(32), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    root_rel: Mapped[str] = mapped_column(Text, nullable=False)  # rel path of the component root
    kind: Mapped[str] = mapped_column(String(40), nullable=False)  # python|node|dotnet|...
    manifest_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence: Mapped[str] = mapped_column(Text, nullable=False, default="{}")  # JSON
    created_at: Mapped[str] = mapped_column(String(40), nullable=False, default=_now_iso)

    __table_args__ = (Index("ix_project_components_project", "project_id"),)


class Snapshot(Base):
    """An application-owned point-in-time capture of permitted bytes (never the live dir)."""
    __tablename__ = "snapshots"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(32), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    consistency: Mapped[str] = mapped_column(String(20), nullable=False, default="consistent")  # consistent|inconsistent
    result: Mapped[str] = mapped_column(String(20), nullable=False, default="Complete")  # Complete|Partial
    roots: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON canonical roots
    exclusions: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON effective
    limits: Mapped[str] = mapped_column(Text, nullable=False, default="{}")  # JSON configured
    included_count: Mapped[int] = mapped_column(default=0)
    excluded_count: Mapped[int] = mapped_column(default=0)
    unreadable_count: Mapped[int] = mapped_column(default=0)
    included_bytes: Mapped[int] = mapped_column(default=0)
    limitations: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON
    storage_path: Mapped[str] = mapped_column(Text, nullable=False, default="")
    revision: Mapped[str | None] = mapped_column(String(80), nullable=True)
    provenance: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON or null
    capture_started_at: Mapped[str] = mapped_column(String(40), nullable=False, default=_now_iso)
    capture_finished_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False, default=_now_iso)

    __table_args__ = (Index("ix_snapshots_project", "project_id"),)


class SnapshotFile(Base):
    __tablename__ = "snapshot_files"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    snapshot_id: Mapped[str] = mapped_column(String(32), ForeignKey("snapshots.id", ondelete="CASCADE"), nullable=False)
    rel_path: Mapped[str] = mapped_column(Text, nullable=False)
    size: Mapped[int] = mapped_column(default=0)
    encoding: Mapped[str] = mapped_column(String(20), nullable=False, default="utf-8")
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    inclusion_reason: Mapped[str] = mapped_column(String(40), nullable=False, default="included")
    created_at: Mapped[str] = mapped_column(String(40), nullable=False, default=_now_iso)

    __table_args__ = (Index("ix_snapshot_files_snapshot", "snapshot_id"),)


class Audit(Base):
    __tablename__ = "audits"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String(32), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    snapshot_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("snapshots.id", ondelete="SET NULL"), nullable=True)
    kind: Mapped[str] = mapped_column(String(30), nullable=False, default="inventory")
    state: Mapped[str] = mapped_column(String(20), nullable=False, default="Queued")
    stage: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    processed_files: Mapped[int] = mapped_column(default=0)
    processed_bytes: Mapped[int] = mapped_column(default=0)
    checkpoint: Mapped[str] = mapped_column(Text, nullable=False, default="{}")  # JSON
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False, default=_now_iso)
    updated_at: Mapped[str] = mapped_column(String(40), nullable=False, default=_now_iso, onupdate=_now_iso)
    finished_at: Mapped[str | None] = mapped_column(String(40), nullable=True)

    __table_args__ = (Index("ix_audits_project", "project_id"), Index("ix_audits_state", "state"))


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    audit_id: Mapped[str] = mapped_column(String(32), ForeignKey("audits.id", ondelete="CASCADE"), nullable=False)
    seq: Mapped[int] = mapped_column(nullable=False)
    stage: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    kind: Mapped[str] = mapped_column(String(40), nullable=False, default="info")
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    data: Mapped[str] = mapped_column(Text, nullable=False, default="{}")  # JSON
    created_at: Mapped[str] = mapped_column(String(40), nullable=False, default=_now_iso)

    __table_args__ = (Index("ix_audit_events_audit_seq", "audit_id", "seq", unique=True),)


class AuditStep(Base):
    __tablename__ = "audit_steps"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    audit_id: Mapped[str] = mapped_column(String(32), ForeignKey("audits.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    state: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    started_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    finished_at: Mapped[str | None] = mapped_column(String(40), nullable=True)

    __table_args__ = (Index("ix_audit_steps_audit", "audit_id"),)


class InventoryFact(Base):
    """A derived inventory fact; each references its snapshot file + hash evidence."""
    __tablename__ = "inventory_facts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    snapshot_id: Mapped[str] = mapped_column(String(32), ForeignKey("snapshots.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[str] = mapped_column(String(32), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False)  # language|manifest|route|test|...
    key: Mapped[str] = mapped_column(String(120), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="{}")  # JSON
    evidence: Mapped[str] = mapped_column(Text, nullable=False, default="{}")  # JSON {file,hash,lines}
    parser: Mapped[str] = mapped_column(String(60), nullable=False, default="")
    created_at: Mapped[str] = mapped_column(String(40), nullable=False, default=_now_iso)

    __table_args__ = (Index("ix_inventory_facts_snapshot", "snapshot_id"),)
