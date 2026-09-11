"""Regression tests for the Phase 1 correction pass.

Covers: whitespace-only name (Reproduction B), active-root uniqueness on
reactivation (Reproduction A), and the preview dev-session origin boundary.
"""
from conftest import TEST_SECRET

H = {"Authorization": f"Bearer {TEST_SECRET}"}


# --- Reproduction B: whitespace-only names ---------------------------------

def test_whitespace_only_name_rejected_on_create(make_client):
    with make_client("preview") as c:
        r = c.post("/api/v1/projects", headers=H,
                   json={"name": "   ", "fixture_id": "py-fastapi-sample"})
        assert r.status_code == 422, r.text


def test_name_is_normalized(make_client):
    with make_client("preview") as c:
        r = c.post("/api/v1/projects", headers=H,
                   json={"name": "  RoofSpan   API  ", "fixture_id": "py-fastapi-sample"})
        assert r.status_code == 201
        assert r.json()["name"] == "RoofSpan API"


def test_whitespace_only_name_rejected_on_update(make_client):
    with make_client("preview") as c:
        pid = c.post("/api/v1/projects", headers=H,
                     json={"name": "ok", "fixture_id": "js-react-sample"}).json()["id"]
        r = c.patch(f"/api/v1/projects/{pid}", headers=H, json={"name": "    "})
        assert r.status_code == 422, r.text


# --- Reproduction A: only one active registration per root ------------------

def test_reactivation_cannot_create_second_active_root(make_client, tmp_path):
    data_dir = tmp_path / "appdata"
    proj = tmp_path / "repo"
    proj.mkdir()

    with make_client("desktop", data_dir=data_dir) as c:
        first = c.post("/api/v1/projects", headers=H, json={"name": "First", "path": str(proj)})
        assert first.status_code == 201
        first_id = first.json()["id"]

        # archive it
        assert c.patch(f"/api/v1/projects/{first_id}", headers=H,
                       json={"status": "archived"}).status_code == 200

        # register the same root again -> new active registration
        second = c.post("/api/v1/projects", headers=H, json={"name": "Second", "path": str(proj)})
        assert second.status_code == 201

        # reactivating the first must be rejected (would be a second active owner)
        conflict = c.patch(f"/api/v1/projects/{first_id}", headers=H, json={"status": "active"})
        assert conflict.status_code == 409, conflict.text
        assert conflict.json()["detail"]["code"] == "duplicate_root"


# --- Preview dev-session origin boundary (exact origin / same-origin only) ---

def test_dev_session_rejects_foreign_and_sibling_origins(make_client):
    with make_client("preview", origins=["https://app.example"]) as c:
        # approved exact origin
        ok = c.post("/api/v1/dev/session", headers={"Origin": "https://app.example"})
        assert ok.status_code == 200
        token = ok.json()["token"]
        assert c.get("/api/v1/projects", headers={"Authorization": f"Bearer {token}"}).status_code == 200
        # unrelated origin
        assert c.post("/api/v1/dev/session", headers={"Origin": "https://evil.example"}).status_code == 403
        # unapproved sibling on a shared hosting suffix must NOT be granted a token
        assert c.post("/api/v1/dev/session", headers={"Origin": "https://other.app.example"}).status_code == 403


def test_dev_session_same_origin_allowed_but_port_and_scheme_matter(make_client):
    with make_client("preview", origins=[]) as c:
        # TestClient own origin is http://testserver
        assert c.post("/api/v1/dev/session", headers={"Origin": "http://testserver"}).status_code == 200
        # different port => not same-origin
        assert c.post("/api/v1/dev/session", headers={"Origin": "http://testserver:9999"}).status_code == 403
        # different scheme => not same-origin
        assert c.post("/api/v1/dev/session", headers={"Origin": "https://testserver"}).status_code == 403
        # malformed origin
        assert c.post("/api/v1/dev/session", headers={"Origin": "not-a-url"}).status_code == 403


def test_dev_session_without_origin_is_allowed(make_client):
    # documented non-browser / same-origin GET access (no Origin header)
    with make_client("preview", origins=["https://app.example"]) as c:
        assert c.post("/api/v1/dev/session").status_code == 200


def test_invalid_mode_is_rejected(monkeypatch):
    from app import config as cfg

    monkeypatch.setenv("ASGARD_MODE", "bogus")
    cfg.get_settings.cache_clear()
    import pytest

    with pytest.raises(ValueError):
        cfg.Settings()
    monkeypatch.delenv("ASGARD_MODE", raising=False)
    cfg.get_settings.cache_clear()
