import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "./ipc";

// Secure preload bridge. The renderer receives ONLY these three functions.
// It never gets Node, fs, shell, ipcRenderer, or the session secret.
const asgard = {
  handshake: () => ipcRenderer.invoke(IPC.HANDSHAKE),
  request: (method: string, path: string, body?: unknown) =>
    ipcRenderer.invoke(IPC.REQUEST, { method, path, body }),
  selectFolder: () => ipcRenderer.invoke(IPC.SELECT_FOLDER),
};

contextBridge.exposeInMainWorld("asgard", asgard);
