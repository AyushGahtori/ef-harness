export const FAULT_POINTS = [
  "before_begin_immediate",
  "after_write_before_commit",
  "after_commit_before_ipc_receipt",
  "after_issue_grant_before_deposit",
  "after_close_grant_before_broker_ack",
  "after_outbox_append_before_delivered_at",
  "during_cas_temp_rename",
  "during_sleep_jump",
] as const;

export type FaultPoint = (typeof FAULT_POINTS)[number];

export function faultForSeed(seed: number): FaultPoint {
  const point = FAULT_POINTS[Math.abs(seed) % FAULT_POINTS.length];
  if (!point) {
    throw new Error("fault table is empty");
  }
  return point;
}

/** Thrown by the injector. The event loop recovers and continues the schedule. */
export class CrashSignal extends Error {
  readonly point: FaultPoint;

  constructor(point: FaultPoint) {
    super(`crash:${point}`);
    this.name = "CrashSignal";
    this.point = point;
  }
}

/**
 * Arms one transaction-boundary crash. Each hit() is a no-op until the armed
 * point is reached, then it fires exactly once.
 */
export class CrashFaultInjector {
  private firedPoint: FaultPoint | null = null;

  constructor(private readonly armed: FaultPoint | null) {}

  fired(): FaultPoint | null {
    return this.firedPoint;
  }

  hit(point: FaultPoint): void {
    if (this.armed !== point || this.firedPoint !== null) return;
    this.firedPoint = point;
    throw new CrashSignal(point);
  }

  /**
   * Marks the close-without-commit fault without throwing, so the caller can
   * close the SQLite connection before the signal propagates.
   */
  consume(point: FaultPoint): boolean {
    if (this.armed !== point || this.firedPoint !== null) return false;
    this.firedPoint = point;
    return true;
  }
}
