# Asgard CodeAudit — PRD / Working Memory

## Original problem statement
Read-only Windows desktop code-audit tool (working name **Asgard CodeAudit**): opens local projects, collects evidence, applies engineering checks, optionally uses OpenAI/LM Studio (later), generates prompts for external tools. Electron + packaged FastAPI + local **SQLite**. Phased handoff (Phase 0→6), each phase authorized separately. Full reference in `Asgard_CodeAudit_Complete_Reference.md` (docs 00–06).

## User persona
"Jake" — manages several projects, uses AI coding tools, needs evidence-backed audits and must distinguish demonstrated problems from unverified concerns.

## Static user-approved decisions
- Windows Electron desktop app + bundled FastAPI + SQLite is the deliverable; web preview is a dev harness behind adapters. Desktop foundation is Phase 1, not deferred.
- SQLite + SQLAlchemy + Alembic in both environments. No Mongo, no dual DBs.
- Static-first; no LLM in early phases. Later: OpenAI (user key) + LM Studio (configurable; host 192.168.1.100). NOT the Emergent Universal Key. No auto-fallback.
- v1 read-only: app writes only its own DB/snapshots/reports/exports.
- Retain target toolchain Python 3.13 + Node 24 (validate on them; document real blockers).

## Environment facts (preview)
Linux **aarch64**. Preview SERVICE runtime (supervisor, immutable): Python 3.11.16 (SQLite 3.40.1), Node 20.20.2. Target validation toolchain (project-local): Python 3.13.15 (SQLite 3.53.1, via uv), Node v24.21.0. No OS credential store. `uv` at /opt/bin/uv.

## Implemented
- **2026-06 Phase 0:** docs/DECISIONS.md + docs/IMPLEMENTATION_STATUS.md (planning only).
- **2026-06 Phase 1 (foundation, SQLite, project registration):**
  - Backend `backend/app/**` (FastAPI; `server.py` shim), Alembic migrations 0001+0002, SQLite pragmas (journal=DELETE, FK on, busy_timeout, synchronous=FULL), project registration with canonical-path validation, app-data separation, single-instance flock, per-launch/session-secret auth, preview dev-session with same-origin/platform-suffix origin boundary, diagnostics with real runtime.
  - Frontend `frontend/**` Vite + React 19 + TS: Overview, Projects, Project Settings, Diagnostics; explicit transport mode selection (no silent fallback); native-picker wiring for desktop.
  - Desktop `desktop/**` Electron: main/preload/ipc/backend-process/security — sandbox, IPC allow-list + sender validation, 127.0.0.1 loopback + stdin secret, single-instance, readiness/retry/shutdown, native folder dialog.
  - Dependencies cleaned: requirements.txt (actual deps), uv.lock, frontend package-lock.json.
  - Tests: backend 22 (pass on 3.11 + 3.13), frontend vitest 6, desktop vitest 5, external ingress 11 (testing agent). F01–F09 matrix in IMPLEMENTATION_STATUS.md.

## Open verification gates (unverified — need Windows/GUI/LAN)
G-1 renderer isolation/IPC-in-window · G-2 loopback+stdin-secret in-process + single-instance focus · G-3 native folder dialog · G-4 PyInstaller Windows sidecar · G-5 Windows credential store (Phase 4) · G-6 NSIS installer (Phase 6) · G-7 Windows x64 build host · G-8/9 live LM Studio/OpenAI (Phase 4) · G-10/11 signing/perf.

## Backlog (phase-gated; each needs explicit approval)
- P2 snapshot + inventory · P3 rules/evidence/findings · P4 providers · P5 prompt studio/comparison · P6 backup/restore, installer, release, SBOMs.

## Next task
Await Phase 1 review. On approval, begin Phase 2 (safe snapshot + real inventory) only.
