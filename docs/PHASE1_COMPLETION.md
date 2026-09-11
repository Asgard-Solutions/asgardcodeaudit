# Phase 1 completion and verification record

Date: September 11, 2026.
Scope: Electron desktop foundation, local FastAPI/SQLite persistence, and project registration. This is not a release of the later source-scanning product or a self-contained Windows installer.

## Delivered changes

The remaining immediate startup/shutdown race is corrected. Initial launch requests share one operation, terminal state stays terminal, and cancellation is checked after awaited cleanup and before creating a window or backend. Startup ownership is registered before the starter runs. The earlier deferred-cleanup, late-handshake, and current-attempt-exit corrections remain in place.

The preview transport now uses relative same-origin `/api/v1/` requests. It no longer sends a session request to another deployment's `REACT_APP_BACKEND_URL`. Session/identity responses are validated, request and body-reading deadlines are bounded, and failures produce typed errors. Ambiguous failed mutations are not automatically replayed. CORS, desktop IPC permissions, and backend authentication were not broadened.

The actual solver-generated `backend/uv.lock` is delivered. Both npm lockfiles are delivered as well. Clean validation checks the uv lock before using `--frozen`, and npm uses `ci`.

Affected desktop and test dependencies were updated and resolved into the locks: Electron 44.3.0, esbuild 0.28.2, Vitest 4.1.11, Vite 8.3.0, React plugin 6.1.1, and React Router 7.18.3. Both npm dependency trees reported zero known advisories in the recorded run. That is a dated advisory check, not a claim of vulnerability-free software; Python advisories were not separately audited in this pass.

The checked Windows entrypoint is `scripts/start-desktop.ps1`. It uses Node 24, obtains Python 3.13 through uv, resolves absolute backend paths, builds from the delivered locks, checks command exit codes, and restores its environment settings.

## Evidence baseline

The full code candidate `ba01bfadff10be35ba2aec002c28cb3b6dd01345` passed the Windows and Linux jobs in:

https://github.com/Asgard-Solutions/asgardcodeaudit/actions/runs/34636430786

Runner versions: Node 24.20.0, Python 3.13.15. The native test used Electron 44.3.0 on the GitHub-hosted Windows Server 2025 runner. This is actual Windows/Electron execution, not a modeled Electron test. It is not validation on Jake's own Windows computer.

The final branch and merged revision must also pass the `Phase 1 validation` workflow; consult the run associated with that exact revision. The baseline above remains a reproducible historical evidence reference rather than a moving claim about future revisions.

### Automated checks, per Windows/Linux job

| Suite | Passed | Failed | Skipped cases |
|---|---:|---:|---:|
| Backend internal pytest | 24 | 0 | 0 |
| Desktop Vitest | 53 | 0 | 0 |
| Node startup-order regressions | 6 | 0 | 0 |
| Frontend Vitest | 9 | 0 | 0 |
| Node preview-transport regressions | 7 | 0 | 0 |

There are 99 test cases per platform. Native/browser scenario checks are additional and are not included in that count. External hosted-preview pytest is deliberately excluded. Windows-only workflow steps are skipped on Linux; those skips are not native verification.

Both jobs passed clean lock checks, dependency installation, TypeScript/build steps, and npm advisory gates. Test failures are separate workflow steps; a later successful build cannot conceal an earlier failing test command.

### Actual Windows native scenarios

The test launches the compiled production main process, bundled preload, desktop renderer, and real Python backend with isolated application data and a synthetic source folder whose name contains spaces.

Observed passing scenarios: initial `app://asgard/` boot and identity; sandbox/context isolation enabled and Node integration disabled; no renderer `require`; an unapproved operation rejected through the live IPC bridge; actual OS folder-dialog cancellation and selection; UI project registration; typed duplicate-registration rejection; Settings/Diagnostics navigation, back/forward and full renderer reload; second-instance handling; killing only the test-owned Python backend, receiving the unavailable state, and recovering through Retry; a separate Electron-process restart with the same saved project; and removal of that registration without changing its source file.

The real folder dialog is automated through Windows UI Automation and its owned Win32 confirmation control. The application result is not mocked.

Synthetic source SHA-256 before and after:

`717f49c2bd2c8a633da46e6b0b4bc515c9db7e3698c44fe1f5a9570b63920e16`

Evidence artifact: `phase1-evidence-windows-latest`, containing `native-windows/create.json`, `restart.json`, `summary.json`, logs, and native screenshots.

### Actual preview browser

A real Chromium window, without the desktop preload, loads the generated preview build and talks to the real Python backend through a test-owned same-origin ingress. The build deliberately supplies a bogus external backend URL; all observed API requests still use the page's actual origin. Boot, preview labeling, absence of `window.asgard`, approved-fixture selection, and registration pass.

This confirms the application path in that real-browser environment. It does not certify the current hosted Emergent tenant, its access controls, or its ingress configuration.

## F01-F09 disposition

| Requirement | Evidence and limits |
|---|---|
| F01 Native launch and identity | Actual Windows main/preload/renderer and real backend launch pass. A packaged PyInstaller executable is later-phase work. |
| F02 Useful failure, retry, cleanup | Controller/real-child failure, cancellation and deadline tests pass; actual Windows post-readiness crash and recovery pass. A native startup-failure dialog was not separately UI-automated. |
| F03 Native registration | Real folder selection/cancel and UI registration pass; duplicate/path-validation checks pass. |
| F04 Restart persistence | Separate native Electron processes retain the same saved project; SQLite restart tests pass. |
| F05 Removal without source changes | Native removal plus before/after source hash and backend nonmutation test pass. |
| F06 API/IPC boundary | Backend auth and production-handler negative tests pass; live IPC rejects an unapproved operation; sandbox preferences and absence of Node in the renderer are checked. This is not a comprehensive penetration test or exhaustive native frame/CSP attack matrix. |
| F07 App-data separation | Backend overlap/path tests pass on Windows and Linux; native tests keep source and app data separate. |
| F08 Preview separation | Real Chromium preview has no desktop bridge, uses fixture-only backend rules and same-origin requests; desktop-mode renderer builds separately. Hosted tenant deployment remains outside this evidence. |
| F09 Single owner | Backend lock tests pass and actual Windows second-instance handling passes. |

## Run and revalidate

From the project root in PowerShell, run `.\scripts\start-desktop.ps1`. Node 24 and uv are prerequisites. Use `-Validate` to execute the automated suites and native synthetic smoke instead of a normal launch.

The native test briefly focuses its own folder dialog and sends keyboard input; do not operate other applications during that automation.

## Not delivered in this phase

No source scanning, inventory, findings, LLM/provider calls, prompt generation, backups, automatic source changes, installer, code signing, or publishing was added. PyInstaller/NSIS, clean installed-app upgrades/uninstalls, provider credentials, live OpenAI/LM Studio connections, performance characterization, and broader security validation retain their original later-phase gates.

Historical Emergent review records remain available in the earlier source revisions. Their passing claims are not substituted for the actual runs identified here.
