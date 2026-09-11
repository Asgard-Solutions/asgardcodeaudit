# Asgard CodeAudit — Implementation Status (docs/IMPLEMENTATION_STATUS.md)

**Prepared:** June 2026.
**Current state:** **Phase 0 complete (planning only).** No application source, dependencies, credentials, or builds exist yet. Nothing has been scaffolded.
**Next action:** await user approval of this plan, then send the Phase 1 prompt from `04_PHASE_PROMPTS.md`.

---

## 1. Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture, dependency/version assessment, interface definitions, environment limits, contradictions, Phase 1 task plan | **Done** (this document + `docs/DECISIONS.md`) |
| 1 | Desktop foundation, SQLite, project registration | Planned (tasks below) — **not started** |
| 2 | Safe snapshot + real inventory | Planned |
| 3 | Rules, evidence, findings | Planned |
| 4 | OpenAI + LM Studio providers | Planned |
| 5 | Prompt Studio, comparison, evidence exchange | Planned |
| 6 | Recovery, installer, release validation | Planned |

**Read-only invariant (all phases):** the app writes only its own DB/snapshots/reports/exports; it never mutates, executes, installs, commits, pushes, or deploys audited repositories.

---

## 2. Proposed repository layout (target)

```
asgard-codeaudit/
  README.md
  package.json                # npm workspaces root
  package-lock.json
  .github/workflows/ci.yml
  .github/workflows/windows-release.yml
  apps/
    desktop/   src/{main.ts,preload.ts,ipc.ts,backend-process.ts,security.ts}  electron-builder.yml
    web/       src/{app,features/*,transport/{desktop.ts,preview.ts},components}
    backend/   pyproject.toml  uv.lock  app/{main,api,storage,projects,snapshots,indexing,rules,evidence,providers,prompts,reports,jobs,security,diagnostics}  migrations/  tests/
  packages/contracts/          # shared typed transport contract (FE/BE/desktop)
  rule-packs/                  # data-only versioned rules
  prompt-templates/            # versioned templates
  fixtures/repositories/       # labeled synthetic audit fixtures
  scripts/{build-windows.ps1,smoke-installed.ps1}
  tests/e2e/
  docs/{DECISIONS.md,DEPENDENCIES.md,IMPLEMENTATION_STATUS.md,BUILD_AND_RELEASE.md,SECURITY_AND_PRIVACY.md}
  docs/superpowers/{specs,plans}/
```

Emergent may propose a small structural change in Phase 0 but must not silently switch architecture or database. **No change proposed** — the layout is adopted as-is. In the preview environment this maps under the platform root; the CRA scaffold is replaced in Phase 1 (PA-5).

---

## 3. Interface definitions (target contracts)

### 3.1 Backend API (versioned, mounted under `/api` for preview parity — see DECISIONS PA-1/C-2)
| Family | Responsibility (Phase) |
|---|---|
| `/api/health`, `/api/build`, `/api/diagnostics` | Readiness, schema/build identity, redacted dependency/process status (1) |
| `/api/v1/projects`, `/projects/{id}` | Register/update/archive approved roots + metadata; no source deletion (1) |
| `/api/v1/projects/{id}/constraints` | User-approved architecture/business constraints w/ revisions (1–2) |
| `/api/v1/projects/{id}/inventory` | Evidence-backed component/file inventory (2) |
| `/api/v1/audits`, `/audits/{id}`, `/events`, `/coverage`, `/compare` | Preflight/create/progress/state/cancel/resume; events cursor; coverage; baseline compare (2–5) |
| `/api/v1/findings`, `/findings/{id}` | Read/filter findings, reviewed dispositions (3) |
| `/api/v1/evidence/{id}` | Bounded redacted evidence excerpt + provenance (not arbitrary paths) (3) |
| `/api/v1/rules`, `/rule-packs` | Versioned rule metadata, data-only imports, overrides (3) |
| `/api/v1/providers`, `/providers/{id}/test` | Nonsecret config, credential replacement, model/capability tests (4) |
| `/api/v1/prompts`, `/exports` | Versioned prompt generation, approved outputs (5) |
| `/api/v1/evidence-imports` | Size-limited supported report imports w/ provenance (5) |
| `/api/v1/backups`, `/restore` | App-data backup + explicit restore (6) |

OpenAPI and frontend types generated from the same schemas (`openapi-typescript`). All production endpoints require session auth except the narrow startup handshake. **No general run-command endpoint ever.**

