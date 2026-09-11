from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..config import get_settings
from ..security import require_session
from ..storage.db import get_session
from ..projects import service
from ..projects.schemas import (
    FixtureOut,
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
    fixtures_response,
)

router = APIRouter(prefix="/api/v1", tags=["projects"], dependencies=[Depends(require_session)])


def _err(exc: service.ServiceError):
    return HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message})


@router.get("/preview/fixtures", response_model=list[FixtureOut])
def get_fixtures():
    settings = get_settings()
    if not settings.is_preview:
        # In desktop mode the native picker is used instead of fixtures.
        return []
    return fixtures_response()


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(include_archived: bool = False, db: Session = Depends(get_session)):
    return [ProjectOut.from_model(p) for p in service.list_projects(db, include_archived)]


@router.post("/projects", response_model=ProjectOut, status_code=201)
def create_project(payload: ProjectCreate, db: Session = Depends(get_session)):
    try:
        p = service.register_project(db, payload, get_settings())
    except service.ServiceError as exc:
        raise _err(exc)
    return ProjectOut.from_model(p)


@router.get("/projects/{project_id}", response_model=ProjectOut)
def get_project(project_id: str, db: Session = Depends(get_session)):
    try:
        return ProjectOut.from_model(service.get_project(db, project_id))
    except service.ServiceError as exc:
        raise _err(exc)


@router.patch("/projects/{project_id}", response_model=ProjectOut)
def update_project(project_id: str, payload: ProjectUpdate, db: Session = Depends(get_session)):
    try:
        return ProjectOut.from_model(service.update_project(db, project_id, payload))
    except service.ServiceError as exc:
        raise _err(exc)


@router.delete("/projects/{project_id}")
def remove_project(project_id: str, db: Session = Depends(get_session)):
    try:
        root = service.remove_project(db, project_id)
    except service.ServiceError as exc:
        raise _err(exc)
    return {"removed": project_id, "source_untouched": True, "root_path": root}
