"""Project registration service (shared by preview and desktop).

Read-only invariant: this module records registrations only; it never creates,
edits, or deletes the audited source folder.
"""
from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings
from ..storage.models import Project, ProjectSettings
from .fixtures import resolve_fixture
from .pathcheck import PathValidationError, canonicalize_root
from .schemas import ProjectCreate, ProjectUpdate

DEFAULT_EXCLUSIONS = [
    ".git", "node_modules", ".venv", "venv", "dist", "build", "__pycache__",
    "*.min.js", "*.sqlite3", "*.db", ".env",
]


class ServiceError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def _resolve_source(payload: ProjectCreate, settings: Settings) -> tuple[Path, str, str, str | None]:
    """Return (canonical_root, original_path, source_type, fixture_id)."""
    if settings.is_preview:
        if not payload.fixture_id:
            raise ServiceError(
                403, "preview_fixture_required",
                "Preview mode restricts registration to approved synthetic fixtures. "
                "Provide a fixture_id (the native folder picker is a desktop feature).",
            )
        if payload.path:
            raise ServiceError(
                403, "preview_arbitrary_path_denied",
                "Arbitrary filesystem paths are not allowed in preview mode.",
            )
        fpath = resolve_fixture(payload.fixture_id)
        if fpath is None:
            raise ServiceError(404, "fixture_not_found", "Unknown or unavailable fixture.")
        try:
            real = canonicalize_root(str(fpath), settings.data_dir)
        except PathValidationError as exc:
            raise ServiceError(400, exc.code, exc.message) from exc
        return real, str(fpath), "fixture", payload.fixture_id

    # desktop
    if not payload.path:
        raise ServiceError(400, "path_required", "A folder path is required.")
    try:
        real = canonicalize_root(payload.path, settings.data_dir)
    except PathValidationError as exc:
        raise ServiceError(400, exc.code, exc.message) from exc
    return real, payload.path, "local", None


def register_project(db: Session, payload: ProjectCreate, settings: Settings) -> Project:
    real, original, source_type, fixture_id = _resolve_source(payload, settings)

    existing = db.execute(
        select(Project).where(Project.root_path == str(real), Project.status == "active")
    ).scalar_one_or_none()
    if existing is not None:
        raise ServiceError(409, "duplicate_root", "This folder is already registered.")

    project = Project(
        name=payload.name.strip(),
        root_path=str(real),
        original_path=original,
        source_type=source_type,
        fixture_id=fixture_id,
        tags=json.dumps(payload.tags or []),
        profile=payload.profile,
        source_sharing_policy=payload.source_sharing_policy,
        status="active",
    )
    project.settings = ProjectSettings(exclusions=json.dumps(DEFAULT_EXCLUSIONS))
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def list_projects(db: Session, include_archived: bool = False) -> list[Project]:
    stmt = select(Project)
    if not include_archived:
        stmt = stmt.where(Project.status == "active")
    stmt = stmt.order_by(Project.created_at.desc())
    return list(db.execute(stmt).scalars().all())


def get_project(db: Session, project_id: str) -> Project:
    p = db.get(Project, project_id)
    if p is None:
        raise ServiceError(404, "not_found", "Project not found.")
    return p


def update_project(db: Session, project_id: str, payload: ProjectUpdate) -> Project:
    p = get_project(db, project_id)
    if payload.name is not None:
        p.name = payload.name.strip()
    if payload.tags is not None:
        p.tags = json.dumps(payload.tags)
    if payload.profile is not None:
        p.profile = payload.profile
    if payload.source_sharing_policy is not None:
        p.source_sharing_policy = payload.source_sharing_policy
    if payload.status is not None:
        p.status = payload.status
    db.commit()
    db.refresh(p)
    return p


def remove_project(db: Session, project_id: str) -> str:
    """Remove a registration. NEVER touches the source folder on disk."""
    p = get_project(db, project_id)
    root = p.root_path
    db.delete(p)  # cascades to settings; does not touch the filesystem
    db.commit()
    return root
