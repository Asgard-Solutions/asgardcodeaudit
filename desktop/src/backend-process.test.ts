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

// A fully valid backend whose responses can be delayed to model a slow start.
function validBackend(delayMs = 0): http.RequestListener {
  return (req, res) => {
    const send = () => {
      if (req.url === "/api/v1/startup/handshake") {
        res.end(JSON.stringify({ status: "ready", name: "Asgard CodeAudit", mode: "desktop" }));
      } else if (req.url === "/api/v1/build") {
        if (req.headers.authorization === "Bearer s3cr3t") res.end(JSON.stringify({ name: "Asgard CodeAudit" }));
        else {
          res.writeHead(401);
          res.end("{}");
        }
      } else {
        res.writeHead(404);
        res.end("{}");
      }
    };
    if (delayMs > 0) setTimeout(send, delayMs);
    else send();
  };
}

describe("backend readiness validation", () => {
  it("accepts a valid readiness + authenticated identity", async () => {
    const srv = await server(validBackend());
    await expect(checkReadiness(srv.url, "s3cr3t", { perRequestMs: 1000 })).resolves.toBeUndefined();
    srv.close();
  });

  it("rejects an unrelated HTTP 200 / malformed identity", async () => {
    const srv = await server((_req, res) => res.end(JSON.stringify({ hello: "world" })));
    await expect(checkReadiness(srv.url, "x", { perRequestMs: 1000 })).rejects.toBeInstanceOf(BackendStartError);
    srv.close();
  });

  it("rejects a failed authenticated probe deterministically", async () => {
    const srv = await server(validBackend());
    await expect(checkReadiness(srv.url, "wrong-secret", { perRequestMs: 1000 })).rejects.toMatchObject({
      code: "auth_failed",
    });
    srv.close();
  });

  it("times out against a hanging server (per-request abort + deadline)", async () => {
    const srv = await server(() => {
      /* never responds */
    });
    await expect(waitForReady(srv.url, "x", { deadlineMs: 800, perRequestMs: 200 })).rejects.toMatchObject({
      code: "timeout",
    });
    srv.close();
  }, 5000);

  it("does NOT accept a successful probe that only completes AFTER the overall deadline", async () => {
    // deadline 50ms, per-request 500ms: the per-request budget is clamped to the
    // remaining deadline, so the delayed success is discarded, not accepted.
    const srv = await server(validBackend(250));
    const t0 = Date.now();
    await expect(waitForReady(srv.url, "s3cr3t", { deadlineMs: 50, perRequestMs: 500 })).rejects.toMatchObject({
      code: "timeout",
    });
    // must give up around the deadline, not wait for the ~250ms success
    expect(Date.now() - t0).toBeLessThan(200);
    srv.close();
  }, 5000);

  it("honours cancellation while a successful response is IN FLIGHT", async () => {
    // The success would arrive at ~300ms; we abort at ~50ms mid-flight.
    const srv = await server(validBackend(300));
    const ac = new AbortController();
    const p = waitForReady(srv.url, "s3cr3t", {
      deadlineMs: 5000,
      perRequestMs: 2000,
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 50);
    await expect(p).rejects.toMatchObject({ code: "cancelled" });
    srv.close();
  }, 8000);

  it("honours cancellation before the first probe begins", async () => {
    const ac = new AbortController();
    const srv = await server(() => {
      /* hang */
    });
    const p = waitForReady(srv.url, "x", { deadlineMs: 5000, perRequestMs: 500, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: "cancelled" });
    srv.close();
  }, 8000);
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
    // onExit fires exactly once on stop
    let exits = 0;
    h.onExit(() => {
      exits += 1;
    });
    await h.stop();
    expect(h.stopped).toBe(true);
    // idempotent: repeated stop shares the same outcome
    await h.stop();
    await new Promise((r) => setTimeout(r, 50));
    expect(exits).toBe(1);
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
});
