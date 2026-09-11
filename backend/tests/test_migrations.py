"""T2 evidence: Alembic up/down migration and SQLite pragmas + FK cascade."""
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _cfg(db_url: str) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", db_url)
    return cfg


def test_migration_up_and_down(tmp_path):
    db_url = f"sqlite:///{tmp_path/'m.sqlite3'}"
    cfg = _cfg(db_url)

    command.upgrade(cfg, "head")
    eng = create_engine(db_url)
    tables = set(inspect(eng).get_table_names())
    assert {"projects", "project_settings", "app_meta"}.issubset(tables)
    eng.dispose()

    command.downgrade(cfg, "base")
    eng = create_engine(db_url)
    tables = set(inspect(eng).get_table_names())
    assert "projects" not in tables
    assert "project_settings" not in tables
    eng.dispose()


def test_foreign_key_cascade_enforced(make_client, tmp_path):
    # Build the app engine (applies pragmas) via a client, then exercise FK.
    from app.storage import db as dbmod

    with make_client("preview", data_dir=tmp_path / "fk"):
        eng = dbmod.get_engine()
        with eng.begin() as conn:
            conn.exec_driver_sql(
                "INSERT INTO projects (id,name,root_path,original_path,source_type,tags,"
                "profile,source_sharing_policy,status,created_at,updated_at) VALUES "
                "('p1','n','/tmp/x','/tmp/x','local','[]','standard-static','offline',"
                "'active','2026-01-01','2026-01-01')"
            )
            conn.exec_driver_sql(
                "INSERT INTO project_settings (id,project_id,exclusions,associated_roots,"
                "notes,updated_at) VALUES ('s1','p1','[]','[]','','2026-01-01')"
            )
        # Delete parent; child must cascade because PRAGMA foreign_keys=ON.
        with eng.begin() as conn:
            conn.exec_driver_sql("DELETE FROM projects WHERE id='p1'")
        with eng.connect() as conn:
            remaining = conn.execute(
                text("SELECT COUNT(*) FROM project_settings")
            ).scalar()
        assert remaining == 0
