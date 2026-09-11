import { ApiError, type Handshake, type Transport } from "./contract";

// The browser always uses its own ingress origin. A different deployment's
// REACT_APP_BACKEND_URL must not redirect session tokens or source requests.
// This adapter is development-only; desktop traffic stays on the IPC bridge.
interface Exchange {
  status: number;
  ok: boolean;
  data: unknown;
}

function apiPath(path: string): string {
  if (!/^\/api\/v1\/[A-Za-z0-9_/-]+$/.test(path) || path.includes("//")) {
    throw new ApiError(0, "Only same-origin application API paths are allowed.", "invalid_api_path");
  }
  return path;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function httpError(result: Exchange): ApiError {
  const detail = asRecord(result.data)?.detail;
  const fields = asRecord(detail);
  const raw = typeof fields?.message === "string" ? fields.message
    : typeof detail === "string" ? detail : `Request failed (${result.status}).`;
  const message = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500);
  const code = typeof fields?.code === "string" ? fields.code.slice(0, 80) : undefined;
  return new ApiError(result.status, message || "The request failed.", code);
}

export class PreviewTransport implements Transport {
  readonly mode = "preview" as const;
  private token: string | null = null;
  private readonly timeoutMs: number;

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 10000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new ApiError(0, "The request timeout must be a positive integer.", "invalid_timeout");
    }
  }

  private async exchange(path: string, init: RequestInit = {}): Promise<Exchange> {
    const target = apiPath(path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(target, {
        ...init,
        credentials: "same-origin",
        redirect: "error",
        signal: controller.signal,
      });
      let data: unknown;
      if (res.status !== 204) {
        try {
          data = await res.json();
        } catch (error) {
          if (controller.signal.aborted) throw error;
          if (res.ok) {
            throw new ApiError(502, "The backend returned a malformed response.", "malformed_response");
          }
          // An HTML gateway error is not application JSON. Keep the HTTP status,
          // but never show the raw HTML/response body as a diagnostic message.
        }
      }
      if (controller.signal.aborted) throw new Error("request expired");
      return { status: res.status, ok: res.ok, data };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ApiError(0, "The backend did not respond before the request timed out. Check the same-origin API route, then retry.", "request_timeout");
      }
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, "The preview could not reach its same-origin backend API.", "network_error");
    } finally {
      clearTimeout(timer);
    }
  }

  async init(): Promise<void> {
    this.token = null;
    const result = await this.exchange("/api/v1/dev/session", {
      method: "POST", headers: { Accept: "application/json" },
    });
    if (!result.ok) throw httpError(result);
    const token = asRecord(result.data)?.token;
    if (typeof token !== "string" || !token.trim() || token.length > 4096) {
      throw new ApiError(502, "The backend returned an invalid preview session.", "malformed_response");
    }
    this.token = token;
  }

  async handshake(): Promise<Handshake> {
    const result = await this.exchange("/api/v1/startup/handshake", {
      headers: { Accept: "application/json" },
    });
    if (!result.ok) throw httpError(result);
    const identity = asRecord(result.data);
    if (!identity || identity.status !== "ready" || identity.mode !== "preview"
        || typeof identity.name !== "string" || !identity.name
        || typeof identity.version !== "string"
        || !(identity.source_revision === null || typeof identity.source_revision === "string")) {
      throw new ApiError(502, "The backend returned an invalid preview identity.", "malformed_response");
    }
    return result.data as Handshake;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    apiPath(path);
    if (!this.token) await this.init();
    const send = () => this.exchange(path, {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let result = await send();
    if (result.status === 401) {
      // Only an explicit authentication rejection is retried once. Network
      // failures/timeouts have an unknown outcome and are never replayed here.
      await this.init();
      result = await send();
    }
    if (!result.ok) throw httpError(result);
    return result.data as T;
  }
}
