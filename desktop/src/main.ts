import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  type IpcMainInvokeEvent,
} from "electron";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { IPC, resolveOperation, validateBody, isTrustedFrame, IpcValidationError } from "./ipc";
import { startBackend, type BackendHandle } from "./backend-process";
import { secureWebPreferences, applyContentSecurityPolicy, lockDownNavigation } from "./security";
import {
  APP_SCHEME,
  APP_INDEX_URL,
  resolveAssetPath,
  mimeFor,
} from "./protocol";

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
function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error("Rejected IPC: unknown WebContents.");
  }
  const frame = event.senderFrame;
  const isMainFrame = !!frame && frame.parent === null;
  if (!isTrustedFrame(frame?.url, isMainFrame, APP_INDEX_URL)) {
    throw new Error("Rejected IPC: sender is not the approved top-level app frame.");
  }
}

function backendUrl(p: string): string {
  return `http://${backend!.host}:${backend!.port}${p}`;
}

function registerIpc(): void {
  ipcMain.handle(IPC.HANDSHAKE, async (event) => {
    assertTrustedSender(event);
    if (!backend) throw new Error("Backend not started.");
    const res = await net.fetch(backendUrl("/api/v1/startup/handshake"));
    if (!res.ok) throw new Error(`Handshake failed (${res.status}).`);
    return res.json();
  });

  ipcMain.handle(IPC.REQUEST, async (event, payload: unknown) => {
    assertTrustedSender(event);
    if (!backend) throw new Error("Backend not started.");
    const { method, path: apiPath, body } = (payload ?? {}) as {
      method?: unknown;
      path?: unknown;
      body?: unknown;
    };
    let op, validBody;
    try {
      op = resolveOperation(method, apiPath);
      validBody = validateBody(op, body);
    } catch (e) {
      if (e instanceof IpcValidationError) {
        const err = new Error(e.message);
        (err as { code?: string }).code = "ipc_validation";
        throw err;
      }
      throw e;
    }
    const res = await net.fetch(backendUrl(apiPath as string), {
      method: op.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${backend.secret}`, // secret stays in main
      },
      body: validBody === undefined ? undefined : JSON.stringify(validBody),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const detail = data?.detail;
      const message =
        detail && typeof detail === "object" ? detail.message : detail ?? `Request failed (${res.status}).`;
      const err = new Error(message);
      (err as { code?: string; status?: number }).code = detail?.code;
      (err as { status?: number }).status = res.status;
      throw err;
    }
    return data;
  });

  ipcMain.handle(IPC.SELECT_FOLDER, async (event) => {
    assertTrustedSender(event);
    if (!mainWindow) throw new Error("No window.");
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a source folder to register",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
}

function destroyWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  mainWindow = null;
}

async function stopBackend(): Promise<void> {
  if (backend) {
    await backend.stop();
    backend = null;
  }
}

// Single retry loop — never accumulates hidden windows or child processes.
async function bootWithRetry(): Promise<void> {
  for (;;) {
    // fresh window + backend each attempt
    destroyWindow();
    await stopBackend();

    mainWindow = new BrowserWindow({
      width: 1280,
      height: 820,
      backgroundColor: "#0b0d10",
      show: false,
      webPreferences: secureWebPreferences(path.join(__dirname, "preload.js")),
    });
    lockDownNavigation(mainWindow);

    try {
      backend = await startBackend({
        backendExe: process.env.ASGARD_BACKEND_EXE,
        pythonCmd: process.env.ASGARD_PYTHON ?? "python",
        backendDir: BACKEND_DIR,
        dataDir: app.getPath("userData"),
      });
      await mainWindow.loadURL(APP_INDEX_URL);
      mainWindow.show();
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const owned = backend?.recentLogs?.() ?? "";
      await stopBackend();
      destroyWindow();
      const choice = await dialog.showMessageBox({
        type: "error",
        title: "Asgard CodeAudit — backend failed to start",
        message: "The local analysis backend did not start.",
        detail: owned ? `${message}\n\n${owned}` : message,
        buttons: ["Retry", "Quit"],
        defaultId: 0,
        cancelId: 1,
      });
      if (choice.response !== 0) {
        app.quit();
        return;
      }
      // loop to retry with a brand-new window + child
    }
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerAppProtocol();
    applyContentSecurityPolicy();
    registerIpc();
    void bootWithRetry();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void bootWithRetry();
    });
  });

  app.on("window-all-closed", () => {
    void stopBackend();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    void stopBackend();
  });

  void pathToFileURL; // reserved for future file-scheme helpers
}
