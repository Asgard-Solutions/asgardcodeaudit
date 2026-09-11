# Asgard CodeAudit — Implementation Status (docs/IMPLEMENTATION_STATUS.md)

**Prepared:** June 2026 (Phase 0). **Updated:** June 2026 (Phase 1 implementation + correction pass).
**Current state:** **Phase 1 implemented** (desktop foundation, SQLite persistence, project registration). Phase 2+ not started.
**Stop point:** Phase 1 report delivered; awaiting review before Phase 2.

---

## 1. Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture, dependency/version assessment, interfaces, env limits, contradictions, Phase 1 plan | Done |
| 1 | Desktop foundation, SQLite + Alembic, project registration | **Implemented** |
| 2–6 | Snapshot/inventory, rules/findings, providers, prompt studio, installer/release | Not started |

**Read-only invariant (all phases):** the app writes only its own DB/snapshots/reports/exports; it never mutates, executes, installs, commits, pushes, or deploys audited source.

---

## 2. What was built (files)

**Backend** (`backend/`): `server.py` (shim → `app.main`), `app/main.py` (lifespan: desktop stdin secret, single-instance lock, Alembic upgrade — no reseed), `app/config.py` (mode + app-data + origin policy), `app/build_info.py`, `app/security/{__init__,auth}.py` (per-launch secret, constant-time compare, dev token, origin rule), `app/storage/{db,models,lock}.py` (SQLite pragmas: journal=DELETE, FK on, busy_timeout, synchronous=FULL; single-instance flock), `app/projects/{pathcheck,fixtures,service,schemas}.py`, `app/api/{diagnostics,projects,dev}.py`, `migrations/**` (`0001_initial`, `0002_active_root_unique`), `pyproject.toml`, `uv.lock`, `requirements.txt`, `tests/**`.

**Frontend** (`frontend/`): Vite + React 19 + TS. `src/transport/{contract,preview,desktop,index}.ts` (explicit mode, dynamic import), `src/api/{client,hooks}.ts`, `src/components/{Layout,Modal,ui}.tsx`, `src/features/{overview,projects,diagnostics}/**`, `src/App.tsx` (boot: create transport → session → handshake; error+retry), Tailwind config, `vitest.config.ts`, tests, `package-lock.json`.

**Desktop** (`desktop/`): `src/main.ts` (single-instance, window, backend lifecycle, IPC handlers with sender+argument validation), `src/preload.ts` (narrow contextBridge), `src/ipc.ts` (allow-list, unit-tested), `src/backend-process.ts` (127.0.0.1 ephemeral port, stdin secret, readiness poll), `src/security.ts` (sandbox/CSP/navigation), `README.md` (dev commands), `tsconfig.json`, `package.json`, `src/ipc.test.ts`.

Deliverable-repo mapping (preview flattens `apps/backend`→`backend`, `apps/web`→`frontend`, `apps/desktop`→`desktop` to satisfy the fixed platform supervisor).

---

## 3. F01–F09 implementation / verification matrix

Verification-category key: **PY** = pytest (Python 3.11 preview + 3.13 target, real process); **UI** = live preview browser (Linux, labeled preview); **VT-unit** = vitest pure-logic; **VT-proc** = vitest real Node child-process/HTTP; **WIN** = requires Windows/GUI + Electron binary (open gate, **not run**).

