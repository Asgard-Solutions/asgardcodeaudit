import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  registerIpcHandlers,
  type RuntimeCtx,
  type IpcMainLike,
  type IpcEventLike,
  type SenderLike,
} from "./app-runtime";
import { IPC, type IpcResult } from "./ipc";
import { APP_ORIGIN, APP_LAUNCH_URL } from "./protocol";
import { Lifecycle, type LifecycleBackend } from "./lifecycle";

// CONNECTED boundary test that invokes the ACTUAL production handler registration
// (`registerIpcHandlers`), the real allow-list/sender/envelope logic in ipc.ts,
// and a real `Lifecycle` for recovery — against a REAL loopback HTTP backend.
//
// SUBSTITUTION (labeled): only the external runtime boundaries are faked —
// electron `ipcMain` (a recorder), `net.fetch` (Node fetch), `dialog`, and the
// window WebContents/senderFrame identity. Native Electron window/net behaviour
// (Windows/GUI gates) is NOT exercised.

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

// Recording fake ipcMain that lets us invoke the registered production handlers.
function makeHarness(ctx: RuntimeCtx) {
  const invokeHandlers = new Map<string, (e: IpcEventLike, ...a: unknown[]) => unknown>();
  const onHandlers = new Map<string, (e: IpcEventLike, ...a: unknown[]) => void>();
  const ipcMain: IpcMainLike = {
    handle: (ch, fn) => invokeHandlers.set(ch, fn),
    on: (ch, fn) => onHandlers.set(ch, fn),
  };
  registerIpcHandlers(ipcMain, ctx);
  return {
    invoke: (ch: string, e: IpcEventLike, ...a: unknown[]) => invokeHandlers.get(ch)!(e, ...a),
    emit: (ch: string, e: IpcEventLike, ...a: unknown[]) => onHandlers.get(ch)!(e, ...a),
  };
}

const mainSender: SenderLike = { send: () => {} };
function frame(url: string, isMain = true): IpcEventLike {
  return { sender: mainSender, senderFrame: { url, parent: isMain ? null : {} } };
}

function baseCtx(overrides: Partial<RuntimeCtx> = {}): RuntimeCtx {
  return {
    getBackend: () => ({ host: "127.0.0.1", port: Number(new URL(baseUrl).port), secret }),
    getMainSender: () => mainSender,
    fetchImpl: (u, init) => fetch(u, init),
    openDirectory: async () => ({ canceled: false, filePaths: ["/picked/folder"] }),
    retry: async () => ({ status: "ready", name: "Asgard CodeAudit" }),
    getUnavailableStatus: () => null,
    ...overrides,
  };
}

const PID = "b".repeat(32);

describe("real production handlers: launch + route navigation keep IPC access", () => {
  it("dedicated handshake succeeds from the launch frame", async () => {
    const h = makeHarness(baseCtx());
    const r = (await h.invoke(IPC.HANDSHAKE, frame(APP_LAUNCH_URL))) as IpcResult<{ name: string }>;
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.name).toBe("Asgard CodeAudit");
  });

  for (const [label, url] of [
    ["Overview (/)", APP_LAUNCH_URL],
    ["Projects", `${APP_ORIGIN}/projects`],
    ["Settings", `${APP_ORIGIN}/projects/${PID}/settings`],
    ["Diagnostics", `${APP_ORIGIN}/diagnostics`],
  ] as const) {
    it(`data IPC retained on ${label}`, async () => {
      const h = makeHarness(baseCtx());
      for (const [m, p, b] of [
        ["GET", "/api/v1/projects", undefined],
        ["GET", "/api/v1/build", undefined],
        ["POST", "/api/v1/projects", { name: "x", path: "/p" }],
        ["GET", `/api/v1/projects/${PID}`, undefined],
      ] as const) {
        const r = (await h.invoke(IPC.REQUEST, frame(url), { method: m, path: p, body: b })) as IpcResult<unknown>;
        expect(r.ok).toBe(true);
      }
    });
  }
});

