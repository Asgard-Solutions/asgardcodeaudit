# Asgard CodeAudit — Decisions (docs/DECISIONS.md)

**Document type:** Phase 0 planning record. No application code, dependencies, credentials, or builds were produced.
**Prepared:** June 2026 (Phase 0).
**Source of truth:** `01_PRODUCT_AND_TECHNICAL_SPEC.md` plus the user-approved decisions recorded here.
**Scope of this iteration:** Phase 0 only — architecture, dependency/version assessment, interface definitions, environment limitations, contradictions, and the Phase 1 task plan. **No scaffolding, no features, no credentials, no paid API calls, no Phase 1.**

---

## 1. User-approved decisions (this session)

These were explicitly confirmed by the user and override any platform default. They do **not** reopen because another stack is the platform default.

| # | Decision | Status |
|---|---|---|
| UD-1 | Read the full attached reference (all six original docs) before planning; do not proceed from the handoff summary or substitute defaults. | Applied |
| UD-2 | This iteration is **Phase 0 planning only**. Produce architecture, dependency/version assessment, FE/BE/desktop interfaces, environment limits, Phase 1 tasks. Create/update `docs/DECISIONS.md` and `docs/IMPLEMENTATION_STATUS.md`. Stop for review. | Applied |
| UD-3 | Final product stays a **Windows Electron desktop app** with a bundled local FastAPI backend and local SQLite. The web preview is a **development harness only**, not the deliverable. Same React UI, backend logic, DB schema, and audit engine in both modes; environment differences live behind clearly defined adapters. Electron main/preload, native folder picker, backend lifecycle, and desktop security boundaries are part of the Phase 1 foundation — **not deferred**. Preview uses clearly labeled synthetic fixtures scanned through the real backend; no fabricated findings. Windows packaging/install/native FS/LAN remain **unverified** until exercised on the right environment. A working preview does **not** satisfy Windows release gates and must not be replaced by a hosted website. | Applied to plan |
| UD-4 | **Storage = SQLite** with SQLAlchemy + Alembic in **both** preview and desktop backends, from the first persistence implementation. No MongoDB (even temporarily), no separate preview/desktop databases, no later Mongo→SQLite conversion. If an environment restriction blocks SQLite, document the actual restriction; do not substitute a DB without approval. | Applied to plan |
| UD-5 | **LLM = Option A for now**: plan static discovery/audit first, no LLM required. Keep both providers in scope for the later provider phase — OpenAI via the user's **own** API key through the official integration, and LM Studio via a configurable endpoint/model. **Do not** use the Emergent Universal Key or make the installed app depend on it. AI Server host is `192.168.1.100`; port/model unconfirmed and must stay configurable — no assumed port, no public exposure, no tunnel from preview to the LAN. Mocked provider tests are separate from live tests; an unavailable live test stays unverified. Static auditing works without any provider; LM Studio failure never auto-switches to OpenAI. | Applied to plan |
| UD-6 | **v1 read-only boundary** kept: the app may write its own DB, snapshots, reports, and exported prompts; it must not modify audited repos, execute their scripts/tests/builds, install their deps, commit, push, deploy, or perform external business actions. | Applied to plan |

---

## 2. Architecture decisions (from the specification, retained)