Status categories: **Verified(env)** exercised & passing in the stated environment · **Impl-not-native** implemented, not yet exercised on Windows · **Known-failure** currently failing (none) · **Later-phase** intentionally not implemented.

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| F01 | Native launch + backend readiness/build identity | Verified(env) readiness; Impl-not-native launch | Readiness identity + auth probe **VT-proc**; boot+identity **UI**; native window **WIN** |
| F02 | Startup failure → useful error + retry + diagnostics | Verified(env) preview; Impl-not-native desktop | Preview boot-error+retry **UI**; `bootWithRetry` window/child cleanup, redacted logs, timeout/early-exit/cancel **VT-proc**; native dialog **WIN** |
| F03 | Native selection + validated registration | Verified(env) logic; Impl-not-native picker | Validation/dedupe/overlap **PY**, register flow **UI**; native dialog **WIN** |
| F04 | Restart preserves projects/settings, no reseed | Verified(env) | `test_persistence_across_restart` **PY** + **UI** |
| F05 | Removal leaves source untouched | Verified(env) | `test_remove_registration_leaves_source_untouched` **PY** + **UI** |
| F06 | Missing/wrong API auth **and** invalid IPC senders rejected | Verified(env) API+IPC-logic; Impl-not-native in-window | 401 **PY/UI**; origin 403 **PY/live**; operation allow-list + `isTrustedFrame` **VT-unit**; sender-frame enforcement in a real window **WIN** |
| F07 | App-data / source-root separation | Verified(env) | `overlaps_app_data` both directions **PY** |
| F08 | Preview labeled + desktop separation enforced | Verified(env) | banner/fixture-only/dev-session-404-in-desktop/mode-select **PY/UI/VT-unit**; desktop build excludes preview code (0 hits in dist) |
| F09 | One owner of the app-data directory | Verified(env) backend; Impl-not-native native | flock `test_single_instance` **PY**; Electron single-instance **WIN** |

**Explicitly unverified (open gates), each with what it needs:**
| Gate | Needs |
|---|---|
| G-1 | Windows/GUI + Electron: renderer sandbox/contextIsolation/CSP + IPC sender-frame enforcement in a real window |
| G-2 | Windows/GUI + Electron: loopback bind, stdin-secret handshake in-process, single-instance focus behavior |
| G-3 | Windows: native `dialog.showOpenDialog` folder selection + cancellation |
| G-4 | Windows x64 build host: PyInstaller backend sidecar |
| G-5 | Windows: Credential Manager persistence (not in Phase 1 scope) |
| G-6 | Windows: electron-builder NSIS install/upgrade/uninstall (Phase 6) |
| G-7 | Windows x64 CI/build host (preview is Linux aarch64) |
| G-8/G-9 | Live LM Studio LAN / live OpenAI (Phase 4) |
| G-10/G-11 | Code signing / measured performance |

A mocked platform op or preview screenshot never closes a WIN gate.

**Known failures:** none.

### Test counts (correction pass, June 2026)
- Backend `pytest`: **24 passed / 0 failed / 0 skipped** on Python **3.11** and **3.13** (excludes external-ingress `test_external_preview.py`). Command: `python -m pytest tests/ --ignore=tests/test_external_preview.py`.
- Desktop `vitest` (Node 24): **19 passed** (ipc 8, protocol 4, backend-process 7 as real Node child/HTTP).
- Frontend `vitest` (Node 24): **6 passed**; `tsc --noEmit` + `VITE_ASGARD_MODE=desktop vite build`: pass; desktop build contains **0** `dev/session`/`PreviewTransport` occurrences.
- Desktop `tsc --noEmit` + esbuild bundle (Node 24): pass; `dist/preload.js` has 0 local `require`.
- Lockfiles: `backend/uv.lock` (545), `frontend/package-lock.json` (5321), `desktop/package-lock.json` (2805).

---

## 4. Out of scope for Phase 1 (not added)
Scanning, inventory, rules, findings, prompt generation, LLM/provider calls, provider credentials, automatic repairs, backup/restore, publishing, production installer. None present.

---

## 5. Phase 1 correction pass 2 — integrated desktop completion (Sept 11, 2026)

Addresses six reviewer findings about the *connection* between renderer, desktop
bridge, router and application lifecycle. Each finding was reproduced against the
local files before any behavior change, and kept open until its regression test
passed. Implementation status is reported separately from test evidence.

### Finding → changed files → regression tests

