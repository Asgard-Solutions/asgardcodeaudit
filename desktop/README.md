# Asgard CodeAudit — Desktop (Electron) foundation

Windows Electron shell that owns the local FastAPI backend and renders the
shared React UI. The renderer is sandboxed and reaches the backend only through
a narrow, allow-listed IPC bridge; the per-launch session secret never leaves
the main process.

## Structure
- `src/main.ts` — app lifecycle, single-instance lock (F09), `app://` protocol,
  window creation, backend startup/failure/**retry without window/child
  accumulation**/shutdown, IPC handlers with sender-frame + operation + body
  validation.
- `src/preload.ts` — secure `contextBridge` exposing only `handshake`,
  `request`, `selectFolder`. Bundled (esbuild) so a sandboxed preload has no
  local runtime `require`.
- `src/ipc.ts` — pure **operation allow-list** (exact method+route+body) and
  `isTrustedFrame` (unit-tested).
- `src/protocol.ts` — `app://asgard/…` asset resolver (traversal-rejecting,
  SPA-fallback) (unit-tested).
- `src/backend-process.ts` — 127.0.0.1 ephemeral-port backend, per-launch secret
  over the private stdin pipe, **validated + bounded** readiness (identity +
  authenticated probe, per-request abort + overall deadline), idempotent stop.
- `src/security.ts` — sandbox/contextIsolation/nodeIntegration=false, CSP,
  navigation lockdown.

## Build artifacts
`npm run build` runs esbuild (→ `dist/main.js`, `dist/preload.js`, self-contained
CJS, `electron` external) then `tsc --noEmit` for type safety.

## Local development — Windows (PowerShell)

```powershell
# 1) Build the renderer in DESKTOP mode (excludes the preview transport/session path)
cd ..\frontend
$env:VITE_ASGARD_MODE = "desktop"
npm ci                     # uses package-lock.json
npm run build              # outputs frontend\dist

# 2) Backend interpreter (Python 3.13 with backend deps)
cd ..\backend
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt      # runtime + test deps
# (or: uv sync --locked   # uses backend\uv.lock)

# 3) Build + launch the desktop shell
cd ..\desktop
npm ci                     # downloads the Electron binary; uses package-lock.json
npm run build
$env:ASGARD_PYTHON       = "..\backend\.venv\Scripts\python.exe"
$env:ASGARD_BACKEND_DIR  = "..\backend"
$env:ASGARD_RENDERER_DIST = "..\frontend\dist"
npm start
```

For a packaged run set `$env:ASGARD_BACKEND_EXE` to the PyInstaller sidecar
instead of `ASGARD_PYTHON`. Packaging (PyInstaller + electron-builder/NSIS) is
Phase 6 and is **not** part of this pass.

## Tests (Node 24)
```powershell
npm test        # vitest: IPC allow-list, app:// resolver, backend lifecycle
```

## Lockfiles
`desktop/package-lock.json`, `frontend/package-lock.json`, `backend/uv.lock`.

## Unverified until exercised on Windows (open gates)
Native launch, native folder dialog, sandbox/CSP/IPC-sender enforcement in a
real window, single-instance focus, PyInstaller sidecar, NSIS installer. These
require Windows + the Electron binary and are **not** validated in the headless
Linux preview. `npm test` exercises the pure logic and the backend lifecycle as
real Node child processes, not a real Electron window.
