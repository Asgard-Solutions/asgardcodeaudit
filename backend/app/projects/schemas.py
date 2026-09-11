from __future__ import annotations

import json
from typing import Literal, Optional

from pydantic import BaseModel, Field

from .fixtures import list_fixtures


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    # Desktop: a real path from the native picker.
    path: Optional[str] = None
    # Preview: an approved synthetic fixture id (arbitrary paths rejected).
    fixture_id: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    profile: str = "standard-static"
    source_sharing_policy: Literal["offline", "lan-only", "online"] = "offline"


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    tags: Optional[list[str]] = None
    profile: Optional[str] = None
    source_sharing_policy: Optional[Literal["offline", "lan-only", "online"]] = None
    status: Optional[Literal["active", "archived"]] = None


class ProjectOut(BaseModel):
    id: str
    name: str
    root_path: str
    original_path: str
    source_type: str
    fixture_id: Optional[str]
    tags: list[str]
    profile: str
    source_sharing_policy: str
    status: str
    created_at: str
    updated_at: str

    @staticmethod
    def from_model(p) -> "ProjectOut":
        return ProjectOut(
            id=p.id,
            name=p.name,
            root_path=p.root_path,
            original_path=p.original_path,
            source_type=p.source_type,
            fixture_id=p.fixture_id,
            tags=json.loads(p.tags or "[]"),
            profile=p.profile,
            source_sharing_policy=p.source_sharing_policy,
            status=p.status,
            created_at=p.created_at,
            updated_at=p.updated_at,
        )


class FixtureOut(BaseModel):
    id: str
    label: str
    description: str
    path: str
    available: bool


def fixtures_response() -> list[FixtureOut]:
    return [FixtureOut(**f) for f in list_fixtures()]
