import { ProjectSafeModeError } from "./errors.js";
import type {
  DatabaseMode,
  SafeModeDiagnostics,
  SafeModeReason,
  SafeModeStatusPayload,
  StateDbLogger,
} from "./types.js";
import { errorMessage } from "./writer-lock.js";

/**
 * Coordinator safe mode. Once armed, new task dispatches and mutating writes
 * are refused. Worktrees and checkpoints are never touched by this controller.
 */
export class SafeModeController {
  private active: { reason: SafeModeReason; diagnostics: SafeModeDiagnostics } | undefined;
  private status: SafeModeStatusPayload | null = null;
  private readonly listeners = new Set<(payload: SafeModeStatusPayload) => void>();

  constructor(
    private readonly projectId: string,
    private readonly logger: StateDbLogger,
  ) {}

  subscribe(listener: (payload: SafeModeStatusPayload) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  isActive(): boolean {
    return this.active !== undefined;
  }

  statusPayload(): SafeModeStatusPayload | null {
    return this.status;
  }

  refuseIfActive(): void {
    if (!this.active) return;
    throw new ProjectSafeModeError(this.active.reason, this.active.diagnostics);
  }

  arm(reason: SafeModeReason, diagnostics: SafeModeDiagnostics): SafeModeDiagnostics {
    const stored: SafeModeDiagnostics = {
      ...diagnostics,
      worktreesPreserved: true,
      checkpointsPreserved: true,
    };
    this.active = { reason, diagnostics: stored };
    return stored;
  }

  publish(mode: DatabaseMode): SafeModeStatusPayload {
    if (!this.active) {
      throw new Error("Safe mode cannot be published before it is armed.");
    }
    const payload: SafeModeStatusPayload = {
      priority: "high",
      projectId: this.projectId,
      mode,
      safeMode: true,
      reason: this.active.reason,
      diagnostics: this.active.diagnostics,
      dispatchBlocked: true,
      writesBlocked: true,
      worktreesPreserved: true,
      checkpointsPreserved: true,
    };
    this.status = payload;
    this.logger.error("project entered safe mode", { event: "state_db.safe_mode", ...payload });
    for (const listener of this.listeners) {
      try {
        listener(payload);
      } catch (error) {
        this.logger.warn("safe mode listener failed", {
          event: "state_db.safe_mode.listener_failed",
          message: errorMessage(error),
        });
      }
    }
    return payload;
  }
}
