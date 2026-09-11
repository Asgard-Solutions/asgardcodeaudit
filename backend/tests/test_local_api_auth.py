"""F06 evidence: unauthorized API requests are rejected; dev handshake scope."""

BAD = {"Authorization": "Bearer wrongwrongwrong"}


def test_protected_route_requires_session(make_client):
    with make_client("preview") as c:
        assert c.get("/api/v1/projects").status_code == 401
        assert c.get("/api/v1/projects", headers=BAD).status_code == 401


def test_correct_session_is_accepted(make_client, auth_headers):
    with make_client("preview") as c:
        assert c.get("/api/v1/projects", headers=auth_headers).status_code == 200


def test_preview_dev_handshake_issues_working_token(make_client):
    with make_client("preview") as c:
        r = c.post("/api/v1/dev/session")
        assert r.status_code == 200
        token = r.json()["token"]
        assert token
        ok = c.get("/api/v1/projects", headers={"Authorization": f"Bearer {token}"})
        assert ok.status_code == 200


def test_dev_handshake_absent_in_desktop_mode(make_client):
    with make_client("desktop") as c:
        # desktop mode must not expose the browser dev session endpoint
        assert c.post("/api/v1/dev/session").status_code == 404
