import { ApiError, type Handshake, type Transport } from "./contract";

// Preview adapter: authenticated same-origin transport through the platform
// ingress. Obtains an in-memory dev session token from the backend handshake
// and attaches it as a bearer on every request. This adapter is DEV-ONLY and is
// excluded from the production desktop build.

const BASE: string =
  (import.meta.env.REACT_APP_BACKEND_URL as string | undefined)?.replace(/\/$/, "") ?? "";

function url(path: string): string {
  return `${BASE}${path}`;
}

export class PreviewTransport implements Transport {
  readonly mode = "preview" as const;
  private token: string | null = null;

  async init(): Promise<void> {
    const res = await fetch(url("/api/v1/dev/session"), {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new ApiError(res.status, `Preview session handshake failed (${res.status}).`);
    }
    this.token = (await res.json()).token;
  }

  async handshake(): Promise<Handshake> {
    // Dedicated, typed readiness/identity operation. The public startup handshake
    // is unauthenticated; it does not travel the generic request path.
    const res = await fetch(url("/api/v1/startup/handshake"), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new ApiError(res.status, `Startup handshake failed (${res.status}).`);
    }
    return (await res.json()) as Handshake;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.token) await this.init();
    const doFetch = () =>
      fetch(url(path), {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    let res = await doFetch();
    if (res.status === 401) {
      // token may have rotated on a backend restart; re-handshake once.
      await this.init();
      res = await doFetch();
    }
    if (!res.ok) {
      let code: string | undefined;
      let message = `Request failed (${res.status}).`;
      try {
        const data = await res.json();
        const detail = data?.detail;
        if (detail && typeof detail === "object") {
          code = detail.code;
          message = detail.message ?? message;
        } else if (typeof detail === "string") {
          message = detail;
        }
      } catch {
        /* non-JSON error */
      }
      throw new ApiError(res.status, message, code);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}
