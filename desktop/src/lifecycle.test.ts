import { describe, it, expect, vi } from "vitest";
import { Lifecycle, type LifecycleBackend, type LifecycleDeps, type HandshakeIdentity } from "./lifecycle";

const IDENTITY: HandshakeIdentity = {
  status: "ready",
  name: "Asgard CodeAudit",
  version: "0.1.0",
  source_revision: null,
  mode: "desktop",
};

function deferred<T = void>() {
  let resolve!: (v: T | PromiseLike<T>) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Controllable fake backend. stop() can be gated to model cleanup that is still
// in flight; onExit callbacks are retained so a stray/late exit can be replayed.
function makeFakeBackend(stopGate?: Promise<void>) {
  const exitCbs: Array<() => void> = [];
  let stopped = false;
  const be: LifecycleBackend & { triggerExit: () => void; stopped: () => boolean; stopCalls: number } = {
    stopCalls: 0,
    stop: vi.fn(async () => {
      be.stopCalls += 1;
      if (stopGate) await stopGate;
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

// A starter that hangs until its abort signal fires, then models reaping its
// owned-but-unreturned child by awaiting a cleanup gate BEFORE rejecting.
function deferredStarter() {
  const cleanup = deferred();
  const start = (signal: AbortSignal): Promise<LifecycleBackend> =>
    new Promise((_resolve, reject) => {
      const onAbort = () => cleanup.promise.then(() => reject(new Error("cancelled")));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
  return { start, releaseCleanup: () => cleanup.resolve() };
}

async function isPending(p: Promise<unknown>): Promise<boolean> {
  const marker = Symbol("pending");
  const race = await Promise.race([p.then(() => "settled", () => "settled"), Promise.resolve(marker)]);
  return race === marker;
}

function baseDeps(overrides: Partial<LifecycleDeps> = {}): LifecycleDeps {
  return {
    createWindow: vi.fn(),
    destroyWindow: vi.fn(),
    startBackend: vi.fn(async () => makeFakeBackend()),
    loadAppAndShow: vi.fn(async () => {}),
    fetchHandshake: vi.fn(async () => IDENTITY),
    showStartupErrorDialog: vi.fn(async () => false),
    notifyUnavailable: vi.fn(),
    quit: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Existing behavior (must keep passing)
// ---------------------------------------------------------------------------

describe("initial boot + failed-start retry (retained)", () => {
  it("boots to ready on success", async () => {
    const deps = baseDeps();
    const lc = new Lifecycle(deps);
    await lc.boot();
    expect(lc.getState()).toBe("ready");
    expect(deps.quit).not.toHaveBeenCalled();
  });

  it("failed start shows a dialog; Retry starts a fresh attempt without quitting", async () => {
    let attempt = 0;
    const deps = baseDeps({
      startBackend: vi.fn(async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("port in use");
        return makeFakeBackend();
      }),
      showStartupErrorDialog: vi.fn(async () => true),
    });
    const lc = new Lifecycle(deps);
    await lc.boot();
    expect(deps.startBackend).toHaveBeenCalledTimes(2);
    expect(lc.getState()).toBe("ready");
    expect(deps.quit).not.toHaveBeenCalled();
  });

  it("failed start + Quit choice quits and does not loop", async () => {
    const deps = baseDeps({
      startBackend: vi.fn(async () => {
        throw new Error("boom");
      }),
      showStartupErrorDialog: vi.fn(async () => false),
    });
    const lc = new Lifecycle(deps);
    await lc.boot();
    expect(deps.quit).toHaveBeenCalledOnce();
    expect(deps.startBackend).toHaveBeenCalledOnce();
  });

  it("window-all-closed quits when ready", async () => {
    const deps = baseDeps();
    const lc = new Lifecycle(deps);
    await lc.boot();
    lc.onWindowAllClosed();
    await new Promise((r) => setTimeout(r, 0));
    expect(deps.quit).toHaveBeenCalledOnce();
  });
});

describe("recovery basics (retained)", () => {
  it("crash after ready -> unavailable + notify; Retry recovers", async () => {
    const first = makeFakeBackend();
    const second = makeFakeBackend();
    let n = 0;
    const deps = baseDeps({ startBackend: vi.fn(async () => (++n === 1 ? first : second)) });
    const lc = new Lifecycle(deps);
    await lc.boot();
    first.triggerExit();
    expect(lc.getState()).toBe("unavailable");
    expect(deps.notifyUnavailable).toHaveBeenCalledWith(expect.objectContaining({ reason: "crashed" }));
    const id = await lc.retry();
    expect(id.name).toBe("Asgard CodeAudit");
    expect(lc.getState()).toBe("ready");
    expect(deps.startBackend).toHaveBeenCalledTimes(2);
  });

  it("repeated Retry clicks reuse one in-flight attempt", async () => {
    const first = makeFakeBackend();
    let started = 0;
    const gate = deferred<LifecycleBackend>();
    const deps = baseDeps({
      startBackend: vi.fn(() => (++started === 1 ? Promise.resolve(first) : gate.promise)),
    });
    const lc = new Lifecycle(deps);
    await lc.boot();
    first.triggerExit();
    const p1 = lc.retry();
    const p2 = lc.retry();
    expect(p1).toBe(p2);
    await vi.waitFor(() => expect(deps.startBackend).toHaveBeenCalledTimes(2));
    gate.resolve(makeFakeBackend());
    await p1;
    expect(deps.startBackend).toHaveBeenCalledTimes(2);
  });

  it("retry rejected when not recoverable", async () => {
    const lc = new Lifecycle(baseDeps());
    await lc.boot();
    await expect(lc.retry()).rejects.toMatchObject({ code: "not_recoverable" });
  });

  it("recovery failure returns to unavailable", async () => {
    const first = makeFakeBackend();
    let n = 0;
    const deps = baseDeps({
      startBackend: vi.fn(async () => {
        if (++n === 1) return first;
        throw new Error("still not ready");
      }),
    });
    const lc = new Lifecycle(deps);
    await lc.boot();
    first.triggerExit();
    await expect(lc.retry()).rejects.toMatchObject({ code: "recovery_failed" });
    expect(lc.getState()).toBe("unavailable");
  });

  it("ignores a late exit from a superseded attempt", async () => {
    const first = makeFakeBackend();
    const second = makeFakeBackend();
    let n = 0;
    const deps = baseDeps({ startBackend: vi.fn(async () => (++n === 1 ? first : second)) });
    const lc = new Lifecycle(deps);
    await lc.boot();
    first.triggerExit();
    await lc.retry();
    (deps.notifyUnavailable as ReturnType<typeof vi.fn>).mockClear();
    first.triggerExit(); // stray late event from the old process
    expect(lc.getState()).toBe("ready");
    expect(deps.notifyUnavailable).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The five reproduced failures
// ---------------------------------------------------------------------------

describe("1. shutdown joins every owned startup/cleanup operation", () => {
  it("Case A: shutdown stays pending until a starter (child not yet returned) finishes reaping", async () => {
    const ds = deferredStarter();
    const deps = baseDeps({ startBackend: vi.fn(ds.start) });
    const lc = new Lifecycle(deps);
    const bootP = lc.boot().catch(() => {});
    await new Promise((r) => setTimeout(r, 5));
    const sd = lc.shutdown();
    expect(await isPending(sd)).toBe(true); // starter cleanup not finished
    expect(lc.isStopped()).toBe(false);
    ds.releaseCleanup();
    await sd;
    expect(lc.isStopped()).toBe(true);
    await bootP;
  });

  it("Case B: concurrent shutdown joins recovery's in-flight cleanup (cleared handle != done)", async () => {
    const first = makeFakeBackend();
    const stopGate = deferred();
    const second = makeFakeBackend(stopGate.promise); // deferred stop
    const hs = deferred<HandshakeIdentity>(); // park recovery at the handshake
    let n = 0;
    const deps = baseDeps({
      startBackend: vi.fn(async () => (++n === 1 ? first : second)),
      fetchHandshake: vi.fn(() => hs.promise),
    });
    const lc = new Lifecycle(deps);
    await lc.boot();
    first.triggerExit();
    const recovery = lc.retry().catch(() => {});
    await vi.waitFor(() => expect(deps.fetchHandshake).toHaveBeenCalled());
    const sd = lc.shutdown();
    // shutdown must stop `second` and stay pending until that stop resolves
    await new Promise((r) => setTimeout(r, 5));
    expect(await isPending(sd)).toBe(true);
    expect(second.stop).toHaveBeenCalled();
    stopGate.resolve();
    await sd;
    expect(lc.isStopped()).toBe(true);
    hs.resolve(IDENTITY); // let the parked recovery unwind
    await recovery;
    expect(lc.getState()).toBe("stopped");
  });
});

describe("2. reject late ready transitions; retain current-attempt exits", () => {
  it("Case C: a handshake released AFTER shutdown completes must not revive ready", async () => {
    const first = makeFakeBackend();
    const second = makeFakeBackend();
    const hs = deferred<HandshakeIdentity>();
    let n = 0;
    const deps = baseDeps({
      startBackend: vi.fn(async () => (++n === 1 ? first : second)),
      fetchHandshake: vi.fn(() => hs.promise),
    });
    const lc = new Lifecycle(deps);
    await lc.boot();
    first.triggerExit();
    const recovery = lc.retry().catch((e) => e);
    await vi.waitFor(() => expect(deps.fetchHandshake).toHaveBeenCalled());
    await lc.shutdown();
    expect(lc.isStopped()).toBe(true);
    hs.resolve(IDENTITY); // release the paused handshake AFTER shutdown
    const result = await recovery;
    expect(result).toMatchObject({ code: "shutting_down" });
    expect(lc.getState()).toBe("stopped"); // never back to ready
  });

  it("Case D: current backend exits during renderer loading -> unavailable, not ready", async () => {
    const be = makeFakeBackend();
    const load = deferred();
    const deps = baseDeps({
      startBackend: vi.fn(async () => be),
      loadAppAndShow: vi.fn(() => load.promise),
    });
    const lc = new Lifecycle(deps);
    const bootP = lc.boot();
    await vi.waitFor(() => expect(deps.loadAppAndShow).toHaveBeenCalled());
    be.triggerExit(); // exit while renderer loading is pending
    load.resolve();
    await bootP;
    expect(lc.getState()).toBe("unavailable");
    expect(deps.notifyUnavailable).toHaveBeenCalledWith(expect.objectContaining({ reason: "crashed" }));
    // a later subscriber still sees the failure
    expect(lc.getUnavailableStatus()?.reason).toBe("crashed");
  });

  it("Case E: replacement exits during recovery handshake -> recovery does not report ready", async () => {
    const first = makeFakeBackend();
    const second = makeFakeBackend();
    const hs = deferred<HandshakeIdentity>();
    let n = 0;
    const deps = baseDeps({
      startBackend: vi.fn(async () => (++n === 1 ? first : second)),
      fetchHandshake: vi.fn(() => hs.promise),
    });
    const lc = new Lifecycle(deps);
    await lc.boot();
    first.triggerExit();
    const recovery = lc.retry().catch((e) => e);
    await vi.waitFor(() => expect(deps.fetchHandshake).toHaveBeenCalled());
    second.triggerExit(); // replacement exits mid-handshake
    hs.resolve(IDENTITY); // then a successful response arrives late
    const result = await recovery;
    expect(result).toMatchObject({ code: "recovery_failed" });
    expect(lc.getState()).toBe("unavailable"); // never ready for the exited backend
  });
});

describe("shutdown idempotency + no intentional quit from retry churn (retained)", () => {
  it("repeated shutdown shares one cleanup outcome", async () => {
    const be = makeFakeBackend();
    const deps = baseDeps({ startBackend: vi.fn(async () => be) });
    const lc = new Lifecycle(deps);
    await lc.boot();
    await Promise.all([lc.shutdown(), lc.shutdown(), lc.shutdown()]);
    expect(be.stop).toHaveBeenCalledOnce();
    expect(lc.isStopped()).toBe(true);
  });

  it("quit during startup cancels an attempt whose handle was not returned", async () => {
    const ds = deferredStarter();
    const deps = baseDeps({ startBackend: vi.fn(ds.start) });
    const lc = new Lifecycle(deps);
    const bootP = lc.boot().catch(() => {});
    await new Promise((r) => setTimeout(r, 5));
    const sd = lc.shutdown();
    ds.releaseCleanup();
    await sd;
    await bootP;
    expect(deps.showStartupErrorDialog).not.toHaveBeenCalled();
    expect(lc.isStopped()).toBe(true);
  });
});