| ID | Decision | Rationale / spec ref |
|---|---|---|
| AD-1 | **Desktop shell = Electron** (main + sandboxed renderer + narrow typed preload bridge), packaged with electron-builder/NSIS. Renderer settings mandatory: `nodeIntegration=false`, `contextIsolation=true`, `sandbox=true`, restrictive CSP, no arbitrary navigation/new windows, no generic shell/FS IPC bridge, sender validation on every IPC message. | Spec §3, §13 [S05] |
| AD-2 | **Frontend = React 19 + TypeScript + Vite + Tailwind + shadcn/ui**, React Router, TanStack Query/Table/Virtual, Zod, react-hook-form, sonner, CodeMirror (read-only evidence), react-markdown (raw HTML disabled; no `rehype-raw`). | Spec §3, Deps §3 |
| AD-3 | **Backend = Python + FastAPI + Uvicorn (single worker) + Pydantic + SQLAlchemy + Alembic**, persistent app-owned scan queue, serialized DB writes, one active audit at a time. | Spec §3, §6, §11 |
| AD-4 | **Database = SQLite only** (local fixed drive, backend-only access). FK on, short transactions, bounded busy timeout, serialized writes. Validate the *actually bundled* SQLite version before selecting WAL. | Spec §12 [S03,S04,S06] (UD-4) |
| AD-5 | **Transport abstraction:** one documented, typed transport contract in `packages/contracts/`, implemented by two adapters — `transport/desktop.ts` (Electron IPC → authenticated 127.0.0.1 loopback backend, per-launch secret via private process pipe) and `transport/preview.ts` (authenticated same-origin preview API). The preview adapter is excluded from production desktop builds. | Spec §3 (UD-3) |
| AD-6 | **Two runtime modes via a mode flag** (e.g. `ASGARD_MODE=desktop|preview`). Desktop: backend bound to `127.0.0.1` on an ephemeral port, launched/owned by Electron main, per-launch auth secret over a private pipe. Preview: backend runs as the platform-supervised service and the browser calls it over the same origin. Identical routers, schema, engine. | Spec §3 (UD-3) |
| AD-7 | **Credentials** live only in the OS credential store via a validated `keyring` backend. Never in renderer, SQLite, logs, source, exports, or `VITE_*`. No plaintext fallback — where no secure store exists, offer session-only or report "persistent secret storage unavailable". | Spec §9, §13, Deps §3 (UD-5) |
| AD-8 | **No fallback / no execution:** no automatic LM Studio→OpenAI fallback; no execution of audited code, scripts, tests, builds, installs; imports never execute their contents. | Spec §2, §9 (UD-5, UD-6) |
| AD-9 | **Packaging:** PyInstaller builds the backend sidecar **on Windows**; electron-builder produces the NSIS installer. A Linux/preview build does not prove Windows packaging. | Spec §16, Deps §2 [S12] |
| AD-10 | **Single backend, single DB.** No microservices, Celery, Redis, Kubernetes, cloud DB, vector DB, or agent framework. | Spec §3, §16 |

---

## 3. Preview-harness adapter decisions (environment-specific, non-destructive)

The Emergent preview environment differs from the Windows target in concrete ways. To honor UD-3 ("same code, differences behind adapters"), the following adapter decisions apply to the preview harness **only** and do not change the desktop deliverable.

| ID | Preview reality | Adapter decision |
|---|---|---|
| PA-1 | Ingress routes only `/api/*` to the backend; backend must listen on `0.0.0.0:8001`; frontend must call `REACT_APP_BACKEND_URL`. | Mount all backend routes under `/api` (versioned `/api/v1/...`, plus `/api/health`, `/api/build`, `/api/diagnostics`). Preview transport builds requests as `${REACT_APP_BACKEND_URL}/api/v1/...`. Desktop keeps the same paths over loopback. The `/api` prefix is a base-path config value, not two code paths. |
| PA-2 | No Electron in preview → no IPC, no native picker, no per-launch pipe secret. | Preview transport uses an authenticated same-origin session token issued by the backend's dev handshake. The "folder picker" in preview is a **synthetic fixture selector** clearly labeled "Preview fixture — not your machine". Native picker + IPC sender validation remain **open Windows gates** (see §6). |
| PA-3 | Preview container has **no OS credential store** (`secret-tool`/`gnome-keyring` absent). | Phase 4 provider credentials in preview = **session-only**, explicitly labeled; persistent storage reported "unavailable". No plaintext fallback (AD-7). Windows credential-store persistence stays an **open gate**. |
| PA-4 | Preview cannot reach the private LAN AI Server (`192.168.1.100`), and must not tunnel to it. | LM Studio live connectivity is an **open gate**, tested only from the installed desktop backend on the user's LAN. Preview runs mocked provider contract tests only. |
| PA-5 | Platform default frontend is CRA (react-scripts, JS, `REACT_APP_BACKEND_URL`); default DB is MongoDB. | Phase 1 replaces the CRA scaffold with the spec's Vite + TypeScript monorepo and uses SQLite (UD-4). The MongoDB service is left unused. `REACT_APP_BACKEND_URL` is still honored by the preview transport adapter. |
| PA-6 | Platform prefers `yarn`; spec prefers npm workspaces + `package-lock.json`. | Follow the **spec** for the deliverable repo: npm workspaces + committed `package-lock.json` + `uv.lock`, since the artifact ships from the user's own Git repo and Windows CI. Document this as an intentional deviation from the platform default. |

---

## 4. Genuine contradictions / tensions and recommended resolutions

These are surfaced rather than silently resolved, per the initial prompt.

