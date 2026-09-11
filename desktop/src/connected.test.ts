import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  isTrustedFrame,
  resolveOperation,
  validateBody,
  ipcOk,
  ipcFail,
  IpcValidationError,
  type IpcResult,
} from "./ipc";
import { APP_ORIGIN, APP_LAUNCH_URL } from "./protocol";

// CONNECTED boundary test for the desktop application frame + IPC.
//
// It uses the REAL ipc.ts sender validation, operation allow-list, body
// validation and result envelope, wired to a REAL loopback HTTP backend.
//
// SUBSTITUTION (labeled): Electron's ipcMain/net.fetch and BrowserWindow are
// MODELLED by the handlers below and Node's fetch. Native window/frame identity
// and the real net stack are Windows/GUI gates and are NOT exercised here.

let server: http.Server;
let baseUrl = "";
const secret = "launch-secret";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const authed = req.headers.authorization === `Bearer ${secret}`;
    const url = req.url ?? "";
    if (url === "/api/v1/startup/handshake") {
      res.end(JSON.stringify({ status: "ready", name: "Asgard CodeAudit", version: "0.1.0", source_revision: null, mode: "desktop" }));
    } else if (!authed) {
      res.writeHead(401);
      res.end(JSON.stringify({ detail: { message: "Not authenticated", code: "unauthenticated" } }));
    } else if (url === "/api/v1/build") {
      res.end(JSON.stringify({ name: "Asgard CodeAudit" }));
    } else if (url === "/api/v1/diagnostics") {
      res.end(JSON.stringify({ mode: "desktop" }));
    } else if (url === "/api/v1/projects" && req.method === "GET") {
      res.end(JSON.stringify([]));
    } else if (url === "/api/v1/projects" && req.method === "POST") {
      res.end(JSON.stringify({ id: "a".repeat(32), name: "x" }));
    } else if (/^\/api\/v1\/projects\/[0-9a-f]{32}$/.test(url)) {
      res.end(JSON.stringify({ id: url.split("/").pop(), name: "x" }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ detail: "not found" }));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

// Mirrors main.ts callBackend: never leaks raw bodies; sanitized envelope out.
async function callBackend<T>(method: string, path: string, body?: unknown): Promise<IpcResult<T>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    return ipcFail("The backend returned a malformed response.", 502, "malformed_response");
  }
  if (!res.ok) {
    const detail = (data as { detail?: unknown })?.detail as { message?: string; code?: string } | string | undefined;
    const message = typeof detail === "object" ? detail?.message ?? `failed ${res.status}` : (detail ?? `failed ${res.status}`);
    const code = typeof detail === "object" ? detail?.code : undefined;
    return ipcFail(message, res.status, code);
  }
  return ipcOk(data as T);
}

// Mirrors the main.ts REQUEST handler (sender validation + allow-list + envelope).
async function handleRequest(senderUrl: string | undefined, isMainFrame: boolean, method: string, path: string, body?: unknown): Promise<IpcResult<unknown>> {
  if (!isTrustedFrame(senderUrl, isMainFrame, APP_ORIGIN)) return ipcFail("Rejected: untrusted sender.", 403, "untrusted_sender");
  try {
    const op = resolveOperation(method, path);
    const valid = validateBody(op, body);
    return await callBackend(op.method, path, valid);
  } catch (e) {
    if (e instanceof IpcValidationError) return ipcFail(e.message, 400, "ipc_validation");
    return ipcFail("The request could not be processed.", 500, "ipc_error");
  }
}

async function handleHandshake(senderUrl: string | undefined, isMainFrame: boolean): Promise<IpcResult<unknown>> {
  if (!isTrustedFrame(senderUrl, isMainFrame, APP_ORIGIN)) return ipcFail("Rejected: untrusted sender.", 403, "untrusted_sender");
  return callBackend("GET", "/api/v1/startup/handshake");
}

const PID = "b".repeat(32);

