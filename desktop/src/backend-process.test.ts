import { describe, it, expect } from "vitest";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  startBackend,
  checkReadiness,
  waitForReady,
  BackendStartError,
} from "./backend-process";

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test", "fake-backend.mjs");

function server(handler: http.RequestListener): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => s.close() });
    });
  });
}

describe("backend readiness validation", () => {
  it("accepts a valid readiness + authenticated identity", async () => {
    const srv = await server((req, res) => {
      if (req.url === "/api/v1/startup/handshake") {
        res.end(JSON.stringify({ status: "ready", name: "Asgard CodeAudit", mode: "desktop" }));
      } else if (req.url === "/api/v1/build") {
        if (req.headers.authorization === "Bearer s3cr3t") res.end(JSON.stringify({ name: "Asgard CodeAudit" }));
        else { res.writeHead(401); res.end("{}"); }
      } else { res.writeHead(404); res.end("{}"); }
    });
    await expect(checkReadiness(srv.url, "s3cr3t", 1000)).resolves.toBeUndefined();
    srv.close();
  });

  it("rejects an unrelated HTTP 200 / malformed identity", async () => {
    const srv = await server((_req, res) => res.end(JSON.stringify({ hello: "world" })));
    await expect(checkReadiness(srv.url, "x", 1000)).rejects.toBeInstanceOf(BackendStartError);
    srv.close();
  });

  it("times out against a hanging server (per-request abort + deadline)", async () => {
    const srv = await server(() => { /* never responds */ });
    await expect(
      waitForReady(srv.url, "x", { deadlineMs: 800, perRequestMs: 200 })
    ).rejects.toMatchObject({ code: "timeout" });
    srv.close();
  }, 5000);
});

describe("backend process lifecycle", () => {
  it("starts a real fake backend, validates identity, and stops (reaps) it", async () => {
    const h = await startBackend({
      backendDir: process.cwd(),
      dataDir: "/tmp/asgard-test-data",
      commandOverride: { cmd: process.execPath, args: [FAKE] },
      deadlineMs: 8000,
      perRequestMs: 1500,
    });
    expect(h.proc.pid).toBeGreaterThan(0);
    await h.stop();
    expect(h.stopped).toBe(true);
    // idempotent
    await h.stop();
  }, 15000);

  it("fails on a missing executable", async () => {
    await expect(
      startBackend({
        backendDir: process.cwd(),
        dataDir: "/tmp/asgard-test-data",
        commandOverride: { cmd: "definitely-not-a-real-binary-xyz", args: [] },
        deadlineMs: 3000,
      })
    ).rejects.toBeInstanceOf(BackendStartError);
  }, 10000);

  it("fails when the backend exits early", async () => {
    await expect(
      startBackend({
        backendDir: process.cwd(),
        dataDir: "/tmp/asgard-test-data",
        commandOverride: { cmd: process.execPath, args: ["-e", "process.exit(3)"] },
        deadlineMs: 4000,
        perRequestMs: 800,
      })
    ).rejects.toBeInstanceOf(BackendStartError);
  }, 10000);

  it("honours cancellation via AbortSignal", async () => {
    const ac = new AbortController();
    const srv = await server(() => { /* hang so readiness never passes */ });
    const p = waitForReady(srv.url, "x", { deadlineMs: 5000, perRequestMs: 500, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: "cancelled" });
    srv.close();
  }, 8000);
});
