// Testable application lifecycle orchestration, decoupled from Electron so the
// real event handlers can be exercised together with the process lifecycle
// (not just isolated helpers). main.ts injects the Electron-backed deps.
//
// Guarantees:
// - internal retry cleanup (destroying a failed attempt's window) never triggers
//   an intentional application quit
// - an intentional quit awaits bounded cleanup of the owned backend process
// - a single shared shutdown promise; repeated stops share one outcome
// - only one post-startup recovery attempt at a time; repeated clicks reuse the
//   in-flight attempt and never spawn competing children
// - a replacement backend starts only after the previous one is fully cleaned up
// - late exit events from a superseded backend attempt are ignored (epoch guard)
// - return to "ready" only after identity + authenticated readiness succeed
// - crash-before-subscribe is delivered on subscribe (status is retained)

export type UnavailableReason = "crashed" | "recovery_failed";

export interface UnavailableStatus {
  reason: UnavailableReason;
  message: string;
}

export interface HandshakeIdentity {
  status: string;
  name: string;
  version: string;
  source_revision: string | null;
  mode: string;
}

export interface LifecycleBackend {
  stop: () => Promise<void>;
  recentLogs: () => string;
  onExit: (cb: () => void) => void;
}

export interface LifecycleDeps {
  createWindow: () => void;
  destroyWindow: () => void;
  startBackend: (signal: AbortSignal) => Promise<LifecycleBackend>;
  loadAppAndShow: () => Promise<void>;
  fetchHandshake: () => Promise<HandshakeIdentity>;
  showStartupErrorDialog: (detail: string) => Promise<boolean>; // true = retry
  notifyUnavailable: (status: UnavailableStatus) => void;
  quit: () => void;
}

export class LifecycleError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type LifecycleState =
  | "idle"
  | "starting"
  | "ready"
  | "unavailable"
  | "recovering"
  | "stopping"
  | "stopped";

function sanitize(msg: string): string {
  return msg.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

export class Lifecycle {
  private deps: LifecycleDeps;
  private state: LifecycleState = "idle";
  private backend: LifecycleBackend | null = null;
  private epoch = 0;
  private restarting = false;
  private quitting = false;
  private bootAbort: AbortController | null = null;
  private recoveryAbort: AbortController | null = null;
  private recoveryPromise: Promise<HandshakeIdentity> | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private unavailableStatus: UnavailableStatus | null = null;

  constructor(deps: LifecycleDeps) {
    this.deps = deps;
  }

  getState(): LifecycleState {
    return this.state;
  }
  isRestarting(): boolean {
    return this.restarting;
  }
  isStopped(): boolean {
    return this.state === "stopped";
  }
  getUnavailableStatus(): UnavailableStatus | null {
    return this.unavailableStatus;
  }

  // Initial launch. On failure BEFORE the renderer can load, a native Retry/Quit
  // dialog is shown; retries reuse this loop without accumulating windows/children.
  async boot(): Promise<void> {
    this.state = "starting";
    this.restarting = true;
    try {
      for (;;) {
        if (this.quitting) return;
        await this.cleanupBackend();
        this.deps.destroyWindow();
        this.deps.createWindow();
        const ac = new AbortController();
        this.bootAbort = ac;
        try {
          const be = await this.deps.startBackend(ac.signal);
          if (this.quitting) {
            await be.stop();
            return;
          }
          this.adoptBackend(be);
          await this.deps.loadAppAndShow();
          this.state = "ready";
          return;
        } catch (e) {
          await this.cleanupBackend();
          this.deps.destroyWindow();
          if (this.quitting) return;
          const detail = sanitize(e instanceof Error ? e.message : String(e));
          const retry = await this.deps.showStartupErrorDialog(detail);
          if (!retry) {
            this.deps.quit();
            return;
          }
          // loop to retry with a brand-new window + child
        } finally {
          this.bootAbort = null;
        }
      }
    } finally {
      this.restarting = false;
    }
  }

  private adoptBackend(be: LifecycleBackend): void {
    this.backend = be;
    this.epoch += 1;
    const myEpoch = this.epoch;
    be.onExit(() => {
      // Ignore late exits from a superseded attempt, or ones we caused.
      if (myEpoch !== this.epoch) return;
      if (this.quitting || this.state === "stopping" || this.state === "stopped") return;
      if (this.restarting || this.state === "recovering") return;
      if (this.state !== "ready") return;
      // Unexpected post-readiness crash -> visible not-ready state + recovery.
      // Keep the (now-dead) handle so recovery's cleanup stops/reaps it before
      // starting a replacement; module wiring clears the live reference on stop.
      this.state = "unavailable";
      this.unavailableStatus = {
        reason: "crashed",
        message: "The local analysis backend stopped unexpectedly.",
      };
      this.deps.notifyUnavailable(this.unavailableStatus);
    });
  }

  // Renderer-triggered, one-at-a-time recovery after a post-startup crash.
  retry(): Promise<HandshakeIdentity> {
    if (this.recoveryPromise) return this.recoveryPromise; // repeated clicks reuse the attempt
    if (this.quitting) return Promise.reject(new LifecycleError("shutting_down", "The application is shutting down."));
    if (this.state !== "unavailable") {
      return Promise.reject(new LifecycleError("not_recoverable", "The backend is not in a recoverable state."));
    }
    this.recoveryPromise = this.doRecovery().finally(() => {
      this.recoveryPromise = null;
    });
    return this.recoveryPromise;
  }

  private async doRecovery(): Promise<HandshakeIdentity> {
    this.state = "recovering";
    // Complete cleanup of the previous owned process before starting a replacement.
    await this.cleanupBackend();
    if (this.quitting) throw new LifecycleError("shutting_down", "The application is shutting down.");
    const ac = new AbortController();
    this.recoveryAbort = ac;
    try {
      const be = await this.deps.startBackend(ac.signal);
      if (this.quitting) {
        await be.stop();
        throw new LifecycleError("shutting_down", "The application is shutting down.");
      }
      this.adoptBackend(be);
      const identity = await this.deps.fetchHandshake();
      this.state = "ready";
      this.unavailableStatus = null;
      return identity;
    } catch (e) {
      await this.cleanupBackend();
      if (this.quitting) throw e instanceof LifecycleError ? e : new LifecycleError("shutting_down", "shutting down");
      const message = sanitize(
        `Recovery failed: ${e instanceof Error ? e.message : String(e)}`
      );
      this.state = "unavailable";
      this.unavailableStatus = { reason: "recovery_failed", message };
      this.deps.notifyUnavailable(this.unavailableStatus);
      throw new LifecycleError("recovery_failed", message);
    } finally {
      this.recoveryAbort = null;
    }
  }

  // Coordinated, idempotent shutdown of the owned backend. Cancels any in-flight
  // startup/recovery. Repeated calls share one outcome.
  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.quitting = true;
    this.bootAbort?.abort();
    this.recoveryAbort?.abort();
    this.shutdownPromise = (async () => {
      this.state = "stopping";
      await this.cleanupBackend();
      this.state = "stopped";
    })();
    return this.shutdownPromise;
  }

  // Called from the window-all-closed handler. Internal retry churn must not quit.
  onWindowAllClosed(): void {
    if (this.restarting) return;
    void this.shutdown().then(() => this.deps.quit());
  }

  private async cleanupBackend(): Promise<void> {
    const be = this.backend;
    this.backend = null;
    if (be) await be.stop();
  }
}
