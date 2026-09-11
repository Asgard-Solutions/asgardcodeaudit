// Testable application lifecycle orchestration, decoupled from Electron. main.ts
// injects the Electron-backed deps; tests inject controllable substitutes for the
// external runtime boundaries only.
//
// One coordinated owner of cancellation, cleanup, and final-state publication:
// - shutdown JOINS every in-flight startup/recovery AND the actual cleanup of the
//   owned child (a cleared handle is never treated as completed cleanup); it stays
//   pending until that cleanup finishes and is idempotent.
// - ready is published only after attempt-identity, cancellation, terminal-state
//   and current-attempt liveness checks pass at EVERY final publication point
//   (after renderer load, and after the bounded recovery handshake).
// - an unexpected exit of the CURRENT attempt is retained even while starting or
//   recovering, so a later-subscribing renderer still receives the failure; a
//   deliberate teardown or a superseded attempt's exit is ignored.
// - once intentional shutdown begins, no delayed start/recovery response may move
//   the controller or renderer back to a usable state.

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
  // The recovery identity probe is bounded + cancellable like the startup probes.
  fetchHandshake: (signal: AbortSignal) => Promise<HandshakeIdentity>;
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

const CRASH_MSG = "The local analysis backend stopped unexpectedly.";

export class Lifecycle {
  private deps: LifecycleDeps;
  private state: LifecycleState = "idle";

  // Owned child + its attempt identity.
  private ownedBackend: LifecycleBackend | null = null;
  private ownedEpoch = 0;
  private epochSeq = 0;
  private tornDownEpochs = new Set<number>(); // exits from these are deliberate
  private failedEpochExit = false; // current attempt exited unexpectedly (retained)

  private restarting = false;
  private quitting = false;
  private bootAbort: AbortController | null = null;
  private recoveryAbort: AbortController | null = null;

  // Joinable in-flight operations (the coordination core).
  private startTask: Promise<unknown> | null = null; // a start attempt incl. its own settle/cleanup
  private cleanupPromise: Promise<void> | null = null; // the actual owned-child stop in progress
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

  // --- attempt / exit bookkeeping -------------------------------------------

  private newAttemptSignal(kind: "boot" | "recovery"): AbortController {
    const ac = new AbortController();
    if (kind === "boot") this.bootAbort = ac;
    else this.recoveryAbort = ac;
    // Coordinated cancellation: if shutdown already began, abort immediately so a
    // starter created in the race window still cancels and reaps its child.
    if (this.quitting) ac.abort();
    return ac;
  }

  private adopt(be: LifecycleBackend): number {
    this.epochSeq += 1;
    const epoch = this.epochSeq;
    this.ownedBackend = be;
    this.ownedEpoch = epoch;
    this.failedEpochExit = false;
    be.onExit(() => this.handleExit(epoch));
    return epoch;
  }

  private handleExit(epoch: number): void {
    if (epoch !== this.ownedEpoch) return; // superseded attempt
    if (this.tornDownEpochs.has(epoch)) return; // we stopped it deliberately
    if (this.quitting) return; // shutting down; teardown owns the outcome
    // Unexpected exit of the CURRENT attempt — retained regardless of phase.
    this.failedEpochExit = true;
    this.ownedBackend = null;
    this.unavailableStatus = { reason: "crashed", message: CRASH_MSG };
    if (this.state === "ready") {
      this.state = "unavailable";
      this.deps.notifyUnavailable(this.unavailableStatus);
    }
    // While starting/recovering the final publication guard reads failedEpochExit.
  }

  // May this attempt publish a usable "ready" state right now?
  private canPublishReady(epoch: number): boolean {
    return (
      !this.quitting &&
      this.state !== "stopping" &&
      this.state !== "stopped" &&
      this.ownedEpoch === epoch &&
      this.ownedBackend !== null &&
      !this.failedEpochExit
    );
  }

  // --- initial boot ----------------------------------------------------------

  async boot(): Promise<void> {
    this.state = "starting";
    this.restarting = true;
    try {
      for (;;) {
        if (this.quitting) return;
        await this.cleanupBackend();
        this.deps.destroyWindow();
        this.deps.createWindow();
        const ac = this.newAttemptSignal("boot");
        try {
          // The attempt (start + adopt + quitting-teardown) is one joinable unit
          // so shutdown can wait for a starter that has not returned its handle.
          const attempt = (async (): Promise<number | null> => {
            const be = await this.deps.startBackend(ac.signal);
            const epoch = this.adopt(be);
            if (this.quitting) {
              await this.cleanupBackend();
              return null;
            }
            return epoch;
          })();
          this.startTask = attempt;
          let epoch: number | null;
          try {
            epoch = await attempt;
          } finally {
            this.startTask = null;
          }
          if (epoch === null || this.quitting) return;

          await this.deps.loadAppAndShow();

          // Final publication guard: reject a ready transition if shutdown began,
          // the attempt was superseded, or the current backend already exited
          // (Case D: exit during renderer loading -> unavailable, retained).
          if (this.quitting) return;
          if (!this.canPublishReady(epoch)) {
            this.state = "unavailable";
            if (!this.unavailableStatus) {
              this.unavailableStatus = { reason: "crashed", message: CRASH_MSG };
            }
            this.deps.notifyUnavailable(this.unavailableStatus);
            return;
          }
          this.state = "ready";
          return;
        } catch {
          this.startTask = null;
          await this.cleanupBackend();
          this.deps.destroyWindow();
          if (this.quitting) return;
          const retry = await this.deps.showStartupErrorDialog(sanitize("The local analysis backend did not start."));
          if (!retry) {
            this.deps.quit();
            return;
          }
        } finally {
          this.bootAbort = null;
        }
      }
    } finally {
      this.restarting = false;
    }
  }

