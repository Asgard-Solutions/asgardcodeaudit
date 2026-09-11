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

Verification environment key: **PY** = pytest on Python 3.11 (preview) **and** 3.13 (target); **UI** = live preview (Linux, labeled preview); **VT** = vitest; **WIN** = requires Windows/GUI + Electron binary (open gate, unverified here).

| ID | Requirement | Implemented | Verified (env) | Notes / remaining |
|---|---|---|---|---|
| F01 | Native launch + backend readiness/build identity | Yes | Backend readiness **PY/UI**; native launch **WIN (unverified)** | `startup/handshake` + boot screen verified in preview; Electron launch is G-1/G-2 |
| F02 | Startup failure → useful error + retry + diagnostics | Yes | Preview boot-error+retry **UI**; desktop dialog+retry **WIN (unverified)** | `main.ts` shows retry/quit dialog and respawns |
| F03 | Native selection + validated registration | Yes | Path validation + dedupe + overlap **PY**; register flow **UI**; native dialog **WIN (unverified)** | `dialog.showOpenDialog` wired via IPC; preview uses fixtures |
| F04 | Restart preserves projects/settings, no reseed | Yes | **PY** (`test_persistence_across_restart`) + **UI** | Alembic upgrade only; no seed on startup |
| F05 | Removal leaves source untouched | Yes | **PY** (`test_remove_registration_leaves_source_untouched`) + **UI** | DELETE removes row only |
| F06 | Missing/wrong API auth **and** invalid IPC senders rejected | Yes | API 401 **PY/UI**; origin 403 **PY/live curl**; IPC allow-list/validation **VT**; sender-frame check **WIN (unverified)** | `assertTrustedSender` runs only in a real Electron window |
| F07 | App-data / source-root separation | Yes | **PY** (`overlaps_app_data` both directions) | platformdirs app-data outside roots |
| F08 | Preview clearly labeled + desktop separation enforced | Yes | **PY/UI** (banner, fixture-only, dev/session 404 in desktop, mode select **VT**) | preview transport excluded from desktop build |
| F09 | One owner of the app-data directory | Yes | Backend flock **PY** (`test_single_instance`); Electron single-instance **WIN (unverified)** | both layers implemented |

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

---

## 4. Out of scope for Phase 1 (not added)
Scanning, inventory, rules, findings, prompt generation, LLM/provider calls, provider credentials, automatic repairs, backup/restore, publishing, production installer. None present.
