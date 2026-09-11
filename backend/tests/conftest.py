import pytest
from fastapi.testclient import TestClient

TEST_SECRET = "t" * 40


@pytest.fixture
def make_client(tmp_path, monkeypatch):
    """Factory that builds a TestClient in a given mode with a fresh data dir.

    Resets the settings/engine caches so each client uses an isolated SQLite
    database, and pre-injects the desktop session secret so auth is exercised
    without blocking on the stdin startup pipe.
    """
    from app import config as cfg
    from app.storage import db as dbmod
    from app.security import auth

    created = []

    def _make(mode: str = "preview", data_dir=None, origins=None):
        monkeypatch.setenv("ASGARD_MODE", mode)
        monkeypatch.setenv("ASGARD_DATA_DIR", str(data_dir or tmp_path))
        monkeypatch.setenv("ASGARD_PREVIEW_ORIGINS", ",".join(origins or []))
        cfg.get_settings.cache_clear()
        dbmod._engine = None
        dbmod._SessionLocal = None
        auth.reset_for_tests()
        auth.set_desktop_secret(TEST_SECRET)
        from app.main import app
        client = TestClient(app)
        created.append(client)
        return client

    yield _make

    for c in created:
        try:
            c.close()
        except Exception:
            pass


@pytest.fixture
def auth_headers():
    return {"Authorization": f"Bearer {TEST_SECRET}"}
