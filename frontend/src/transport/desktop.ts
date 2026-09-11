import { ApiError, type Transport } from "./contract";

// Desktop adapter: the renderer never makes arbitrary HTTP calls. It invokes a
// narrow, allow-listed preload bridge (window.asgard) which forwards to the
// Electron main process, which holds the per-launch session secret and talks to
// the 127.0.0.1 loopback backend. This code path only runs inside Electron.

declare global {
  interface Window {
    asgard?: {
      request: (method: string, path: string, body?: unknown) => Promise<unknown>;
      handshake: () => Promise<unknown>;
    };
  }
}

export function hasDesktopBridge(): boolean {
  return typeof window !== "undefined" && !!window.asgard;
}

export class DesktopTransport implements Transport {
  readonly mode = "desktop" as const;

  async init(): Promise<void> {
    if (!window.asgard) throw new ApiError(0, "Desktop bridge unavailable.");
    await window.asgard.handshake();
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!window.asgard) throw new ApiError(0, "Desktop bridge unavailable.");
    return (await window.asgard.request(method, path, body)) as T;
  }
}
