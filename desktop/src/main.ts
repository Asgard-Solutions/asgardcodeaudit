import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  IPC,
  resolveOperation,
  validateBody,
  isTrustedFrame,
  IpcValidationError,
  ipcOk,
  ipcFail,
  type IpcResult,
} from "./ipc";
import { startBackend, type BackendHandle } from "./backend-process";
import { secureWebPreferences, applyContentSecurityPolicy, lockDownNavigation } from "./security";
import {
  APP_SCHEME,
  APP_ORIGIN,
  APP_LAUNCH_URL,
  resolveAssetPath,
  mimeFor,
  isApprovedAuthority,
} from "./protocol";
import { Lifecycle, type LifecycleBackend } from "./lifecycle";

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

// --- IPC sender validation -------------------------------------------------
// The sender must be the current top-level main frame of the owned window AND
// carry the exact approved application origin. Legitimate same-document route
// changes keep access; other windows, subframes, and unexpected authorities do not.
function isTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  if (!mainWindow || event.sender !== mainWindow.webContents) return false;
  const frame = event.senderFrame;
  const isMainFrame = !!frame && frame.parent === null;
  return isTrustedFrame(frame?.url, isMainFrame, APP_ORIGIN);
}

function backendUrl(p: string): string {
  return `http://${backend!.host}:${backend!.port}${p}`;
}

async function callBackend<T>(method: string, apiPath: string, body?: unknown): Promise<IpcResult<T>> {
  if (!backend) return ipcFail("The local analysis backend is unavailable.", 503, "backend_unavailable");
  let res: Response;
  try {
    res = await net.fetch(backendUrl(apiPath), {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${backend.secret}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return ipcFail("The local analysis backend is unavailable.", 503, "backend_unavailable");
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    return ipcFail("The backend returned a malformed response.", 502, "malformed_response");
  }
  if (!res.ok) {
    const detail = (data as { detail?: unknown } | undefined)?.detail;
    let message = `Request failed (${res.status}).`;
    let code: string | undefined;
    if (detail && typeof detail === "object") {
      const d = detail as { message?: unknown; code?: unknown };
      if (typeof d.message === "string") message = d.message;
      if (typeof d.code === "string") code = d.code;
    } else if (typeof detail === "string") {
      message = detail;
    }
    return ipcFail(message, res.status, code);
  }
  return ipcOk(data as T);
}

function registerIpc(lifecycle: Lifecycle): void {
  ipcMain.handle(IPC.HANDSHAKE, async (event): Promise<IpcResult<unknown>> => {
    if (!isTrustedSender(event)) return ipcFail("Rejected: untrusted sender.", 403, "untrusted_sender");
    return callBackend("GET", "/api/v1/startup/handshake");
  });

  ipcMain.handle(IPC.REQUEST, async (event, payload: unknown): Promise<IpcResult<unknown>> => {
    if (!isTrustedSender(event)) return ipcFail("Rejected: untrusted sender.", 403, "untrusted_sender");
    const { method, path: apiPath, body } = (payload ?? {}) as {
      method?: unknown;
      path?: unknown;
      body?: unknown;
    };
    try {
      const op = resolveOperation(method, apiPath);
      const validBody = validateBody(op, body);
      return await callBackend(op.method, apiPath as string, validBody);
    } catch (e) {
      if (e instanceof IpcValidationError) return ipcFail(e.message, 400, "ipc_validation");
      return ipcFail("The request could not be processed.", 500, "ipc_error");
    }
  });

  ipcMain.handle(IPC.SELECT_FOLDER, async (event): Promise<IpcResult<string | null>> => {
    if (!isTrustedSender(event)) return ipcFail("Rejected: untrusted sender.", 403, "untrusted_sender");
    if (!mainWindow) return ipcFail("No application window is available.", 500, "no_window");
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a source folder to register",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return ipcOk(null);
    return ipcOk(result.filePaths[0]);
  });

  ipcMain.handle(IPC.RETRY_BACKEND, async (event): Promise<IpcResult<unknown>> => {
    if (!isTrustedSender(event)) return ipcFail("Rejected: untrusted sender.", 403, "untrusted_sender");
    try {
      const identity = await lifecycle.retry();
      return ipcOk(identity);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return ipcFail(err?.message ?? "Recovery failed.", 503, err?.code ?? "recovery_failed");
    }
  });

  // Renderer announces it is listening; replay the current status if unavailable
  // (covers a crash that happened before the renderer subscribed).
  ipcMain.on(IPC.BACKEND_SUBSCRIBE, (event) => {
    if (!isTrustedSender(event)) return;
    const status = lifecycle.getUnavailableStatus();
    if (status) event.sender.send(IPC.BACKEND_UNAVAILABLE, status);
  });
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
    fetchHandshake: async () => {
      const res = await callBackend<{
        status: string;
        name: string;
        version: string;
        source_revision: string | null;
        mode: string;
      }>("GET", "/api/v1/startup/handshake");
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
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
