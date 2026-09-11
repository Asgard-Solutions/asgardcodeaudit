"""F03/F04/F05/F07 evidence: registration, persistence, removal, separation."""
import os

from conftest import TEST_SECRET

H = {"Authorization": f"Bearer {TEST_SECRET}"}


def test_preview_register_fixture_and_list(make_client):
    with make_client("preview") as c:
        fx = c.get("/api/v1/preview/fixtures", headers=H).json()
        assert any(f["id"] == "py-fastapi-sample" for f in fx)

        r = c.post("/api/v1/projects", headers=H,
                   json={"name": "Sample Py", "fixture_id": "py-fastapi-sample"})
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["source_type"] == "fixture"
        assert body["fixture_id"] == "py-fastapi-sample"

        lst = c.get("/api/v1/projects", headers=H).json()
        assert len(lst) == 1


def test_preview_rejects_arbitrary_path(make_client, tmp_path):
    with make_client("preview") as c:
        # missing fixture_id
        r1 = c.post("/api/v1/projects", headers=H, json={"name": "x"})
        assert r1.status_code == 403
        # arbitrary path supplied
        r2 = c.post("/api/v1/projects", headers=H,
                    json={"name": "x", "path": str(tmp_path)})
        assert r2.status_code == 403


def test_duplicate_fixture_registration_conflicts(make_client):
    with make_client("preview") as c:
        payload = {"name": "Dup", "fixture_id": "js-react-sample"}
        assert c.post("/api/v1/projects", headers=H, json=payload).status_code == 201
        assert c.post("/api/v1/projects", headers=H, json=payload).status_code == 409


def test_persistence_across_restart(make_client, tmp_path):
    data_dir = tmp_path / "data"
    with make_client("preview", data_dir=data_dir) as c1:
        c1.post("/api/v1/projects", headers=H,
                json={"name": "Persist", "fixture_id": "py-fastapi-sample"})
        assert len(c1.get("/api/v1/projects", headers=H).json()) == 1

    # Fresh backend, same data dir → project survives, no reseed/duplication.
    with make_client("preview", data_dir=data_dir) as c2:
        lst = c2.get("/api/v1/projects", headers=H).json()
        assert len(lst) == 1
        assert lst[0]["name"] == "Persist"


def test_remove_registration_leaves_source_untouched(make_client):
    from app.projects.fixtures import resolve_fixture
    src = resolve_fixture("py-fastapi-sample")
    files_before = sorted(p.name for p in src.iterdir())

    with make_client("preview") as c:
        pid = c.post("/api/v1/projects", headers=H,
                     json={"name": "ToRemove", "fixture_id": "py-fastapi-sample"}).json()["id"]
        d = c.delete(f"/api/v1/projects/{pid}", headers=H)
        assert d.status_code == 200
        assert d.json()["source_untouched"] is True
        assert c.get("/api/v1/projects", headers=H).json() == []

    # Source folder + contents still present on disk.
    assert src.is_dir()
    assert sorted(p.name for p in src.iterdir()) == files_before


def test_desktop_registers_real_path_and_rejects_appdata_overlap(make_client, tmp_path):
    data_dir = tmp_path / "appdata"
    project_dir = tmp_path / "some_project"
    project_dir.mkdir()
    (project_dir / "readme.md").write_text("hi")

    with make_client("desktop", data_dir=data_dir) as c:
        ok = c.post("/api/v1/projects", headers=H,
                    json={"name": "Real", "path": str(project_dir)})
        assert ok.status_code == 201, ok.text
        assert ok.json()["source_type"] == "local"

        # Non-existent path
        bad = c.post("/api/v1/projects", headers=H,
                     json={"name": "Nope", "path": str(tmp_path / "does_not_exist")})
        assert bad.status_code == 400
        assert bad.json()["detail"]["code"] == "not_found"

        # F07: registering the app-data dir itself must be rejected
        overlap = c.post("/api/v1/projects", headers=H,
                         json={"name": "Bad", "path": str(data_dir)})
        assert overlap.status_code == 400
        assert overlap.json()["detail"]["code"] == "overlaps_app_data"

    # source project dir still intact
    assert (project_dir / "readme.md").read_text() == "hi"