describe("real production handlers: boundary rejections", () => {
  it("rejects subframe, other authority/scheme/port, unapproved op, and handshake-on-request", async () => {
    const h = makeHarness(baseCtx());
    const sub = (await h.invoke(IPC.REQUEST, frame(`${APP_ORIGIN}/projects`, false), { method: "GET", path: "/api/v1/projects" })) as IpcResult<unknown>;
    expect(sub).toMatchObject({ ok: false, error: { code: "untrusted_sender", status: 403 } });
    for (const u of ["app://evil/index.html", "http://asgard/x", "app://asgard:9/x", "file:///x"]) {
      const r = (await h.invoke(IPC.REQUEST, frame(u), { method: "GET", path: "/api/v1/projects" })) as IpcResult<unknown>;
      expect(r).toMatchObject({ ok: false, error: { code: "untrusted_sender" } });
    }
    const badOp = (await h.invoke(IPC.REQUEST, frame(`${APP_ORIGIN}/projects`), { method: "DELETE", path: "/api/v1/build" })) as IpcResult<unknown>;
    expect(badOp).toMatchObject({ ok: false, error: { code: "ipc_validation", status: 400 } });
    const hsOnReq = (await h.invoke(IPC.REQUEST, frame(APP_LAUNCH_URL), { method: "GET", path: "/api/v1/startup/handshake" })) as IpcResult<unknown>;
    expect(hsOnReq).toMatchObject({ ok: false, error: { code: "ipc_validation" } });
  });

  it("rejects a request from another window (different sender)", async () => {
    const h = makeHarness(baseCtx());
    const otherWindow: IpcEventLike = { sender: { send: () => {} }, senderFrame: { url: APP_LAUNCH_URL, parent: null } };
    const r = (await h.invoke(IPC.REQUEST, otherWindow, { method: "GET", path: "/api/v1/projects" })) as IpcResult<unknown>;
    expect(r).toMatchObject({ ok: false, error: { code: "untrusted_sender" } });
  });
});

describe("real production handlers: structured error envelope", () => {
  it("preserves status/code across the boundary and bounds backend errors", async () => {
    // backend rejects auth -> 401 with code; build a ctx whose backend secret is wrong
    const wrong = makeHarness(baseCtx({ getBackend: () => ({ host: "127.0.0.1", port: Number(new URL(baseUrl).port), secret: "nope" }) }));
    const unauth = (await wrong.invoke(IPC.REQUEST, frame(APP_LAUNCH_URL), { method: "GET", path: "/api/v1/build" })) as IpcResult<unknown>;
    expect(unauth).toMatchObject({ ok: false, error: { message: "Not authenticated", status: 401, code: "unauthenticated" } });

    const h = makeHarness(baseCtx());
    const validation = (await h.invoke(IPC.REQUEST, frame(APP_LAUNCH_URL), { method: "POST", path: "/api/v1/projects", body: { bogus: 1 } })) as IpcResult<unknown>;
    expect(validation).toMatchObject({ ok: false, error: { code: "ipc_validation" } });
    const notFound = (await h.invoke(IPC.REQUEST, frame(APP_LAUNCH_URL), { method: "GET", path: "/api/v1/preview/fixtures" })) as IpcResult<unknown>;
    expect(notFound.ok).toBe(false);
    if (!notFound.ok) expect(notFound.error.status).toBe(404);
  });

  it("returns backend_unavailable when no backend is owned", async () => {
    const h = makeHarness(baseCtx({ getBackend: () => null }));
    const r = (await h.invoke(IPC.REQUEST, frame(APP_LAUNCH_URL), { method: "GET", path: "/api/v1/projects" })) as IpcResult<unknown>;
    expect(r).toMatchObject({ ok: false, error: { code: "backend_unavailable", status: 503 } });
  });
});

describe("real production handlers: retry + subscribe wired to a real Lifecycle", () => {
  function fakeBackend(): LifecycleBackend & { triggerExit: () => void } {
    const cbs: Array<() => void> = [];
    return {
      stop: async () => {},
      recentLogs: () => "",
      onExit: (cb) => cbs.push(cb),
      triggerExit: () => cbs.forEach((c) => c()),
    };
  }

  it("RETRY_BACKEND invokes the controller recovery and returns a typed ok envelope", async () => {
    const first = fakeBackend();
    const second = fakeBackend();
    let n = 0;
    const lifecycle = new Lifecycle({
      createWindow: () => {},
      destroyWindow: () => {},
      startBackend: async () => (++n === 1 ? first : second),
      loadAppAndShow: async () => {},
      fetchHandshake: async () => ({ status: "ready", name: "Asgard CodeAudit", version: "0.1.0", source_revision: null, mode: "desktop" }),
      showStartupErrorDialog: async () => false,
      notifyUnavailable: () => {},
      quit: () => {},
    });
    await lifecycle.boot();
    first.triggerExit(); // -> unavailable

    let sent: unknown = null;
    const capturing: SenderLike = { send: (_ch, s) => (sent = s) };
    const ctx = baseCtx({
      getMainSender: () => capturing,
      retry: () => lifecycle.retry(),
      getUnavailableStatus: () => lifecycle.getUnavailableStatus(),
    });
    const h = makeHarness(ctx);

    // subscribe replay delivers the retained crash status to the trusted sender
    h.emit(IPC.BACKEND_SUBSCRIBE, { sender: capturing, senderFrame: { url: APP_LAUNCH_URL, parent: null } });
    expect(sent).toMatchObject({ reason: "crashed" });

    const r = (await h.invoke(IPC.RETRY_BACKEND, { sender: capturing, senderFrame: { url: APP_LAUNCH_URL, parent: null } })) as IpcResult<{ name: string }>;
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.name).toBe("Asgard CodeAudit");
    expect(lifecycle.getState()).toBe("ready");
  });
});