**1. Startup handshake call chain.** `api.handshake()` previously routed
`GET /api/v1/startup/handshake` through the generic REQUEST channel, which the
operation allow-list (correctly) rejected (`Operation not allowed`). Fixed with a
dedicated, typed `handshake()` Transport method used consistently by the API
client and both adapters; the public handshake is intentionally NOT in the REQUEST
allow-list. Authenticated readiness + the session secret stay in main.
Files: `frontend/src/transport/contract.ts,desktop.ts,preview.ts`,
`frontend/src/api/client.ts`, `frontend/src/App.tsx`, `frontend/src/vite-env.d.ts`,
`desktop/src/ipc.ts` (OPERATIONS excludes handshake), `desktop/src/preload.ts`,
`desktop/src/main.ts` (dedicated HANDSHAKE handler).
Tests: `desktop/src/ipc.test.ts` (handshake kept out of allow-list),
`desktop/src/connected.test.ts` (handshake via dedicated channel; rejected on
REQUEST), `frontend/src/app-connected.test.tsx` (real App init sequence reaches
Overview via the dedicated handshake).

**2. Routing vs sender validation.** Launch changed to `app://asgard/` (resolves
internally to index.html, matches the `/` Overview route). Sender validation
changed from exact-URL to parsed **origin** (`app://asgard`) + top-level main
frame, so legitimate same-document route changes keep IPC access while other
windows, subframes, unexpected authorities, ports, credentials, and schemes are
rejected. The protocol handler now also rejects unexpected authorities.
Files: `desktop/src/protocol.ts` (`APP_LAUNCH_URL`, `isApprovedAuthority`),
`desktop/src/ipc.ts` (`isTrustedFrame` origin-based), `desktop/src/main.ts`
(launch URL, authority guard, origin sender check), `desktop/src/security.ts`
(navigation confined to the app origin, reload allowed).
Tests: `desktop/src/ipc.test.ts`, `desktop/src/protocol.test.ts`,
`desktop/src/connected.test.ts` (route matrix `/`→projects→settings→diagnostics
retains access; subframe/other-window/authority/unapproved-op rejected),
`frontend/src/app-connected.test.tsx` (Overview→Projects→Diagnostics navigation).

**3. Retry & shutdown coordination.** Extracted an injectable `Lifecycle`
controller. Internal retry cleanup no longer triggers an intentional quit
(`isRestarting` gate on window-all-closed); an intentional quit awaits a single
shared/idempotent shutdown of the owned backend (before-quit prevents default
until cleanup finishes); a replacement backend starts only after the previous one
is fully stopped; post-readiness crashes are connected to a visible not-ready
state + one bounded recovery; late exit events from a superseded attempt are
ignored (epoch guard). `stop()` is now a single shared promise.
Files: `desktop/src/lifecycle.ts` (new), `desktop/src/main.ts` (wiring),
`desktop/src/backend-process.ts` (shared idempotent stop, `onExit`).
Tests: `desktop/src/lifecycle.test.ts` (13: failed-start→Retry, Quit-during-
startup, normal close, repeated stop, crash→unavailable, recovery, repeated Retry
reuse, Quit-during-recovery, recovery-failure, ignore-late-event, not-recoverable).

**4. Readiness deadline/cancellation.** The overall deadline, per-request timeout
and caller cancellation are now combined (`AbortSignal.any`) over the complete
readiness operation including response-body reading, with the per-request budget
clamped to the remaining deadline. Final state (aborted/deadline/alive) is
re-checked before returning a usable handle, so a late success never revives a
cancelled or expired attempt; the inter-poll delay is abortable.
Files: `desktop/src/backend-process.ts`.
Tests: `desktop/src/backend-process.test.ts` (delayed success past a 50 ms
deadline is rejected as timeout; cancellation while a success is in flight rejects
as cancelled; existing deterministic-failure/timeout/cancel-before tests kept).

