import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
} from "electron";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { IPC } from "./ipc";
import { startBackend, type BackendHandle } from "./backend-process";
import { secureWebPreferences, applyContentSecurityPolicy, lockDownNavigation } from "./security";
import {
  APP_SCHEME,
  APP_LAUNCH_URL,
  resolveAssetPath,
  mimeFor,
  isApprovedAuthority,
} from "./protocol";
import { Lifecycle, type LifecycleBackend } from "./lifecycle";
import { registerIpcHandlers, type RuntimeCtx } from "./app-runtime";

let mainWindow: BrowserWindow | null = null;
let backend: BackendHandle | null = null;

const RENDERER_DIST =
  process.env.ASGARD_RENDERER_DIST ?? path.join(__dirname, "..", "..", "frontend", "dist");
const BACKEND_DIR = process.env.ASGARD_BACKEND_DIR ?? path.join(__dirname, "..", "..", "backend");

// Custom, secure app:// scheme for packaged renderer assets.
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    if (!isApprovedAuthority(request.url)) return new Response("Forbidden", { status: 403 });
    const { pathname } = new URL(request.url);
    const filePath = resolveAssetPath(RENDERER_DIST, pathname);
    if (!filePath) return new Response("Forbidden", { status: 403 });
    try {
      const data = await readFile(filePath);
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: { "Content-Type": mimeFor(filePath) },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

// --- IPC wiring: real handlers from app-runtime, electron boundaries injected --
function backendUrl(p: string): string {
  return `http://${backend!.host}:${backend!.port}${p}`;
}

function buildRuntimeCtx(lifecycle: Lifecycle): RuntimeCtx {
  return {
    getBackend: () => (backend ? { host: backend.host, port: backend.port, secret: backend.secret } : null),
    getMainSender: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null),
    fetchImpl: (url, init) => net.fetch(url, init as Parameters<typeof net.fetch>[1]),
    openDirectory: async () => {
      if (!mainWindow) return { canceled: true, filePaths: [] };
      return dialog.showOpenDialog(mainWindow, {
        title: "Choose a source folder to register",
        properties: ["openDirectory"],
      });
    },
    retry: () => lifecycle.retry(),
    getUnavailableStatus: () => lifecycle.getUnavailableStatus(),
  };
}

function registerIpc(lifecycle: Lifecycle): void {
  registerIpcHandlers(ipcMain as unknown as Parameters<typeof registerIpcHandlers>[0], buildRuntimeCtx(lifecycle));
}

// --- Electron-backed lifecycle dependencies --------------------------------
function createLifecycle(): Lifecycle {
  return new Lifecycle({
    createWindow: () => {
      mainWindow = new BrowserWindow({
        width: 1280,
        height: 820,
        backgroundColor: "#0b0d10",
        show: false,
        webPreferences: secureWebPreferences(path.join(__dirname, "preload.js")),
      });
      lockDownNavigation(mainWindow);
    },
    destroyWindow: () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
      mainWindow = null;
    },
    startBackend: async (signal): Promise<LifecycleBackend> => {
      const handle = await startBackend({
        backendExe: process.env.ASGARD_BACKEND_EXE,
        pythonCmd: process.env.ASGARD_PYTHON ?? "python",
        backendDir: BACKEND_DIR,
        dataDir: app.getPath("userData"),
        signal,
      });
      backend = handle;
      return {
        stop: async () => {
          await handle.stop();
          if (backend === handle) backend = null;
        },
        recentLogs: () => handle.recentLogs(),
        onExit: (cb) => handle.onExit(() => cb()),
      };
    },
    loadAppAndShow: async () => {
      if (!mainWindow) throw new Error("No window to load.");
      await mainWindow.loadURL(APP_LAUNCH_URL);
      mainWindow.show();
    },
    fetchHandshake: async (signal) => {
      // Bounded + cancellable identity probe, same policy as the startup probes.
      if (!backend) throw new Error("The local analysis backend is unavailable.");
      const timeout = AbortSignal.timeout(3000);
      const combined = AbortSignal.any([signal, timeout]);
      const res = await net.fetch(backendUrl("/api/v1/startup/handshake"), { signal: combined });
      if (!res.ok) throw new Error(`handshake status ${res.status}`);
      return (await res.json()) as {
        status: string;
        name: string;
        version: string;
        source_revision: string | null;
        mode: string;
      };
    },
    showStartupErrorDialog: async (detail) => {
      const choice = await dialog.showMessageBox({
        type: "error",
        title: "Asgard CodeAudit — backend failed to start",
        message: "The local analysis backend did not start.",
        detail,
        buttons: ["Retry", "Quit"],
        defaultId: 0,
        cancelId: 1,
      });
      return choice.response === 0;
    },
    notifyUnavailable: (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.BACKEND_UNAVAILABLE, status);
      }
    },
    quit: () => app.quit(),
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  const lifecycle = createLifecycle();
  let cleanupDone = false;

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerAppProtocol();
    applyContentSecurityPolicy();
    registerIpc(lifecycle);
    void lifecycle.boot();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void lifecycle.boot();
    });
  });

  app.on("window-all-closed", () => {
    // Internal retry churn destroys windows without meaning an intentional quit.
    if (lifecycle.isRestarting()) return;
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    // Wait for bounded cleanup of the owned backend before the process exits.
    if (cleanupDone) return;
    event.preventDefault();
    void lifecycle.shutdown().finally(() => {
      cleanupDone = true;
      app.quit();
    });
  });
}