| ID | Tension | Recommendation |
|---|---|---|
| C-1 | **Desktop loopback+IPC security vs preview web transport.** Spec §3 mandates 127.0.0.1 binding, ephemeral port, per-launch pipe secret, and sender-validated IPC. The preview has none of these. | Not a spec defect — resolve via AD-5/AD-6 mode+transport adapters. Explicitly mark IPC sender validation, loopback binding, and the pipe secret as **verified only on desktop** (open gates G-1, G-2). Do not claim preview verified them. |
| C-2 | **Endpoint table lists `/health`, `/build`, `/diagnostics` without `/api`** (Spec §11), but preview ingress only forwards `/api/*`. | Mount everything under `/api` (PA-1). In desktop mode the loopback backend can serve any path, so the `/api` prefix is harmless and kept for parity. Keep the `/api/v1` version segment for domain routes. |
| C-3 | **Python 3.13 (spec) vs 3.11.16 (preview).** Deps §2 targets CPython 3.13 for release. | Develop/test backend on the available interpreter; pin the **release** target to a validated 3.13 patch during Phase 6 Windows packaging. Avoid 3.13-only syntax in Phase 1–5 so the code runs on both. Record actual runtime in Diagnostics/`build-info.json`, never a README claim (Deps §9). Note: `tomllib` exists in 3.11+, so stdlib parsing is fine. |
| C-4 | **Node 24 LTS (spec) vs Node 20.20.2 (preview).** | Same approach: build/test on available Node in preview; pin a validated Node 24 LTS patch for the Windows build. Choose Vite/electron-vite/electron-builder versions compatible with both. Validate before pinning (Deps §9). |
| C-5 | **SQLite version validation + WAL.** Spec §12 requires validating the *bundled* SQLite before choosing WAL; preview Python bundles 3.40.1, but the Windows PyInstaller runtime will bundle a different build. | Do **not** assume the Python minor version fixes the SQLite patch level. Default journaling decision deferred: start with a conservative rollback-journal + bounded busy timeout; evaluate WAL only after confirming the *packaged* SQLite version against upstream advisories (Phase 6). WAL is unsuitable for network FS; v1 is local-only, so WAL is permissible if the packaged version qualifies. |
| C-6 | **No OS credential store in preview vs "no plaintext fallback".** | Correct behavior per AD-7/PA-3: session-only or "unavailable". This is the intended design, not a contradiction to resolve — it only means credential **persistence** cannot be verified in preview (gate G-5). |
| C-7 | **PyInstaller on Linux aarch64 preview vs Windows x64 sidecar.** Preview OS is Linux and CPU is **aarch64**; the target is Windows x64. | Windows sidecar can only be built on a Windows x64 machine/CI runner (Deps §2 [S12]). Preview cannot cross-build it. Mark as open gate G-7 with reproducible `scripts/build-windows.ps1` instructions delivered in Phase 6. |
| C-8 | **`electron-builder` NSIS docs body not retrievable during research** (noted in Sources). | Treat exact NSIS config keys and installer behavior as a Phase 0/6 validation item; do not infer verified installer behavior. Open gate. |
| C-9 | **Read-only boundary vs "import execution evidence".** v1 is read-only wrt source but imports JUnit/SARIF/build manifests. | No conflict: importing files is not executing them. Enforce safe parsing (`defusedxml`, safe JSON/YAML with size/depth/entity limits), provenance labels, and "imported ≠ independently verified". |

No contradiction justifies changing a technology or the SQLite/desktop decisions. None found that requires user action beyond acknowledging the open gates.

---

## 5. Dependency & version assessment

**Method:** `02_DEPENDENCIES_AND_BUILD.md` is the *planned direct* inventory. Exact resolved direct+transitive versions, platform wheels, checksums, licenses, and SBOMs are produced **during implementation** (Deps §9), not invented here.

### 5.1 Measured preview environment (read-only inspection, June 2026)

| Item | Observed in preview | Spec/release target | Note |
|---|---|---|---|
| OS / arch | Linux, **aarch64** | Windows 11 x64 | Cross-OS+arch → Windows build is an open gate (C-7) |
| Python | 3.11.16 | 3.13 x64 | Keep code 3.11-compatible; pin 3.13 at packaging (C-3) |
| SQLite (via python `sqlite3`) | 3.40.1 | validate packaged build | Do not carry this number to the Windows artifact (C-5) |
| Node | 20.20.2 | 24 LTS | Build/test on 20 in preview; pin 24 for release (C-4) |
| npm / yarn | npm 10.8.2 / yarn 1.22.22 | npm workspaces | Use npm per spec (PA-6) |
| Git | 2.39.5 | Git for Windows | Optional capability; ordinary folder inventory works without it |
| OS credential store | **absent** (`secret-tool`, `gnome-keyring` not found) | Windows Credential Manager | Session-only in preview; persistence is a gate (C-6, G-5) |
| gitleaks / osv-scanner | **not installed** | optional adapters | Show "Not installed"; never auto-download (Deps §6) |

### 5.2 Planned direct dependencies by phase (from Deps §3–§5)

