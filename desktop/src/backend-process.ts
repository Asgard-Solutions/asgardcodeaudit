import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";

// Owns the lifecycle of the loopback FastAPI backend in desktop mode:
// - binds only to 127.0.0.1 on an ephemeral port
// - passes a random per-launch session secret over the child's stdin pipe
// - validates a schema-defined readiness response AND an authenticated request
//   before the backend is treated as usable
// - bounded startup: the overall deadline, the per-request timeout, AND caller
//   cancellation apply to the COMPLETE readiness operation (request initiation
//   and response-body reading). A late success never revives a cancelled or
//   expired attempt: liveness/deadline/cancellation are re-checked before a
//   usable handle is returned.
// - idempotent/bounded shutdown of ONLY the process it owns.

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
  // Register a callback for process exit. Fires immediately if already exited.
  onExit: (cb: (info: { code: number | null; signal: NodeJS.Signals | null }) => void) => void;
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

export interface ReadinessOpts {
  perRequestMs: number;
  endAt?: number; // absolute deadline (Date.now()+deadlineMs); undefined = no overall cap
  signal?: AbortSignal;
}

// Build a signal that trips on: caller cancellation, the per-request timeout,
// OR the remaining overall deadline — whichever comes first. This governs both
// request initiation and body reading (fetch aborts the whole exchange).
function requestSignal(opts: ReadinessOpts): AbortSignal {
  const remaining = opts.endAt === undefined ? Number.POSITIVE_INFINITY : opts.endAt - Date.now();
  if (remaining <= 0) {
    const ac = new AbortController();
    ac.abort();
    return ac.signal;
  }
  const budget = Math.max(1, Math.min(opts.perRequestMs, remaining));
  const signals: AbortSignal[] = [AbortSignal.timeout(budget)];
  if (opts.signal) signals.push(opts.signal);
  return AbortSignal.any(signals);
}

export async function checkReadiness(baseUrl: string, secret: string, opts: ReadinessOpts): Promise<void> {
  // 1) unauthenticated readiness identity
  const hs = await fetch(`${baseUrl}/api/v1/startup/handshake`, { signal: requestSignal(opts) });
  if (!hs.ok) throw new BackendStartError("not_ready", `handshake status ${hs.status}`);
  const id = (await hs.json()) as { status?: string; name?: string; mode?: string };
  if (id.status !== "ready" || id.name !== "Asgard CodeAudit" || id.mode !== "desktop") {
    throw new BackendStartError("wrong_identity", `unexpected readiness identity: ${JSON.stringify(id)}`);
  }
  // 2) authenticated request proves the per-launch secret reached the backend
  const auth = await fetch(`${baseUrl}/api/v1/build`, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: requestSignal(opts),
  });
  if (auth.status === 401) throw new BackendStartError("auth_failed", "authenticated probe rejected");
  if (!auth.ok) throw new BackendStartError("not_ready", `build status ${auth.status}`);
  const build = (await auth.json()) as { name?: string };
  if (build.name !== "Asgard CodeAudit") {
    throw new BackendStartError("wrong_identity", "authenticated probe returned unexpected app");
  }
}

function abortableDelay(ms: number, endAt: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const remaining = Math.min(ms, endAt - Date.now());
    if (remaining <= 0) return resolve();
    let onAbort: (() => void) | null = null;
    const t = setTimeout(() => {
      if (onAbort && signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, remaining);
    if (signal) {
      onAbort = () => {
        clearTimeout(t);
        reject(new BackendStartError("cancelled", "startup cancelled"));
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export async function waitForReady(
  baseUrl: string,
  secret: string,
  opts: { deadlineMs: number; perRequestMs: number; signal?: AbortSignal; isAlive?: () => boolean }
): Promise<void> {
  const endAt = Date.now() + opts.deadlineMs;
  let lastErr = "no response";
  for (;;) {
    if (opts.signal?.aborted) throw new BackendStartError("cancelled", "startup cancelled");
    if (Date.now() >= endAt) throw new BackendStartError("timeout", `backend not ready within ${opts.deadlineMs}ms (${lastErr})`);
    if (opts.isAlive && !opts.isAlive()) throw new BackendStartError("exited", "backend exited during startup");
    try {
      await checkReadiness(baseUrl, secret, { perRequestMs: opts.perRequestMs, endAt, signal: opts.signal });
      // Re-check the final state BEFORE returning a usable handle. A response
      // that only arrived after cancellation or the deadline is discarded.
      if (opts.signal?.aborted) throw new BackendStartError("cancelled", "startup cancelled");
      if (Date.now() >= endAt) throw new BackendStartError("timeout", "backend became ready after the deadline");
      if (opts.isAlive && !opts.isAlive()) throw new BackendStartError("exited", "backend exited during startup");
      return;
    } catch (e) {
      if (opts.signal?.aborted) throw new BackendStartError("cancelled", "startup cancelled");
      if (e instanceof BackendStartError) {
        if (e.code === "cancelled" || e.code === "timeout" || e.code === "exited") throw e;
        if (e.code === "auth_failed" || e.code === "wrong_identity") throw e; // deterministic
      }
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await abortableDelay(250, endAt, opts.signal);
  }
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
  let inflight: Promise<void> | null = null;
  const stop = () => {
    if (inflight) return inflight; // repeated stops share the same cleanup outcome
    if (state.stopped || proc.exitCode !== null || proc.signalCode !== null) {
      state.stopped = true;
      return Promise.resolve();
    }
    state.stopped = true;
    inflight = new Promise<void>((resolve) => {
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
    return inflight;
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
  const exitCbs: Array<(info: { code: number | null; signal: NodeJS.Signals | null }) => void> = [];
  const spawnErr: Promise<never> = new Promise((_, reject) => {
    proc.once("error", (e) => {
      alive = false;
      reject(new BackendStartError("spawn_failed", `backend process error: ${e.message}`));
    });
    proc.once("exit", (code, sig) => {
      alive = false;
      earlyExit = `exit code=${code} signal=${sig}`;
      for (const cb of exitCbs.splice(0)) cb({ code, signal: sig });
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
    onExit: (cb) => {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        cb({ code: proc.exitCode, signal: proc.signalCode });
      } else {
        exitCbs.push(cb);
      }
    },
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
    // A failed/cancelled start must terminate and reap its owned child before returning.
    await stop();
    if (e instanceof BackendStartError) {
      if (earlyExit && e.code !== "spawn_failed" && e.code !== "cancelled") {
        throw new BackendStartError("exited", `backend exited during startup (${earlyExit}). ${handle.recentLogs()}`);
      }
      throw e;
    }
    throw new BackendStartError("unknown", e instanceof Error ? e.message : String(e));
  }
}
