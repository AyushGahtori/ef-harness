import type { CadenceClock } from "./clock.js";
import { systemClock } from "./clock.js";
import type { FocusModeAndInterruptionBudget } from "./focus.js";
import { batchAnnouncement } from "./text.js";
import {
  CALM_BATCH_MS,
  type BatchSubject,
  type InterruptCondition,
  type Priority,
  type ReleaseReason,
} from "./types.js";

export interface ScheduledCard {
  readonly id: string;
  readonly priority: Priority;
  readonly condition: InterruptCondition | null;
  readonly subject: BatchSubject;
  readonly createdAt: number;
  readonly subscribers: readonly string[];
  readonly onCriticalPath: boolean;
  readonly blockedTaskCount: number;
  readonly lane: "interrupt_now" | "batch" | "fyi";
}

export interface ScheduledPatch {
  readonly subscribers?: readonly string[];
  readonly onCriticalPath?: boolean;
  readonly blockedTaskCount?: number;
}

export interface CadenceRelease {
  readonly at: number;
  readonly reason: ReleaseReason;
  readonly cardIds: readonly string[];
  readonly headline: string | null;
  readonly sound: boolean;
  readonly modal: false;
}

interface Tracked {
  card: ScheduledCard;
  state: "queued" | "surfaced" | "fyi" | "retired";
}

export interface NotificationCadenceSchedulerOptions {
  readonly clock?: CadenceClock;
  readonly policy?: FocusModeAndInterruptionBudget;
}

/**
 * Three delivery lanes:
 * interrupt-now for Stop, Budget, Auth-Expiry, Disk-Red, and Breaking-Stop;
 * a 10-minute batch that flushes early for the critical path or two subscribers;
 * an FYI digest that never becomes an actionable badge.
 */
export class NotificationCadenceScheduler {
  private readonly clock: CadenceClock;
  private readonly policy: FocusModeAndInterruptionBudget | null;
  private readonly tracked = new Map<string, Tracked>();
  private readonly releaseLog: CadenceRelease[] = [];
  private readonly listeners = new Set<() => void>();
  private batchDueAt: number | null = null;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private headline: string | null = null;
  private coalescedOverBudget = false;
  private quietHold: "focus" | "budget" | null = null;

