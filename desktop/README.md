# Desktop foundation

Electron owns a local FastAPI backend and serves the React build through `app://asgard/`. The sandboxed preload exposes typed application operations. Session credentials remain outside the renderer.

## Windows development

From the project root:

```powershell
.\scripts\start-desktop.ps1
```

Prerequisites are Node.js 24 and uv. The script uses the delivered npm and uv lockfiles, Python 3.13, absolute interpreter paths, checked command exit codes, and restores its environment variables when it exits.

## Tests

From `desktop/` after dependency setup:

```powershell
npm test
npm run build
npm run test:native
```

`npm test` runs the existing Vitest suites and startup-order regressions. The native command requires Windows, a desktop session, the built desktop renderer, and `backend/.venv` with Python 3.13 dependencies. It starts the real Electron application, automates its own native folder dialog, exercises registration/restart/recovery, and checks the synthetic source hash. It is not an installer test.

The preview browser test uses actual Chromium, the real backend, and a test-owned same-origin ingress:

```powershell
cd ..\frontend
$env:VITE_ASGARD_MODE = 'preview'
npm run build -- --outDir dist-preview
cd ..\desktop
npm run test:preview-browser
```

This does not certify a specific hosted preview deployment. Keep its host routing/access controls separate from application verification.

## Files

`src/main.ts` connects the application window, protocol, lifecycle, and IPC handlers. `src/app-runtime.ts` supplies the production handler registration used by connected tests. `src/lifecycle.ts` owns startup, cancellation, cleanup, recovery, and state publication. `src/backend-process.ts` supplies the bounded authenticated process startup. `src/ipc.ts` validates operations and serializes results. `src/preload.ts` is bundled by `build.mjs` for the renderer sandbox.

No generic shell, process-execution, or filesystem bridge is exposed. The source-auditing boundary remains read-only. A PyInstaller sidecar, installer, signing, provider credentials, and later scanning features are outside Phase 1.

See [the verification record](../docs/PHASE1_COMPLETION.md) for the actual Windows and Linux results. Historical statements that all native execution was unverified are superseded only for the specific scenarios recorded there.
