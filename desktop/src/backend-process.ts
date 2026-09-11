import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";

// Owns the lifecycle of the loopback FastAPI backend in desktop mode:
// - binds only to 127.0.0.1 on an ephemeral port
// - passes a random per-launch session secret over the child's stdin pipe
// - validates a schema-defined readiness response AND an authenticated request
//   before the backend is treated as usable
// - bounded startup (per-request abort + overall deadline), cancellation, and
//   idempotent/bounded shutdown of ONLY the process it owns.

export class BackendStartError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface BackendHandle {
  host: string;
  port: number;
  secret: string;
  proc: ChildProcess;
  stopped: boolean;
  stop: () => Promise<void>;
  recentLogs: () => string;
}

export interface SpawnOptions {
  backendExe?: string;
  pythonCmd?: string;
  backendDir: string;
  dataDir: string;
  commandOverride?: { cmd: string; args: string[] }; // tests only
  perRequestMs?: number;
  deadlineMs?: number;
  signal?: AbortSignal;
  stopGraceMs?: number;
}

export async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

// --- readiness validation (separately testable) ----------------------------

async function fetchJson(url: string, perRequestMs: number, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(perRequestMs) });
}

export async function checkReadiness(baseUrl: string, secret: string, perRequestMs: number): Promise<void> {
  // 1) unauthenticated readiness identity
  const hs = await fetchJson(`${baseUrl}/api/v1/startup/handshake`, perRequestMs);
  if (!hs.ok) throw new BackendStartError("not_ready", `handshake status ${hs.status}`);
  const id = (await hs.json()) as { status?: string; name?: string; mode?: string };
  if (id.status !== "ready" || id.name !== "Asgard CodeAudit" || id.mode !== "desktop") {
    throw new BackendStartError("wrong_identity", `unexpected readiness identity: ${JSON.stringify(id)}`);
  }
  // 2) authenticated request proves the per-launch secret reached the backend
  const auth = await fetchJson(`${baseUrl}/api/v1/build`, perRequestMs, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (auth.status === 401) throw new BackendStartError("auth_failed", "authenticated probe rejected");
  if (!auth.ok) throw new BackendStartError("not_ready", `build status ${auth.status}`);
  const build = (await auth.json()) as { name?: string };
  if (build.name !== "Asgard CodeAudit") {
    throw new BackendStartError("wrong_identity", "authenticated probe returned unexpected app");
  }
}

export async function waitForReady(
  baseUrl: string,
  secret: string,
  opts: { deadlineMs: number; perRequestMs: number; signal?: AbortSignal; isAlive?: () => boolean }
): Promise<void> {
  const end = Date.now() + opts.deadlineMs;
  let lastErr = "no response";
  while (Date.now() < end) {
    if (opts.signal?.aborted) throw new BackendStartError("cancelled", "startup cancelled");
    if (opts.isAlive && !opts.isAlive()) throw new BackendStartError("exited", "backend exited during startup");
    try {
      await checkReadiness(baseUrl, secret, opts.perRequestMs);
      return;
    } catch (e) {
      if (e instanceof BackendStartError && (e.code === "auth_failed" || e.code === "wrong_identity")) {
        // deterministic failures: a wrong/unrelated server won't become right
        throw e;
      }
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new BackendStartError("timeout", `backend not ready within ${opts.deadlineMs}ms (${lastErr})`);
}

// --- process lifecycle ------------------------------------------------------

function resolveCommand(opts: SpawnOptions, host: string, port: number): { cmd: string; args: string[] } {
  if (opts.commandOverride) {
    return { cmd: opts.commandOverride.cmd, args: [...opts.commandOverride.args, "--host", host, "--port", String(port)] };
  }
  if (opts.backendExe) return { cmd: opts.backendExe, args: ["--host", host, "--port", String(port)] };
  return {
    cmd: opts.pythonCmd ?? "python",
    args: ["-m", "uvicorn", "server:app", "--host", host, "--port", String(port)],
  };
}

function makeStop(proc: ChildProcess, graceMs: number): { stop: () => Promise<void>; state: { stopped: boolean } } {
  const state = { stopped: false };
  const stop = async () => {
    if (state.stopped || proc.exitCode !== null || proc.signalCode !== null) {
      state.stopped = true;
      return;
    }
    state.stopped = true;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          clearTimeout(t);
          resolve();
        }
      };
      proc.once("exit", finish);
      try {
        proc.kill("SIGTERM");
      } catch {
        finish();
        return;
      }
      const t = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        finish();
      }, graceMs);
    });
  };
  return { stop, state };
}

export async function startBackend(opts: SpawnOptions): Promise<BackendHandle> {
  const host = "127.0.0.1";
  const port = await freeLoopbackPort();
  const secret = randomBytes(48).toString("base64url");
  const perRequestMs = opts.perRequestMs ?? 3000;
  const deadlineMs = opts.deadlineMs ?? 20000;
  const graceMs = opts.stopGraceMs ?? 4000;

  const env = { ...process.env, ASGARD_MODE: "desktop", ASGARD_DATA_DIR: opts.dataDir, ASGARD_PREVIEW_ORIGINS: "" };
  const { cmd, args } = resolveCommand(opts, host, port);

  let proc: ChildProcess;
  try {
    proc = spawn(cmd, args, { cwd: opts.backendDir, stdio: ["pipe", "pipe", "pipe"], env });
  } catch (e) {
    throw new BackendStartError("spawn_failed", `could not spawn backend: ${e instanceof Error ? e.message : e}`);
  }

  // Bounded, redacted diagnostics ring buffer (never leak the secret).
  let logs = "";
  const drain = (buf: Buffer) => {
    const redacted = buf.toString("utf8").split(secret).join("***");
    logs = (logs + redacted).slice(-4000);
  };
  proc.stdout?.on("data", drain);
  proc.stderr?.on("data", drain);

  let alive = true;
  let earlyExit: string | null = null;
  const spawnErr: Promise<never> = new Promise((_, reject) => {
    proc.once("error", (e) => {
      alive = false;
      reject(new BackendStartError("spawn_failed", `backend process error: ${e.message}`));
    });
    proc.once("exit", (code, sig) => {
      alive = false;
      earlyExit = `exit code=${code} signal=${sig}`;
    });
  });

  const { stop, state } = makeStop(proc, graceMs);
  const handle: BackendHandle = {
    host,
    port,
    secret,
    proc,
    get stopped() {
      return state.stopped;
    },
    stop,
    recentLogs: () => logs,
  } as BackendHandle;

  try {
    // secret over the private stdin pipe; handle EPIPE
    proc.stdin?.on("error", () => {
      /* ignore broken pipe; readiness/exit handling covers it */
    });
    proc.stdin?.write(JSON.stringify({ mode: "desktop", session_secret: secret }) + "\n");
    proc.stdin?.end();

    await Promise.race([
      waitForReady(`http://${host}:${port}`, secret, {
        deadlineMs,
        perRequestMs,
        signal: opts.signal,
        isAlive: () => alive,
      }),
      spawnErr,
    ]);
    return handle;
  } catch (e) {
    // A failed start must terminate and reap its owned child before returning.
    await stop();
    if (e instanceof BackendStartError) {
      if (earlyExit && e.code !== "spawn_failed") {
        throw new BackendStartError("exited", `backend exited during startup (${earlyExit}). ${handle.recentLogs()}`);
      }
      throw e;
    }
    throw new BackendStartError("unknown", e instanceof Error ? e.message : String(e));
  }
}
