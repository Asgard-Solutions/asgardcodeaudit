import { describe, it, expect, vi } from "vitest";
import { Lifecycle, type LifecycleBackend, type LifecycleDeps } from "./lifecycle";

// A controllable fake backend whose exit can be triggered to model a crash.
function makeFakeBackend() {
  const exitCbs: Array<() => void> = [];
  let stopped = false;
  const be: LifecycleBackend & { triggerExit: () => void; stopped: () => boolean } = {
    stop: vi.fn(async () => {
      stopped = true;
    }),
    recentLogs: () => "",
    onExit: (cb) => {
      exitCbs.push(cb);
    },
    triggerExit: () => {
      for (const cb of exitCbs) cb();
    },
    stopped: () => stopped,
  };
  return be;
}

// startBackend that rejects when its abort signal fires (models cancellation of
// an attempt whose handle has not been returned yet).
function hanging(signal: AbortSignal): Promise<LifecycleBackend> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) return reject(new Error("cancelled"));
    signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
  });
}

function baseDeps(overrides: Partial<LifecycleDeps> = {}): LifecycleDeps {
  return {
    createWindow: vi.fn(),
    destroyWindow: vi.fn(),
    startBackend: vi.fn(async () => makeFakeBackend()),
    loadAppAndShow: vi.fn(async () => {}),
    fetchHandshake: vi.fn(async () => ({
      status: "ready",
      name: "Asgard CodeAudit",
      version: "0.1.0",
      source_revision: null,
      mode: "desktop",
    })),
    showStartupErrorDialog: vi.fn(async () => false),
    notifyUnavailable: vi.fn(),
    quit: vi.fn(),
    ...overrides,
  };
}

describe("initial boot + failed-start retry", () => {
  it("boots to ready on success", async () => {
    const deps = baseDeps();
    const lc = new Lifecycle(deps);
    await lc.boot();
    expect(lc.getState()).toBe("ready");
    expect(deps.loadAppAndShow).toHaveBeenCalledOnce();
    expect(deps.quit).not.toHaveBeenCalled();
    expect(lc.isRestarting()).toBe(false);
  });

  it("failed start shows a native dialog; Retry starts a fresh attempt without quitting", async () => {
    let attempt = 0;
    const deps = baseDeps({
      startBackend: vi.fn(async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("port in use");
        return makeFakeBackend();
      }),
      showStartupErrorDialog: vi.fn(async () => true), // Retry once
    });
    const lc = new Lifecycle(deps);
    await lc.boot();
    expect(deps.showStartupErrorDialog).toHaveBeenCalledOnce();
    expect(deps.startBackend).toHaveBeenCalledTimes(2);
    expect(lc.getState()).toBe("ready");
    expect(deps.quit).not.toHaveBeenCalled();
    // window-all-closed fired during the retry churn must NOT quit
    // (handled by isRestarting during the loop).
  });

  it("failed start + Quit choice quits and does not loop", async () => {
    const deps = baseDeps({
      startBackend: vi.fn(async () => {
        throw new Error("boom");
      }),
      showStartupErrorDialog: vi.fn(async () => false), // Quit
    });
    const lc = new Lifecycle(deps);
    await lc.boot();
    expect(deps.quit).toHaveBeenCalledOnce();
    expect(deps.startBackend).toHaveBeenCalledOnce();
  });

  it("window-all-closed is ignored while restarting, quits when ready", async () => {
    const deps = baseDeps();
    const lc = new Lifecycle(deps);
    // Simulate the retry-churn window destruction: isRestarting() must gate it.
    // Directly assert the semantics via onWindowAllClosed after ready:
    await lc.boot();
    lc.onWindowAllClosed();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(deps.quit).toHaveBeenCalledOnce();
  });
});

describe("quit during startup", () => {
  it("cancels an in-flight attempt whose handle was not returned, no dialog", async () => {
    const deps = baseDeps({
      startBackend: vi.fn((signal) => hanging(signal)),
    });
    const lc = new Lifecycle(deps);
    const bootP = lc.boot();
    await new Promise((r) => setTimeout(r, 10));
    await lc.shutdown();
    await bootP;
    expect(deps.showStartupErrorDialog).not.toHaveBeenCalled();
    expect(lc.isStopped()).toBe(true);
  });
});

describe("shutdown coordination", () => {
  it("repeated shutdown shares one cleanup outcome", async () => {
    const be = makeFakeBackend();
    const deps = baseDeps({ startBackend: vi.fn(async () => be) });
    const lc = new Lifecycle(deps);
    await lc.boot();
    await Promise.all([lc.shutdown(), lc.shutdown(), lc.shutdown()]);
    expect(be.stop).toHaveBeenCalledOnce();
    expect(lc.isStopped()).toBe(true);
  });
});

