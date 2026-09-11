import { ApiError, type Transport } from "./contract";

// Desktop adapter: the renderer never makes arbitrary HTTP calls. It invokes a
// narrow, allow-listed preload bridge (window.asgard) which forwards to the
// Electron main process; main holds the per-launch session secret and talks to
// the 127.0.0.1 loopback backend. This module is only loaded in the desktop build.

export class DesktopTransport implements Transport {
  readonly mode = "desktop" as const;

  private get bridge() {
    if (!window.asgard) throw new ApiError(0, "Desktop bridge unavailable.");
    return window.asgard;
  }

  async init(): Promise<void> {
    await this.bridge.handshake();
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await this.bridge.request(method, path, body)) as T;
  }

  async selectFolder(): Promise<string | null> {
    return this.bridge.selectFolder();
  }
}
