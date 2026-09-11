"""F01/F02 evidence: readiness + build identity, and health/build/diagnostics."""


def test_startup_handshake_is_unauthenticated_and_reports_identity(make_client):
    with make_client("preview") as c:
        r = c.get("/api/v1/startup/handshake")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ready"
        assert body["name"] == "Asgard CodeAudit"
        assert body["version"].startswith("0.1.0")
        assert body["mode"] == "preview"
        # Never leak a secret in the handshake.
        assert "secret" not in r.text.lower()


def test_build_requires_auth(make_client):
    with make_client("preview") as c:
        assert c.get("/api/v1/build").status_code == 401


def test_build_and_diagnostics_report_real_runtime(make_client, auth_headers):
    with make_client("preview") as c:
        b = c.get("/api/v1/build", headers=auth_headers).json()
        assert b["sqlite_runtime"]
        assert b["python_version"]

        d = c.get("/api/v1/diagnostics", headers=auth_headers).json()
        # Phase 1 must be rollback-journal, not WAL (C-5).
        assert d["storage"]["sqlite"]["journal_mode"] == "delete"
        assert d["storage"]["sqlite"]["foreign_keys"] is True
        assert d["mode"] == "preview"
        assert len(d["preview_limitations"]) >= 1
