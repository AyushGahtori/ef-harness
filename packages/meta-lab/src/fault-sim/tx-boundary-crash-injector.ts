import { CrashSignal, type CrashFaultPoint } from "./crash-signal.js";
import type { TxBoundaryHook } from "./types.js";

export type { CrashFaultPoint };
export { CrashSignal };

/**
 * Arms one abrupt SIGKILL / power-loss injection at an exact transaction hook.
 * Each hook() is a no-op until the armed boundary is reached, then fires once.
 */
export class TxBoundaryCrashInjector {
  private fired: TxBoundaryHook | null = null;

  constructor(private readonly armed: TxBoundaryHook | null) {}

  firedHook(): TxBoundaryHook | null {
    return this.fired;
  }

  hook(point: TxBoundaryHook): void {
    if (this.armed !== point || this.fired !== null) return;
    this.fired = point;
    throw new CrashSignal(point);
  }

  /** Marks close-without-commit without throwing so WAL can be torn down safely. */
  consume(point: TxBoundaryHook): boolean {
    if (this.armed !== point || this.fired !== null) return false;
    this.fired = point;
    return true;
  }
}