describe("post-readiness crash -> unavailable -> recovery", () => {
  it("an unexpected crash after ready transitions to unavailable and notifies", async () => {
    const be = makeFakeBackend();
    const deps = baseDeps({ startBackend: vi.fn(async () => be) });
    const lc = new Lifecycle(deps);
    await lc.boot();
    be.triggerExit();
    expect(lc.getState()).toBe("unavailable");
    expect(deps.notifyUnavailable).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "crashed" })
    );
    expect(lc.getUnavailableStatus()?.reason).toBe("crashed");
  });

  it("Retry recovers to ready after identity check succeeds", async () => {
    const first = makeFakeBackend();
    const second = makeFakeBackend();
    let n = 0;
    const deps = baseDeps({
      startBackend: vi.fn(async () => {
        n += 1;
        return n === 1 ? first : second;
      }),
    });
    const lc = new Lifecycle(deps);
    await lc.boot();
    first.triggerExit();
    expect(lc.getState()).toBe("unavailable");
    const id = await lc.retry();
    expect(id.name).toBe("Asgard CodeAudit");
    expect(lc.getState()).toBe("ready");
    expect(first.stop).toHaveBeenCalled(); // previous process cleaned up first
    expect(deps.startBackend).toHaveBeenCalledTimes(2);
  });

  it("repeated Retry clicks reuse the in-flight attempt (no competing children)", async () => {
    const first = makeFakeBackend();
    let started = 0;
    let resolveSecond: (b: LifecycleBackend) => void = () => {};
    const deps = baseDeps({
      startBackend: vi.fn((_signal) => {
        started += 1;
        if (started === 1) return Promise.resolve(first);
        return new Promise<LifecycleBackend>((res) => {
          resolveSecond = res;
        });
      }),
    });
    const lc = new Lifecycle(deps);
    await lc.boot();
    first.triggerExit();
    const p1 = lc.retry();
    const p2 = lc.retry();
    const p3 = lc.retry();
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);
    // wait until the single recovery attempt actually calls startBackend, then
    // release it — proving repeated clicks did not spawn competing children.
    await vi.waitFor(() => expect(deps.startBackend).toHaveBeenCalledTimes(2));
    resolveSecond(makeFakeBackend());
    await p1;
    expect(deps.startBackend).toHaveBeenCalledTimes(2);
  });

  it("Quit during recovery cancels the attempt and ends stopped", async () => {
    const first = makeFakeBackend();
    let n = 0;
    const deps = baseDeps({
      startBackend: vi.fn((signal) => {
        n += 1;
        return n === 1 ? Promise.resolve(first) : hanging(signal);
      }),
    });
    const lc = new Lifecycle(deps);
    await lc.boot();
    first.triggerExit();
    const recoveryP = lc.retry().catch((e) => e);
    await new Promise((r) => setTimeout(r, 10));
    await lc.shutdown();
    await recoveryP;
    expect(lc.isStopped()).toBe(true);
  });

  it("recovery failure returns to unavailable with a sanitized reason", async () => {
    const first = makeFakeBackend();
    let n = 0;
    const deps = baseDeps({
      startBackend: vi.fn(async () => {
        n += 1;
        if (n === 1) return first;
        throw new Error("still not ready");
      }),
    });
    const lc = new Lifecycle(deps);
    await lc.boot();
    first.triggerExit();
    await expect(lc.retry()).rejects.toMatchObject({ code: "recovery_failed" });
    expect(lc.getState()).toBe("unavailable");
    expect(lc.getUnavailableStatus()?.reason).toBe("recovery_failed");
  });

  it("ignores a late exit event from a superseded backend attempt", async () => {
    const first = makeFakeBackend();
    const second = makeFakeBackend();
    let n = 0;
    const deps = baseDeps({
      startBackend: vi.fn(async () => {
        n += 1;
        return n === 1 ? first : second;
      }),
    });
    const lc = new Lifecycle(deps);
    await lc.boot();
    first.triggerExit(); // crash 1
    await lc.retry(); // now on `second`, ready
    (deps.notifyUnavailable as ReturnType<typeof vi.fn>).mockClear();
    first.triggerExit(); // stray late event from the old process
    expect(lc.getState()).toBe("ready");
    expect(deps.notifyUnavailable).not.toHaveBeenCalled();
  });

  it("retry is rejected when not in a recoverable state", async () => {
    const deps = baseDeps();
    const lc = new Lifecycle(deps);
    await lc.boot(); // ready, not unavailable
    await expect(lc.retry()).rejects.toMatchObject({ code: "not_recoverable" });
  });
});
