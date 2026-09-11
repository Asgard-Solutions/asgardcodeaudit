import { ApiError, type BackendStatus, type Handshake, type Transport } from "./contract";

// Desktop adapter: the renderer never makes arbitrary HTTP calls. It invokes a
// narrow, allow-listed preload bridge (window.asgard) which forwards to the
// Electron main process; main holds the per-launch session secret and talks to
// the 127.0.0.1 loopback backend. This module is only loaded in the desktop build.
//
// Every bridge call returns a serializable {ok,...} envelope because Electron's
// invoke/handle does not preserve custom Error properties. This adapter unwraps
// that envelope and reconstructs a typed ApiError with a consistent
// message/status/code across the whole boundary.

interface IpcOk<T> {
  ok: true;
  data: T;
}
interface IpcErr {
  ok: false;
  error: { message: string; status: number; code?: string };
}
type IpcResult<T> = IpcOk<T> | IpcErr;

function unwrap<T>(res: unknown): T {
  const r = res as IpcResult<T> | undefined;
  if (r && typeof r === "object" && "ok" in r) {
    if (r.ok) return r.data;
    throw new ApiError(r.error.status, r.error.message, r.error.code);
  }
  throw new ApiError(0, "The desktop bridge returned a malformed response.", "malformed_bridge_response");
}

export class DesktopTransport implements Transport {
  readonly mode = "desktop" as const;

  private get bridge() {
    if (!window.asgard) throw new ApiError(0, "Desktop bridge unavailable.");
    return window.asgard;
  }

  async init(): Promise<void> {
    // The secure preload bridge is validated at transport creation. Readiness is
    // proved by the dedicated handshake() operation below; nothing to do here.
  }

  async handshake(): Promise<Handshake> {
    return unwrap<Handshake>(await this.bridge.handshake());
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return unwrap<T>(await this.bridge.request(method, path, body));
  }

  async selectFolder(): Promise<string | null> {
    return unwrap<string | null>(await this.bridge.selectFolder());
  }

  async retryBackend(): Promise<Handshake> {
    return unwrap<Handshake>(await this.bridge.retryBackend());
  }

  onBackendUnavailable(cb: (status: BackendStatus) => void): () => void {
    return this.bridge.onBackendUnavailable(cb);
  }
}
