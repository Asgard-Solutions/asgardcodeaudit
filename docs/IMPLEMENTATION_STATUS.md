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
