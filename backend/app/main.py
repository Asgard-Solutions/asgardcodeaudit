from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from .api import diagnostics as diagnostics_api
from .api import dev as dev_api
from .api import projects as projects_api
from .build_info import APP_NAME, build_identity
from .config import get_settings
from .security import auth as auth_module
from .storage.db import get_engine
from .storage.lock import SingleInstanceError, acquire_single_instance_lock

logger = logging.getLogger("asgard")

_BACKEND_DIR = Path(__file__).resolve().parent.parent  # /app/backend


def run_migrations(db_url: str) -> None:
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", db_url)
    command.upgrade(cfg, "head")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    settings.ensure_dirs()

    # Desktop: obtain the per-launch secret over the private stdin pipe and hold
    # a single-instance lock on the app-data directory before serving.
    app.state.instance_lock = None
    if settings.is_desktop:
        if not auth_module.has_desktop_secret():
            auth_module.read_desktop_secret_from_stdin()
        try:
            app.state.instance_lock = acquire_single_instance_lock(settings.lock_path)
        except SingleInstanceError:
            logger.error("Another instance already owns %s", settings.data_dir)
            raise

    # Ensure schema exists / is at head. Does NOT reseed application data.
    get_engine()
    run_migrations(settings.db_url)
    logger.info("%s backend ready in %s mode", APP_NAME, settings.mode)

    yield

    if app.state.instance_lock is not None:
        app.state.instance_lock.release()


def create_app() -> FastAPI:
    settings = get_settings()
    ident = build_identity()
    app = FastAPI(
        title=APP_NAME,
        version=ident["version"],
        lifespan=lifespan,
    )

    # Preview harness calls the backend through the platform ingress. Desktop
    # uses loopback IPC (no browser CORS). In preview we restrict CORS to the
    # explicit allow-list; an empty list means only same-origin is served.
    if settings.is_preview:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.preview_origins,
            allow_origin_regex=settings.cors_origin_regex(),
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.include_router(diagnostics_api.public_router)
    app.include_router(diagnostics_api.router)
    app.include_router(dev_api.router)
    app.include_router(projects_api.router)
    return app


app = create_app()
