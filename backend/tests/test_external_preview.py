"""External preview URL smoke tests validating F01-F09 via ingress.

Exercises the deployed backend at REACT_APP_BACKEND_URL. These tests are
independent of the pytest fixtures (which use TestClient) and validate real
network behavior including the Kubernetes ingress /api routing.
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://code-evidence-tool.preview.emergentagent.com").rstrip("/")
HOST = BASE_URL.replace("https://", "").replace("http://", "")
API = f"{BASE_URL}/api/v1"


@pytest.fixture(scope="module")
def session_token():
    r = requests.post(f"{API}/dev/session", headers={"Origin": BASE_URL}, timeout=10)
    assert r.status_code == 200, r.text
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def auth_headers(session_token):
    return {"Authorization": f"Bearer {session_token}"}


# --- F06 auth boundary ---
def test_handshake_public_and_reports_identity():
    r = requests.get(f"{API}/startup/handshake", timeout=10)
    assert r.status_code == 200
    j = r.json()
    assert j["name"] == "Asgard CodeAudit"
    assert "version" in j and j["version"]


def test_projects_requires_auth():
    r = requests.get(f"{API}/projects", timeout=10)
    assert r.status_code == 401


def test_projects_wrong_bearer_rejected():
    r = requests.get(f"{API}/projects", headers={"Authorization": "Bearer wrong-token"}, timeout=10)
    assert r.status_code == 401


def test_dev_session_returns_working_token(session_token):
    r = requests.get(f"{API}/projects", headers={"Authorization": f"Bearer {session_token}"}, timeout=10)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# --- F08 origin boundary ---
def test_dev_session_foreign_origin_rejected():
    r = requests.post(f"{API}/dev/session", headers={"Origin": "https://evil.example"}, timeout=10)
    assert r.status_code == 403


def test_dev_session_same_origin_allowed():
    r = requests.post(f"{API}/dev/session", headers={"Origin": BASE_URL}, timeout=10)
    assert r.status_code == 200
    assert r.json().get("token")


def test_dev_session_no_origin_allowed():
    # requests will not send Origin by default; ensure explicit absence
    r = requests.post(f"{API}/dev/session", timeout=10)
    assert r.status_code == 200
    assert r.json().get("token")


# --- F03 registration in preview ---
def test_list_fixtures(auth_headers):
    r = requests.get(f"{API}/preview/fixtures", headers=auth_headers, timeout=10)
    assert r.status_code == 200
    ids = {f["id"] for f in r.json()}
    assert "py-fastapi-sample" in ids
    assert "js-react-sample" in ids


def _cleanup_fixture(auth_headers, fixture_id):
    r = requests.get(f"{API}/projects", headers=auth_headers, timeout=10)
    for p in r.json():
        if p.get("fixture_id") == fixture_id and p.get("status") == "active":
            requests.delete(f"{API}/projects/{p['id']}", headers=auth_headers, timeout=10)


def test_register_fixture_and_arbitrary_path_rejected(auth_headers):
    _cleanup_fixture(auth_headers, "py-fastapi-sample")
    name = f"TEST_proj_{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API}/projects", headers=auth_headers,
                      json={"name": name, "fixture_id": "py-fastapi-sample"}, timeout=10)
    assert r.status_code == 201, r.text
    j = r.json()
    assert j["source_type"] == "fixture"
    pid = j["id"]

    # arbitrary path in preview -> 403
    r2 = requests.post(f"{API}/projects", headers=auth_headers,
                       json={"name": "TEST_p2", "path": "/tmp/whatever"}, timeout=10)
    assert r2.status_code == 403

    # missing fixture_id in preview (no path either) -> 403 or 422 both acceptable per contract
    r3 = requests.post(f"{API}/projects", headers=auth_headers, json={"name": "TEST_p3"}, timeout=10)
    assert r3.status_code in (403, 422)

    # duplicate active fixture -> 409
    r4 = requests.post(f"{API}/projects", headers=auth_headers,
                       json={"name": "TEST_dup", "fixture_id": "py-fastapi-sample"}, timeout=10)
    assert r4.status_code == 409

    # cleanup
    d = requests.delete(f"{API}/projects/{pid}", headers=auth_headers, timeout=10)
    assert d.status_code == 200
    assert d.json().get("source_untouched") is True


# --- Name normalization regression ---
def test_whitespace_only_name_rejected(auth_headers):
    r = requests.post(f"{API}/projects", headers=auth_headers,
                      json={"name": "   ", "fixture_id": "js-react-sample"}, timeout=10)
    assert r.status_code == 422


def test_name_is_normalized(auth_headers):
    _cleanup_fixture(auth_headers, "js-react-sample")
    r = requests.post(f"{API}/projects", headers=auth_headers,
                      json={"name": "  Roof   Span  ", "fixture_id": "js-react-sample"}, timeout=10)
    assert r.status_code == 201
    pid = r.json()["id"]
    assert r.json()["name"] == "Roof Span"
    # patch with whitespace-only -> 422
    r2 = requests.patch(f"{API}/projects/{pid}", headers=auth_headers, json={"name": "   "}, timeout=10)
    assert r2.status_code == 422
    requests.delete(f"{API}/projects/{pid}", headers=auth_headers, timeout=10)
