import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";

// Owns the lifecycle of the loopback FastAPI backend in desktop mode.
// - binds only to 127.0.0.1 on an ephemeral port
// - passes a random per-launch session secret over the child's stdin pipe
//   (never via argv, URL, env, logs, or a config file)
// - polls the unauthenticated readiness handshake before the app is usable

export interface BackendHandle {
  host: string;
  port: number;
  secret: string;
  proc: ChildProcess;
  stop: () => void;
}

async function freeLoopbackPort(): Promise<number> {
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

export interface SpawnOptions {
  backendExe?: string; // packaged PyInstaller sidecar
  pythonCmd?: string; // dev fallback, e.g. "python"
  backendDir: string; // cwd for dev uvicorn
  dataDir: string; // app-owned data dir (userData)
}

export async function startBackend(opts: SpawnOptions): Promise<BackendHandle> {
  const host = "127.0.0.1";
  const port = await freeLoopbackPort();
  const secret = randomBytes(48).toString("base64url");

  const env = {
    ...process.env,
    ASGARD_MODE: "desktop",
    ASGARD_DATA_DIR: opts.dataDir,
    ASGARD_PREVIEW_ORIGINS: "",
  };

  let proc: ChildProcess;
  if (opts.backendExe) {
    proc = spawn(opts.backendExe, ["--host", host, "--port", String(port)], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
  } else {
    // Dev fallback: run uvicorn against the source backend. Never uses --reload
    // (reload would break the stdin secret pipe and single-owner guarantee).
    proc = spawn(
      opts.pythonCmd ?? "python",
      ["-m", "uvicorn", "server:app", "--host", host, "--port", String(port)],
      { cwd: opts.backendDir, stdio: ["pipe", "pipe", "pipe"], env }
    );
  }

  // Deliver the per-launch secret over the private stdin pipe, then close it.
  proc.stdin?.write(JSON.stringify({ mode: "desktop", session_secret: secret }) + "\n");
  proc.stdin?.end();

  const stop = () => {
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
  };

  await waitForReady(host, port, 20000);
  return { host, port, secret, proc, stop };
}

export async function waitForReady(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://${host}:${port}/api/v1/startup/handshake`;
  let lastErr = "no response";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastErr = `status ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Backend did not become ready within ${timeoutMs}ms (${lastErr}).`);
}