- **Phase 1 (FE):** react, react-dom, typescript, vite, @vitejs/plugin-react, tailwindcss + integration, shadcn/ui source + used @radix-ui/*, class-variance-authority, clsx, tailwind-merge, lucide-react, react-router-dom, @tanstack/react-query, zod, react-hook-form, @hookform/resolvers, sonner, electron, electron-vite, @types/*, openapi-typescript.
- **Phase 1 (BE):** fastapi, uvicorn, pydantic, pydantic-settings, sqlalchemy, alembic, stdlib sqlite3, platformdirs. (psutil enters Phase 2.)
- **Phase 2:** pathspec, PyYAML, defusedxml, tree-sitter + tree-sitter-javascript + tree-sitter-typescript, psutil. (Python parsing uses stdlib `ast` — no target import.)
- **Phase 3:** @tanstack/react-table, @tanstack/react-virtual, @uiw/react-codemirror + CodeMirror language packs. Optional binaries: Gitleaks, OSV-Scanner (never bundled silently).
- **Phase 4:** httpx, openai (official SDK, Responses API, `store=false`), keyring (validated Windows backend).
- **Phase 5:** react-markdown, remark-gfm (raw HTML disabled; no rehype-raw), jinja2 (escaped reports), python-multipart (only if multipart endpoints exist), defusedxml (reused).
- **Phase 6:** pyinstaller + hooks, electron-builder.
- **Quality/supply-chain:** pytest (+asyncio,+cov), respx, ruff, mypy; vitest, jsdom, @testing-library/*, @playwright/test, @axe-core/playwright, eslint + TS/React plugins; cyclonedx-py, @cyclonedx/cyclonedx-npm.

**Acceptance requirement (Deps §9):** commit `package-lock.json` + `uv.lock`; frozen/locked installs in CI (`uv sync --locked`); record license/source/hash for any redistributed binary (Gitleaks, OSV-Scanner); generate SBOMs; validate the packaged SQLite against advisories. Runtime versions in Diagnostics reflect the built artifact.

---

## 6. Testability matrix — what this environment can vs cannot verify

### Verifiable in the Linux preview harness
- Backend unit/integration (pytest): SQLite models, Alembic up/down migrations, FK enforcement, serialized writes.
- Project registration + canonical-path validation (traversal/symlink/junction/device rejection, app-data-outside-source invariant).
- Snapshot bounds/consistency, inventory profiles, jobs/checkpoints/cancellation against **labeled synthetic fixtures**.
- Rule engine, evidence-location validation, finding status/lifecycle/coverage arithmetic.
- Prompt generation, baseline comparison, SARIF/JUnit/build-manifest **import parsing** (safe-parse), report exports (MD/TXT/JSON/escaped HTML).
- Mocked provider contract tests (respx) with clearly-labeled mocks.
- Web UI flows via Playwright against the **preview** transport.

### Open gates — require Windows and/or the user's LAN (cannot be closed in preview)
| Gate | What it covers |
|---|---|
| G-1 | Electron main/preload/IPC + sender validation; renderer sandbox/contextIsolation/CSP enforcement |
| G-2 | 127.0.0.1 loopback backend, ephemeral port, per-launch secret via private pipe, single-instance app-data lock |
| G-3 | **Native Windows folder picker** and its agreement with server-side canonical checks |
| G-4 | PyInstaller **Windows x64** backend sidecar build |
| G-5 | Windows **credential store** persistence (keyring) with key absent from SQL/logs/exports/renderer |
| G-6 | electron-builder **NSIS installer**, clean-machine install/launch, upgrade, uninstall data-retention |
| G-7 | Windows build machine/CI cross-build (preview is Linux aarch64) |
| G-8 | **Live LM Studio** reach to `192.168.1.100:<port>` over LAN + real model inference readiness |
| G-9 | **Live OpenAI** credential acceptance, model/capability, real usage/billing |
| G-10 | Code signing / signed release |
| G-11 | Measured performance envelope (file counts, bytes, timing, memory) on real hardware |

These stay **Not verified** (not Not applicable) until exercised. A screenshot or preview run does not close them.

---

## 7. Open questions for the user (do not block Phase 0 review)

1. Confirm the deliverable repo root name `asgard-codeaudit/` and that the preview harness may live at the platform root (`/app`) mapping to that layout.
2. Confirm intentional deviation from platform defaults: **npm workspaces + Vite + TypeScript** (not yarn/CRA) and **SQLite** (not MongoDB). (Aligned with UD-4/PA-5/PA-6 — confirming for the record.)
3. For eventual live tests (Phase 4/6): who runs the Windows machine / CI runner and the LAN test against `192.168.1.100`, and is code signing in scope?
4. Confirm the working name "Asgard CodeAudit" stays isolated in one app-metadata module (Spec §Working name).
