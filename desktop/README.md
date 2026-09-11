# Asgard CodeAudit — Desktop (Electron) foundation

Windows Electron shell that owns the local FastAPI backend and renders the
shared React UI. The renderer is sandboxed and reaches the backend only through
a narrow, allow-listed IPC bridge; the per-launch session secret never leaves
the main process.

## Structure
- `src/main.ts` — app lifecycle, single-instance lock (F09), window creation,
  backend startup/failure/retry/shutdown, IPC handlers with sender + argument
  validation.
- `src/preload.ts` — secure `contextBridge` exposing only `handshake`,
  `request`, and `selectFolder`.
- `src/ipc.ts` — pure allow-list + request validation (unit-tested).
- `src/backend-process.ts` — 127.0.0.1 ephemeral-port backend, per-launch secret
  over the private stdin pipe, readiness polling.
- `src/security.ts` — sandbox/contextIsolation, CSP, navigation lockdown.

## Local development (Windows or Linux/macOS dev host with a display)

```bash
# 1) Build the renderer in DESKTOP mode (excludes preview transport)
cd ../frontend
VITE_ASGARD_MODE=desktop npm run build      # outputs frontend/dist

# 2) Install and build the desktop shell
cd ../desktop
npm install                                 # downloads the Electron binary
npm run build

# 3) Run it (dev backend via uvicorn; set ASGARD_PYTHON if needed)
ASGARD_PYTHON=python \
ASGARD_BACKEND_DIR=../backend \
ASGARD_RENDERER=../frontend/dist/index.html \
npm start
```

For a packaged run, set `ASGARD_BACKEND_EXE` to the PyInstaller sidecar instead
of the Python dev command. Packaging (PyInstaller + electron-builder/NSIS) is
Phase 6 and is **not** part of this pass.

## Tests
```bash
npm test        # vitest — validates the IPC allow-list / bridge validation
```

## Unverified until exercised on Windows (open gates)
- Native launch, native folder dialog, loopback + stdin-secret handshake,
  single-instance behavior, CSP/sandbox enforcement in a real window.
  These require a Windows (or GUI) environment with the Electron binary and are
  **not** validated in the headless Linux preview.
