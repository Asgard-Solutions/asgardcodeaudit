# Asgard CodeAudit

A local-first Windows code-audit application. The current implementation is the Phase 1 foundation: project registration, SQLite persistence, a sandboxed Electron desktop, and a separate synthetic-fixture preview. It does not yet scan source or generate findings.

## Run the desktop on Windows

Install Node.js 24 and uv. From the project root in PowerShell:

```powershell
.\scripts\start-desktop.ps1
```

The script installs dependencies from the delivered lockfiles, obtains Python 3.13 through uv, builds the desktop renderer and Electron shell, and launches the local application. Build tools are development prerequisites; a self-contained installer belongs to the later packaging phase.

Use `-Validate` instead of the normal launch to run the automated checks and the synthetic native Windows smoke test:

```powershell
.\scripts\start-desktop.ps1 -Validate
```

Do not run native UI automation while using other applications: the test focuses its own folder dialog and sends keys to it. The test creates isolated synthetic source and app-data directories; it does not register your projects.

## Architecture

`frontend/` contains the shared React/TypeScript interface. `desktop/` contains Electron main, the bundled sandbox-compatible preload, local backend lifecycle, and typed IPC validation. `backend/` contains FastAPI, SQLite persistence, and Alembic migrations.

The desktop binds its owned backend to loopback and supplies a random session secret through a private stdin pipe. The renderer uses the narrow preload bridge, not arbitrary filesystem or HTTP access. Registering or removing a project does not alter its source folder.

The preview uses relative same-origin `/api/v1/` requests and approved synthetic fixtures. Its ingress must route that API prefix to the backend. It does not use another deployment's `REACT_APP_BACKEND_URL` and must not be given private source or production credentials.

## Verification and scope

See [the Phase 1 verification record](docs/PHASE1_COMPLETION.md) for evidence and limitations. The `Phase 1 validation` workflow tests clean locked installs on Windows and Linux, plus actual Electron/Chromium checks on the Windows runner. A green unit test is not a substitute for native or installed-app evidence.

Phase 2 and later add snapshots/inventory, checks/findings, optional LLM providers, prompt generation, reporting, recovery, and installer/release verification. None of those are implied by the current foundation.