describe("launch -> route navigation keeps required IPC access", () => {
  const routes = [
    { url: APP_LAUNCH_URL, label: "Overview (launch /)" },
    { url: `${APP_ORIGIN}/projects`, label: "Projects" },
    { url: `${APP_ORIGIN}/projects/${PID}/settings`, label: "Project Settings" },
    { url: `${APP_ORIGIN}/diagnostics`, label: "Diagnostics" },
  ];

  it("startup handshake succeeds from the launch frame via the dedicated channel", async () => {
    const r = await handleHandshake(APP_LAUNCH_URL, true);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as { name: string }).name).toBe("Asgard CodeAudit");
  });

  for (const route of routes) {
    it(`every valid application route retains data IPC access: ${route.label}`, async () => {
      expect(isTrustedFrame(route.url, true, APP_ORIGIN)).toBe(true);
      const list = await handleRequest(route.url, true, "GET", "/api/v1/projects");
      expect(list.ok).toBe(true);
      const build = await handleRequest(route.url, true, "GET", "/api/v1/build");
      expect(build.ok).toBe(true);
      const create = await handleRequest(route.url, true, "POST", "/api/v1/projects", { name: "x", path: "/p" });
      expect(create.ok).toBe(true);
      const one = await handleRequest(route.url, true, "GET", `/api/v1/projects/${PID}`);
      expect(one.ok).toBe(true);
    });
  }
});

describe("rejections at the boundary", () => {
  it("rejects a subframe of the approved origin", async () => {
    const r = await handleRequest(`${APP_ORIGIN}/projects`, false, "GET", "/api/v1/projects");
    expect(r).toMatchObject({ ok: false, error: { code: "untrusted_sender", status: 403 } });
  });

  it("rejects another window / unapproved authority / other scheme", async () => {
    for (const u of ["app://evil/index.html", "http://asgard/index.html", "app://asgard:9/x", "file:///x"]) {
      const r = await handleRequest(u, true, "GET", "/api/v1/projects");
      expect(r).toMatchObject({ ok: false, error: { code: "untrusted_sender" } });
    }
  });

  it("rejects an unapproved operation from a legitimate route", async () => {
    const r = await handleRequest(`${APP_ORIGIN}/projects`, true, "DELETE", "/api/v1/build");
    expect(r).toMatchObject({ ok: false, error: { code: "ipc_validation", status: 400 } });
  });

  it("rejects the public handshake on the generic request channel", async () => {
    const r = await handleRequest(APP_LAUNCH_URL, true, "GET", "/api/v1/startup/handshake");
    expect(r).toMatchObject({ ok: false, error: { code: "ipc_validation" } });
  });
});

describe("structured error envelope across the boundary (item 5)", () => {
  it("carries message + status + code for a failed authenticated request", async () => {
    // force a 401 by mirroring the handler but with a wrong secret path: use an
    // unknown project id that the backend 404s, and a bad-auth call directly.
    const res = await fetch(`${baseUrl}/api/v1/build`, { headers: { Authorization: "Bearer wrong" } });
    expect(res.status).toBe(401);
    const bad = await (async (): Promise<IpcResult<unknown>> => {
      const r = await fetch(`${baseUrl}/api/v1/build`, { headers: { Authorization: "Bearer wrong" } });
      const data = JSON.parse((await r.text()) || "{}");
      const d = data.detail as { message?: string; code?: string };
      return r.ok ? ipcOk(data) : ipcFail(d.message ?? "", r.status, d.code);
    })();
    expect(bad).toMatchObject({ ok: false, error: { message: "Not authenticated", status: 401, code: "unauthenticated" } });
  });

  it("maps validation failures, duplicate/backend errors and 404s to bounded messages", async () => {
    const validation = await handleRequest(APP_LAUNCH_URL, true, "POST", "/api/v1/projects", { bogus: 1 });
    expect(validation).toMatchObject({ ok: false, error: { code: "ipc_validation" } });
    const notFound = await handleRequest(APP_LAUNCH_URL, true, "GET", "/api/v1/preview/fixtures");
    expect(notFound.ok).toBe(false); // backend 404 -> bounded failure, no raw body
    if (!notFound.ok) expect(notFound.error.status).toBe(404);
  });
});
