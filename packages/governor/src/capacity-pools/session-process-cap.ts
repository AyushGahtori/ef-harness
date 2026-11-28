import type { Clock } from "./clock.js";
import {
  CapacityError,
  SessionCapExceededError,
  assertNonEmpty,
  assertPositiveInt,
} from "./errors.js";
import type { IdleWrappedAgentParkerPort } from "./ports.js";
import {
  FOREIGN_SESSION_RAM_DEFAULT_MB,
  FOREIGN_SESSION_RAM_MAX_MB,
  FOREIGN_SESSION_RAM_MIN_MB,
  isForeignRuntime,
  type ForeignRuntime,
} from "./types.js";

export interface ResidentForeignSession {
  readonly sessionId: string;
  readonly runtime: ForeignRuntime;
  readonly residentRamMb: number;
  lastActiveAt: number;
  busy: boolean;
  state: "active" | "parked";
}

export interface SpawnForeignSessionRequest {
  readonly sessionId: string;
  readonly runtime: ForeignRuntime;
  readonly residentRamMb?: number;
  readonly lastActiveAt?: number;
  readonly busy?: boolean;
}

export interface ParkedForeignSession {
  readonly sessionId: string;
  readonly runtime: ForeignRuntime;
  readonly reclaimedRamMb: number;
  readonly idleMs: number;
}

/**
 * Pool 3. Resident foreign CLI processes stay at or below the session-process cap.
 * Idle wrapped sessions are checkpointed and parked before another one is spawned.
 */
export class SessionProcessCapGuard {
  private readonly sessions = new Map<string, ResidentForeignSession>();
  private reclaimed = 0;
  readonly cap: number;

  constructor(
    private readonly clock: Clock,
    cap: number,
    private readonly parker: IdleWrappedAgentParkerPort,
  ) {
    assertPositiveInt(cap, "sessionProcessCap");
    this.cap = cap;
  }

  activeCount(): number {
    let total = 0;
    for (const session of this.sessions.values()) {
      if (session.state === "active") total += 1;
    }
    return total;
  }

  parkedCount(): number {
    let total = 0;
    for (const session of this.sessions.values()) {
      if (session.state === "parked") total += 1;
    }
    return total;
  }

  reclaimedRamMb(): number {
    return this.reclaimed;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  get(sessionId: string): ResidentForeignSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new CapacityError("session", `Unknown foreign session ${sessionId}`);
    return session;
  }

  /** Record sessions that are already resident, including a set that is over the cap. */
  observeResident(request: SpawnForeignSessionRequest): ResidentForeignSession {
    return this.insert(request, "active");
  }

  /**
   * Park the longest-idle sessions until the resident count is back inside the cap.
   * Parking runs before any later spawn is allowed to proceed.
   */
  enforceCeiling(): ParkedForeignSession[] {
    const parked: ParkedForeignSession[] = [];
    while (this.activeCount() > this.cap) {
      parked.push(this.parkLongestIdle());
    }
    return parked;
  }

  /**
   * Spawn one foreign session. If the cap is full, checkpoint and park the
   * longest-idle wrapped sessions first so the resident count never exceeds it.
   */
  spawn(request: SpawnForeignSessionRequest): ResidentForeignSession {
    while (this.activeCount() + 1 > this.cap) {
      this.parkLongestIdle();
    }
    return this.insert(request, "active");
  }

  markBusy(sessionId: string, busy: boolean): void {
    const session = this.get(sessionId);
    session.busy = busy;
    if (busy) session.lastActiveAt = this.clock.now();
  }

  private parkLongestIdle(): ParkedForeignSession {
    const victim = this.longestIdle();
    if (!victim) throw new SessionCapExceededError(this.cap, this.activeCount());
    const idleMs = Math.max(0, this.clock.now() - victim.lastActiveAt);
    const result = this.parker.checkpointAndPark({
      sessionId: victim.sessionId,
      runtime: victim.runtime,
      residentRamMb: victim.residentRamMb,
      idleMs,
      reason: "session_process_cap",
    });
    victim.state = "parked";
    victim.busy = false;
    this.reclaimed += result.reclaimedRamMb;
    return {
      sessionId: victim.sessionId,
      runtime: victim.runtime,
      reclaimedRamMb: result.reclaimedRamMb,
      idleMs,
    };
  }

  private longestIdle(): ResidentForeignSession | null {
    let best: ResidentForeignSession | null = null;
    for (const session of this.sessions.values()) {
      if (session.state !== "active" || session.busy) continue;
      if (!best) {
        best = session;
        continue;
      }
      if (session.lastActiveAt < best.lastActiveAt) {
        best = session;
        continue;
      }
      if (session.lastActiveAt === best.lastActiveAt && session.sessionId < best.sessionId) {
        best = session;
      }
    }
    return best;
  }

  private insert(
    request: SpawnForeignSessionRequest,
    state: "active" | "parked",
  ): ResidentForeignSession {
    assertNonEmpty(request.sessionId, "sessionId");
    if (!isForeignRuntime(request.runtime)) {
      throw new CapacityError("session", `Unsupported foreign runtime ${request.runtime}`);
    }
    if (this.sessions.has(request.sessionId)) {
      throw new CapacityError("session", `Foreign session ${request.sessionId} already exists`);
    }
    const residentRamMb = request.residentRamMb ?? FOREIGN_SESSION_RAM_DEFAULT_MB;
    if (
      !Number.isInteger(residentRamMb) ||
      residentRamMb < FOREIGN_SESSION_RAM_MIN_MB ||
      residentRamMb > FOREIGN_SESSION_RAM_MAX_MB
    ) {
      throw new CapacityError(
        "session",
        `Foreign session RAM must be an integer from ${FOREIGN_SESSION_RAM_MIN_MB} to ${FOREIGN_SESSION_RAM_MAX_MB} MB`,
      );
    }
    const session: ResidentForeignSession = {
      sessionId: request.sessionId,
      runtime: request.runtime,
      residentRamMb,
      lastActiveAt: request.lastActiveAt ?? this.clock.now(),
      busy: request.busy === true,
      state,
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }
}
