import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { IPC, validateApiRequest } from "./ipc";
import { startBackend, type BackendHandle } from "./backend-process";
import { secureWebPreferences, applyContentSecurityPolicy, lockDownNavigation } from "./security";

let mainWindow: BrowserWindow | null = null;
let backend: BackendHandle | null = null;

const RENDERER_INDEX =
  process.env.ASGARD_RENDERER ?? path.join(__dirname, "..", "..", "frontend", "dist", "index.html");
const BACKEND_DIR = process.env.ASGARD_BACKEND_DIR ?? path.join(__dirname, "..", "..", "backend");

// --- IPC sender validation -------------------------------------------------
// Every handler rejects messages that do not originate from our own window's
// top frame. The renderer cannot spoof another sender.
function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error("Rejected IPC from an untrusted sender.");
  }
  const url = event.senderFrame?.url ?? "";
  if (!url.startsWith("file://") && !url.startsWith("app://")) {
    throw new Error("Rejected IPC from an untrusted frame.");
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.HANDSHAKE, async (event) => {
    assertTrustedSender(event);
    if (!backend) throw new Error("Backend not started.");
    const res = await fetch(`http://${backend.host}:${backend.port}/api/v1/startup/handshake`);
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
    const valid = validateApiRequest(method, apiPath); // throws on anything off the allow-list
    const res = await fetch(`http://${backend.host}:${backend.port}${valid.path}`, {
      method: valid.method,
      headers: {
        "Content-Type": "application/json",
        // The session secret is attached HERE, in main — never exposed to the renderer.
        Authorization: `Bearer ${backend.secret}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const detail = data?.detail;
      const message =
        detail && typeof detail === "object" ? detail.message : detail ?? `Request failed (${res.status}).`;
      const err = new Error(message);
      (err as { code?: string }).code = detail?.code;
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

async function createWindow(): Promise<void> {
  const preload = path.join(__dirname, "preload.js");
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: "#0b0d10",
    show: false,
    webPreferences: secureWebPreferences(preload),
  });

  lockDownNavigation(mainWindow);

  try {
    backend = await startBackend({
      backendExe: process.env.ASGARD_BACKEND_EXE,
      pythonCmd: process.env.ASGARD_PYTHON ?? "python",
      backendDir: BACKEND_DIR,
      dataDir: app.getPath("userData"),
    });
    applyContentSecurityPolicy(`http://${backend.host}:${backend.port}`);
    await mainWindow.loadFile(RENDERER_INDEX);
    mainWindow.show();
  } catch (err) {
    // F02: useful startup failure with retry (no fake "ready" state).
    const message = err instanceof Error ? err.message : String(err);
    const choice = await dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Asgard CodeAudit — backend failed to start",
      message: "The local analysis backend did not start.",
      detail: message,
      buttons: ["Retry", "Quit"],
      defaultId: 0,
      cancelId: 1,
    });
    stopBackend();
    if (choice.response === 0) return createWindow();
    app.quit();
  }
}

function stopBackend(): void {
  backend?.stop();
  backend = null;
}

// F09: single owner of the app-data directory. A second launch focuses the
// existing window instead of becoming a competing owner.
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
    registerIpc();
    void createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });

  app.on("window-all-closed", () => {
    stopBackend();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", stopBackend);
}