  // --- recovery --------------------------------------------------------------

  retry(): Promise<HandshakeIdentity> {
    if (this.recoveryPromise) return this.recoveryPromise; // repeated clicks share one attempt
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
    await this.cleanupBackend(); // fully reap the previous owned child first
    if (this.quitting) throw new LifecycleError("shutting_down", "The application is shutting down.");
    const ac = this.newAttemptSignal("recovery");
    try {
      const attempt = (async (): Promise<number | null> => {
        const be = await this.deps.startBackend(ac.signal);
        const epoch = this.adopt(be);
        if (this.quitting) {
          await this.cleanupBackend();
          return null;
        }
        return epoch;
      })();
      this.startTask = attempt;
      let epoch: number | null;
      try {
        epoch = await attempt;
      } finally {
        this.startTask = null;
      }
      if (epoch === null || this.quitting) {
        throw new LifecycleError("shutting_down", "The application is shutting down.");
      }

      // Bounded + cancellable identity probe (same policy as startup probes).
      const identity = await this.deps.fetchHandshake(ac.signal);

      // Final publication guard (Case C: shutdown completed during the handshake;
      // Case E: the replacement exited during the handshake).
      if (this.quitting) throw new LifecycleError("shutting_down", "The application is shutting down.");
      if (!this.canPublishReady(epoch)) {
        const status: UnavailableStatus = this.unavailableStatus ?? {
          reason: "recovery_failed",
          message: "The backend exited during recovery.",
        };
        this.unavailableStatus = status;
        this.state = "unavailable";
        this.deps.notifyUnavailable(status);
        throw new LifecycleError("recovery_failed", status.message);
      }

      this.state = "ready";
      this.unavailableStatus = null;
      return identity;
    } catch (e) {
      this.startTask = null;
      await this.cleanupBackend();
      if (this.quitting) {
        throw e instanceof LifecycleError ? e : new LifecycleError("shutting_down", "The application is shutting down.");
      }
      if (e instanceof LifecycleError && e.code === "recovery_failed") throw e;
      const message = sanitize(`Recovery failed: ${e instanceof Error ? e.message : String(e)}`);
      this.state = "unavailable";
      this.unavailableStatus = { reason: "recovery_failed", message };
      this.deps.notifyUnavailable(this.unavailableStatus);
      throw new LifecycleError("recovery_failed", message);
    } finally {
      this.recoveryAbort = null;
    }
  }

  // --- shutdown --------------------------------------------------------------

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.quitting = true;
    this.bootAbort?.abort();
    this.recoveryAbort?.abort();
    this.shutdownPromise = (async () => {
      this.state = "stopping";
      // 1) Join an in-flight starter — it reaps its own child on cancel, or adopts
      //    a returned handle (which its own quitting-teardown then stops).
      const st = this.startTask;
      if (st) {
        try {
          await st;
        } catch {
          /* starter settled */
        }
      }
      // 2) Join any cleanup already running (a cleared handle is NOT completed cleanup).
      if (this.cleanupPromise) {
        try {
          await this.cleanupPromise;
        } catch {
          /* ignore */
        }
      }
      // 3) Stop whatever is currently adopted (e.g. adopted during the shutdown race).
      await this.cleanupBackend();
      // 4) Join cleanup started concurrently by a boot/recovery catch path.
      if (this.cleanupPromise) {
        try {
          await this.cleanupPromise;
        } catch {
          /* ignore */
        }
      }
      this.state = "stopped";
    })();
    return this.shutdownPromise;
  }

  onWindowAllClosed(): void {
    if (this.restarting) return; // internal retry window churn is not an intentional quit
    void this.shutdown().then(() => this.deps.quit());
  }

  // Stop the currently owned child, coordinated so concurrent callers join the
  // same operation and a cleared handle is not mistaken for completed cleanup.
  private cleanupBackend(): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;
    const be = this.ownedBackend;
    const epoch = this.ownedEpoch;
    this.ownedBackend = null;
    if (!be) return Promise.resolve();
    this.tornDownEpochs.add(epoch); // its subsequent exit is deliberate
    this.cleanupPromise = (async () => {
      try {
        await be.stop();
      } finally {
        this.cleanupPromise = null;
      }
    })();
    return this.cleanupPromise;
  }
}