**5. Structured errors across the bridge.** Every IPC handler now returns a
serializable `{ok:true,data}|{ok:false,error:{message,status,code}}` envelope
instead of throwing an Error with custom props (which Electron drops). The desktop
transport reconstructs a typed `ApiError`. Covers validation, duplicate
registration, backend unavailability, malformed and non-JSON responses; messages
are sanitized and bounded; raw backend bodies/secrets never cross.
Files: `desktop/src/ipc.ts` (`IpcResult`, `ipcOk/ipcFail`, `sanitizeMessage`),
`desktop/src/main.ts` (`callBackend` envelope), `desktop/src/preload.ts`,
`frontend/src/transport/desktop.ts` (`unwrap`→`ApiError`).
Tests: `desktop/src/ipc.test.ts` (envelope + sanitize), `desktop/src/connected.test.ts`
(status/code preserved for 401, validation→400, backend 404 bounded).

**6. Locks + status.** `backend/uv.lock`, `frontend/package-lock.json`,
`desktop/package-lock.json` all present in-workspace and used for the locked
setup below. This section records the reproduced findings and accurate dates.

### Test evidence (executed Sept 11, 2026, target toolchains)

Runners: Python 3.13.15 via `uv` (project-local, `/root/.local/share/uv`);
Node v24.21.0 (`/opt/node24`). Immutable preview *service* runtime (Py 3.11 /
Node 20) is separate and was not used for validation.

- **Backend pytest — 24 passed / 0 failed / 0 skipped**, Python **3.13.15**.
  Locked setup: `uv run --frozen --group test --python 3.13 python -m pytest tests/ --ignore=tests/test_external_preview.py`.
  (`python -m pytest` is required so `app` is importable; the console-script form is not.)
  Python 3.11 was **not run**: the project pins `requires-python >= 3.13`, so `uv`
  refuses 3.11 — recorded as an accurate blocker, not a silent skip. `test_external_preview.py`
  (external-ingress) remains a testing-agent concern, excluded as before.
- **Desktop vitest — 51 passed**, Node **24.21.0**: ipc 11, protocol 6,
  backend-process 10 (real Node child/HTTP), lifecycle 13, connected 11.
  `tsc --noEmit` + esbuild bundle: pass; `dist/preload.js` has **0** local `require`.
- **Frontend vitest — 9 passed**, Node **24.21.0**: transport 4, ui 2,
  app-connected 3. `tsc --noEmit`: pass. `VITE_ASGARD_MODE=desktop vite build`:
  pass; desktop bundle has **0** `dev/session`/`PreviewTransport` occurrences.

### Verification categories (labeled substitutions)

- **Real child/HTTP:** `backend-process.test.ts` spawns a real Node child and hits
  a real loopback HTTP server.
- **Modeled Electron main/bridge + real loopback HTTP + real `ipc.ts`:**
  `desktop/src/connected.test.ts` and `frontend/src/app-connected.test.tsx`.
  These MODEL Electron's `ipcMain`/`net.fetch`/`BrowserWindow`/preload and DOM
  routing; they exercise the actual transport/client and the real allow-list,
  sender-origin, and envelope logic. Native window/frame identity and the real net
  stack are NOT exercised.
- **Modeled injected deps:** `lifecycle.test.ts` drives the real controller with
  fake window/backend deps.
- **jsdom browser:** `app-connected.test.tsx` renders the real `<App/>`; DOM
  navigation is jsdom, not a native browser/Electron window; `reload` is not a
  meaningful jsdom operation and is not asserted as native.

None of the above close the Windows/GUI gates **G-1..G-4** (still open, not run):
renderer sandbox/CSP/IPC sender-frame in a real Electron window; loopback bind +
in-process stdin-secret handshake + single-instance focus; native
`dialog.showOpenDialog`; PyInstaller Windows sidecar.

### Known environment note (not a code regression)

The headless-browser **preview GUI** did not complete boot in this container. It
reproduces at the **fork baseline** with the correction-pass changes stashed, so
it is a pre-existing environment/headless condition, **not** introduced by this
pass. Backend endpoints were verified working via `curl` (handshake/dev-session →
200). The renderer boot → navigation → registration → post-crash recovery flow is
verified by the jsdom connected test above rather than by the headless preview GUI.

**Known failures:** none in the automated suites.
