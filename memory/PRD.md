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

## Phase 1 correction pass 3 — integrated desktop completion (2026-09-11)
Connected the renderer↔bridge↔router↔lifecycle path per the six reviewer findings
(reproduced first, kept open until each regression passed):
1. Dedicated typed `handshake()` Transport method (public handshake stays OUT of the
   generic REQUEST allow-list); consistent across client, both adapters, preload, main.
2. Launch `app://asgard/` (→ `/` Overview); sender validation by parsed ORIGIN + main
   frame (not exact URL, not prefix); protocol authority guard; legit route changes keep IPC.
3. Injectable `desktop/src/lifecycle.ts`: internal retry cleanup never quits; intentional
   quit awaits one shared idempotent backend shutdown; replacement starts only after full
   cleanup; post-readiness crash → in-app "Backend unavailable" + bounded `retryBackend()`;
   epoch guard ignores late exits; approved narrow bridge additions `onBackendUnavailable`
   (replay-on-subscribe) + `retryBackend`.
4. Readiness combines overall deadline + per-request timeout + caller cancel over the whole
   op incl. body read; re-checks final state before returning; abortable polling.
5. Serializable `{ok|error}` envelope across every IPC handler; renderer rebuilds `ApiError`;
   sanitized/bounded messages; no raw bodies/secrets.
6. All three lockfiles present; status/dates corrected.
Evidence (2026-09-11, target toolchains): backend pytest **24 passed** on Python 3.13.15
(`uv run --frozen --group test --python 3.13 python -m pytest ... --ignore=tests/test_external_preview.py`);
desktop vitest **51 passed** and frontend vitest **9 passed** on Node 24.21.0; tsc + desktop
build clean; preload 0 local require; desktop bundle 0 preview-code hits. Python 3.11 not run
(project pins `requires-python>=3.13`). Modeled Electron/jsdom substitutions are labeled and do
NOT close Windows gates G-1..G-4. Preview headless GUI boot is a pre-existing env condition
(reproduces at fork baseline with changes stashed); backend verified via curl. See
docs/IMPLEMENTATION_STATUS.md §5 for the full finding→files→tests mapping.

## Phase 1 correction pass 4 — lifecycle coordination (2026-09-11)
Fixed five reproduced concurrency failures in `desktop/src/lifecycle.ts` with one
coordinated owner of cancellation/cleanup/state: shutdown JOINS the in-flight
starter (`startTask`) and the actual owned-child cleanup (`cleanupPromise`) and
stays pending until cleanup finishes (a cleared handle ≠ completed cleanup);
`ready` is published only after an identity+cancellation+terminal-state+liveness
guard at both final points (post renderer-load; post recovery-handshake); an
unexpected exit of the CURRENT attempt is retained even while starting/recovering
(later subscriber still gets it); deliberate/superseded exits ignored via
epoch/tornDown; recovery handshake bounded+cancellable. Extracted the real IPC
wiring to `desktop/src/app-runtime.ts` so `connected.test.ts` drives the REAL
`registerIpcHandlers` (no re-implemented allow-list). Evidence (2026-09-11, testing
agent iteration_2.json): desktop vitest **53 passed** (Node 24.21.0), backend pytest
**24 passed** (Python 3.13.15), build clean, preload 0 local require. Lock hashes in
IMPLEMENTATION_STATUS §6. Preview real-browser boot remains UNVERIFIED (cross-origin
ingress hostname mismatch: browser host `...cluster-11.preview.emergentcf.cloud` vs
`REACT_APP_BACKEND_URL ...preview.emergentagent.com`); origin/isolation/allow-list/auth
NOT weakened. Windows gates G-1..G-4 still open.

## Phase 1 correction pass 2 (2026-06)
Desktop foundation hardened: esbuild-bundled sandbox preload (no local require); custom `app://` protocol serving packaged assets (traversal-rejecting, SPA fallback), CSP scoped to app origin; backend readiness now validates schema identity + authenticated probe with per-request abort + overall deadline, handles spawn/early-exit/EPIPE/cancel, redacted bounded logs, idempotent stop, retry without window/child accumulation; IPC changed from path-prefix to explicit operation allow-list + body validation + exact main-frame/origin sender check; preview origin policy now same-origin + exact allow-list (no suffix wildcard/blanket localhost); invalid ASGARD_MODE raises (no silent preview). Desktop-mode build verified to exclude preview code (0 hits). Lockfiles: backend/uv.lock, frontend/package-lock.json, desktop/package-lock.json. Tests: backend 24 (3.11+3.13), desktop vitest 19, frontend vitest 6. Windows/Electron gates G-1..G-4 remain not-natively-run.
