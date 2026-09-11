import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC } from "./ipc";

// Secure preload bridge. The renderer receives ONLY these narrow functions. It
// never gets Node, fs, shell, ipcRenderer, the session secret, executable paths,
// commands, ports, or arbitrary arguments. Process management is limited to a
// single no-argument recovery request.
const asgard = {
  handshake: () => ipcRenderer.invoke(IPC.HANDSHAKE),
  request: (method: string, path: string, body?: unknown) =>
    ipcRenderer.invoke(IPC.REQUEST, { method, path, body }),
  selectFolder: () => ipcRenderer.invoke(IPC.SELECT_FOLDER),
  // One bounded recovery attempt after a post-startup backend crash.
  retryBackend: () => ipcRenderer.invoke(IPC.RETRY_BACKEND),
  // Typed, sanitized main->renderer notification. Returns an unsubscribe fn and
  // asks main to replay the current status (covers a crash before subscribe).
  onBackendUnavailable: (callback: (status: { reason: string; message: string }) => void) => {
    const listener = (_e: IpcRendererEvent, status: { reason: string; message: string }) => callback(status);
    ipcRenderer.on(IPC.BACKEND_UNAVAILABLE, listener);
    ipcRenderer.send(IPC.BACKEND_SUBSCRIBE);
    return () => ipcRenderer.removeListener(IPC.BACKEND_UNAVAILABLE, listener);
  },
};

contextBridge.exposeInMainWorld("asgard", asgard);