  constructor(options: NotificationCadenceSchedulerOptions = {}) {
    this.clock = options.clock ?? systemClock();
    this.policy = options.policy ?? null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  enqueue(card: ScheduledCard): void {
    if (this.tracked.has(card.id)) return;
    const state = card.lane === "fyi" ? "fyi" : "queued";
    const tracked = { card, state } as Tracked;
    this.tracked.set(card.id, tracked);
    if (card.lane === "interrupt_now") {
      this.surface([tracked], "interrupt", this.clock.now());
      return;
    }
    if (card.lane === "fyi") {
      this.emit();
      return;
    }
    this.ensureWindow(this.clock.now());
    this.tryEarly(tracked);
  }

  update(id: string, patch: ScheduledPatch): void {
    const tracked = this.tracked.get(id);
    if (!tracked || tracked.state === "retired") return;
    tracked.card = {
      ...tracked.card,
      ...(patch.subscribers !== undefined ? { subscribers: patch.subscribers } : {}),
      ...(patch.onCriticalPath !== undefined ? { onCriticalPath: patch.onCriticalPath } : {}),
      ...(patch.blockedTaskCount !== undefined ? { blockedTaskCount: patch.blockedTaskCount } : {}),
    };
    if (tracked.state === "surfaced" || tracked.card.lane !== "batch") {
      this.emit();
      return;
    }
    this.tryEarly(tracked);
  }

  retire(id: string): void {
    const tracked = this.tracked.get(id);
    if (!tracked) return;
    tracked.state = "retired";
    if (this.queuedBatch().length === 0) this.disarm();
    this.emit();
  }

  openManually(): void {
    const queued = this.sort(this.queuedBatch());
    if (queued.length === 0) return;
    this.surface(queued, "manual", this.clock.now());
  }

  refresh(): void {
    const now = this.clock.now();
    if (this.holdRoutine(now)) {
      this.quietHold = "focus";
      this.armPolicyWake(now);
      this.emit();
      return;
    }
    for (const card of [...this.queuedBatch()]) this.tryEarly(card);
    if (this.batchDueAt !== null && now >= this.batchDueAt && this.queuedBatch().length > 0) {
      this.releaseWindow();
      return;
    }
    if (this.batchDueAt !== null && this.queuedBatch().length > 0) {
      this.scheduleWake(Math.max(0, this.batchDueAt - now));
    }
  }

  releases(): readonly CadenceRelease[] {
    return this.releaseLog;
  }

  lastHeadline(): string | null {
    return this.headline;
  }

  coalesced(): boolean {
    return this.coalescedOverBudget;
  }

  quietHoldReason(): "focus" | "budget" | null {
    return this.quietHold;
  }

  surfacedIds(): readonly string[] {
    return this.byState("surfaced");
  }

  queuedIds(): readonly string[] {
    return this.queuedBatch().map((card) => card.card.id);
  }

  fyiIds(): readonly string[] {
    return this.byState("fyi");
  }

  private holdRoutine(now: number): boolean {
    return this.policy?.holdRoutine(now) ?? false;
  }

  private ensureWindow(now: number): void {
    if (this.batchDueAt === null) this.batchDueAt = now + CALM_BATCH_MS;
    this.scheduleWake(Math.max(0, this.batchDueAt - now));
  }

  private tryEarly(tracked: Tracked): void {
    if (tracked.state !== "queued" || tracked.card.lane !== "batch") return;
    const early = tracked.card.onCriticalPath || tracked.card.subscribers.length >= 2;
    if (!early) return;
    const now = this.clock.now();
    if (this.holdRoutine(now)) {
      this.quietHold = "focus";
      this.emit();
      return;
    }
    this.surface([tracked], "early_flush", now);
  }

  private releaseWindow(): void {
    const now = this.clock.now();
    const queued = this.sort(this.queuedBatch());
    if (queued.length === 0) {
      this.disarm();
      return;
    }
    if (this.holdRoutine(now)) {
      this.quietHold = "focus";
      this.armPolicyWake(now);
      this.emit();
      return;
    }
    if (this.policy?.blockRoutineWindow(now)) {
      this.quietHold = "budget";
      this.coalescedOverBudget = true;
      this.armPolicyWake(now);
      this.emit();
      return;
    }
    this.policy?.recordRoutineWindow(now);
    this.quietHold = null;
    this.coalescedOverBudget = false;
    this.surface(queued, "window", now);
  }

  private surface(cards: readonly Tracked[], reason: ReleaseReason, now: number): void {
    const fresh = cards.filter((card) => card.state === "queued");
    if (fresh.length === 0) return;
    const ordered = this.sort(fresh);
    for (const card of ordered) card.state = "surfaced";
    const headline = reason === "window" ? batchAnnouncement(ordered.map((card) => card.card.subject)) : null;
    if (headline !== null) this.headline = headline;
    this.releaseLog.push({
      at: now,
      reason,
      cardIds: ordered.map((card) => card.card.id),
      headline,
      sound: this.policy?.soundEnabled ?? false,
      modal: false,
    });
    if (this.queuedBatch().length === 0) this.disarm();
    this.emit();
  }

  private armPolicyWake(now: number): void {
    const wait = this.policy?.msUntilRoutineAllowed(now);
    if (wait === null || wait === undefined || wait <= 0) return;
    this.scheduleWake(wait);
  }

  private scheduleWake(delay: number): void {
    if (this.wakeTimer !== null) this.clock.clearTimeout(this.wakeTimer);
    this.wakeTimer = this.clock.setTimeout(() => {
      this.wakeTimer = null;
      this.refresh();
    }, delay);
  }

  private disarm(): void {
    if (this.wakeTimer !== null) {
      this.clock.clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
    this.batchDueAt = null;
  }

  private queuedBatch(): Tracked[] {
    return [...this.tracked.values()].filter(
      (card) => card.state === "queued" && card.card.lane === "batch",
    );
  }

  private byState(state: Tracked["state"]): string[] {
    return [...this.tracked.values()].filter((card) => card.state === state).map((card) => card.card.id);
  }

  private sort(cards: readonly Tracked[]): Tracked[] {
    return [...cards].sort((left, right) => {
      if (left.card.onCriticalPath !== right.card.onCriticalPath) {
        return left.card.onCriticalPath ? -1 : 1;
      }
      if (left.card.subscribers.length !== right.card.subscribers.length) {
        return right.card.subscribers.length - left.card.subscribers.length;
      }
      if (left.card.createdAt !== right.card.createdAt) return left.card.createdAt - right.card.createdAt;
      return 0;
    });
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