### 3.2 Desktop interface (Electron)
- `main.ts`: owns backend child process lifecycle; validates every IPC sender/argument; retains the authenticated loopback transport.
- `preload.ts`: exposes a narrow, typed, allowlisted API only — no arbitrary HTTP, FS, or shell.
- `backend-process.ts`: spawns the FastAPI sidecar bound to `127.0.0.1:<ephemeral>`, passes a per-launch secret via a private pipe (never argv/URL/log/config), waits for readiness + build identity before enabling scans.
- `security.ts`: enforces `sandbox`, `contextIsolation`, CSP, navigation/window restrictions, single-instance app-data lock.

### 3.3 Transport contract (`packages/contracts/`)
One typed request/response contract implemented by `transport/desktop.ts` (IPC→loopback) and `transport/preview.ts` (same-origin `${REACT_APP_BACKEND_URL}/api/...`). Preview adapter excluded from desktop builds.

---

## 4. Phase 1 — independently testable tasks (proposed, NOT started)

**User outcomes (only these):**
1. Launch the desktop app and see backend readiness or a useful startup error.
2. Register a local source folder via a native directory picker.
3. Restart and find saved projects in local SQLite.

| Task | Exact files | Tests | Verifiable in preview? |
|---|---|---|---|
| T1 Backend app + health/build/diagnostics | `apps/backend/app/main.py`, `app/api/diagnostics.py`, `app/diagnostics/` | `tests/test_health_build.py` | Yes |
| T2 SQLite storage + Alembic baseline (projects, project_settings) | `app/storage/`, `apps/backend/migrations/` | `tests/test_migrations.py` (up/down, FK on) | Yes |
| T3 Project registration + canonical path validation | `app/projects/`, `app/api/projects.py` | `tests/test_projects.py` (register/list/archive, persistence), path rejection cases | Yes (logic); native picker = **G-3** |
| T4 App-data separation invariant | `app/storage/paths.py` (platformdirs) | part of `test_projects.py` (reject root nested in/around app-data) | Yes |
| T5 Local API session auth + startup handshake | `app/security/auth.py`, wired in `main.py` | `tests/test_local_api_auth.py` (missing/wrong token rejected) | Partial — token logic yes; IPC sender validation = **G-1** |
| T6 Electron shell + secure boundary | `apps/desktop/src/{main.ts,preload.ts,ipc.ts,backend-process.ts,security.ts}`, `electron-builder.yml` | `npm run test:desktop` (Playwright-Electron) | **No — G-1/G-2/G-3** |
| T7 Transport contract + adapters | `packages/contracts/`, `apps/web/src/transport/{desktop,preview}.ts` | contract unit tests (vitest) | Yes (preview path); desktop path = G-1 |
| T8 React shell + screens (Overview, Projects, Project Settings, Diagnostics) with real empty/loading/error states | `apps/web/src/app/`, `src/features/projects/`, `src/components/` | `tests/e2e/projects.spec.ts` (register→persist→reopen) | Yes (against preview transport) |
| T9 Preview fixture selector, explicitly labeled | `apps/web/src/features/projects/PreviewFixtureNotice.tsx`, `apps/backend/app/projects/fixtures.py` | e2e asserts the "preview fixture — not your machine" label | Yes |

**Phase 1 acceptance mapping** (`05_ACCEPTANCE_TESTS_AND_TRACEABILITY.md`): F01 (native launch) → **G-1/G-2 open**; F02 (startup failure UX) → preview-simulable + desktop gate; F03 (register folder) → logic in preview, native picker **G-3**; F04 (restart persists, no duplicate seeding) → preview Yes; F05 (remove registration, source untouched) → preview Yes; F06 (unauthorized API/IPC rejected) → API in preview, IPC **G-1**; F07 (app-data separation) → preview Yes; F08 (preview vs desktop labeling) → preview Yes; F09 (single app-data owner) → **G-2 open**.

**Explicitly out of Phase 1:** scanning, inventory, rules, findings, providers/LLM, prompts, exports, backup/restore, installer. No login, billing, cloud DB, or repository execution.

---

## 5. Verification gates carried forward

Open gates G-1…G-11 are defined in `docs/DECISIONS.md §6`. They remain **Not verified** and must be reported as such in every phase report. A preview run, screenshot, or mock never closes a Windows/LAN/live-provider/signing gate. Windows build scripts (`scripts/build-windows.ps1`, `scripts/smoke-installed.ps1`) and reproducible validation steps are delivered in Phase 6.

---

## 6. What was explicitly NOT done in Phase 0
- No app scaffold, no code in `apps/`, no `package.json`/`pyproject.toml`, no migrations.
- No dependency installation; no locked/transitive manifest, license set, or SBOM produced.
- No credentials provisioned; no OpenAI/LM Studio calls (mock or live).
- No Windows build, installer, or LAN connection attempt.
- No changes to any audited repository.

**Stop point:** Phase 0 planning delivered. Awaiting approval before Phase 1.
