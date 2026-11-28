import { DatabaseSync } from "node:sqlite";
import { SharedQuestionArbiter } from "./arbiter.js";
import { QuestionQueueStore } from "./database.js";
import { QuestionDedupSubscriberStore } from "./dedup.js";
import { OwnerFirstQuestionFilter } from "./filter.js";
import { InterruptionAudit } from "./metrics.js";
import {
  MemoryCriticalPath,
  MemoryOwnerDirectory,
  MemoryRoleMailbox,
  SqliteSettledDecisionPort,
  type CriticalPathPort,
  type OwnerMailboxPort,
  type OwnerResolutionPort,
  type SettledDecisionPort,
} from "./ports.js";
import { StaleReplyReconciler } from "./reconciler.js";
import type { HoldReason, InboxProjection, OutboxEventRecord, WakeRecord } from "./types.js";

export interface QuestionArbiterOpenOptions {
  readonly stateDbPath: string;
  readonly telemetryDbPath: string;
  readonly now?: () => number;
  readonly settled?: SettledDecisionPort;
  readonly owners?: OwnerResolutionPort;
  readonly mailbox?: OwnerMailboxPort;
  readonly criticalPath?: CriticalPathPort;
}

export class QuestionArbiterRuntime {
  readonly store: QuestionQueueStore;
  readonly settled: SettledDecisionPort;
  readonly owners: OwnerResolutionPort;
  readonly mailbox: OwnerMailboxPort;
  readonly criticalPath: CriticalPathPort;
  readonly metrics: InterruptionAudit;
  readonly dedup: QuestionDedupSubscriberStore;
  readonly filter: OwnerFirstQuestionFilter;
  readonly reconciler: StaleReplyReconciler;
  readonly arbiter: SharedQuestionArbiter;
  private readonly state: DatabaseSync;
  private readonly telemetry: DatabaseSync;

  constructor(options: QuestionArbiterOpenOptions) {
    const now = options.now ?? Date.now;
    this.state = new DatabaseSync(options.stateDbPath);
    this.telemetry = new DatabaseSync(options.telemetryDbPath);
    this.store = new QuestionQueueStore(this.state);
    this.settled = options.settled ?? new SqliteSettledDecisionPort(this.store);
    this.owners = options.owners ?? new MemoryOwnerDirectory();
    this.mailbox = options.mailbox ?? new MemoryRoleMailbox();
    this.criticalPath = options.criticalPath ?? new MemoryCriticalPath();
    this.metrics = new InterruptionAudit(this.telemetry, now);
    this.dedup = new QuestionDedupSubscriberStore(this.store, this.criticalPath, now);
    this.filter = new OwnerFirstQuestionFilter(this.settled, this.owners, this.mailbox, this.dedup, this.metrics);
    this.reconciler = new StaleReplyReconciler(this.store, this.dedup, now);
    this.arbiter = new SharedQuestionArbiter(this.filter, this.dedup, this.reconciler, this.store, this.metrics, now);
  }

  placeHold(reason: Omit<HoldReason, "active">): void {
    this.store.transaction(() => this.store.placeHold(reason));
  }

  holds(taskId: string): readonly HoldReason[] {
    return this.store.holdsFor(taskId);
  }

  wakes(questionId: string): readonly WakeRecord[] {
    return this.store.wakesFor(questionId);
  }

  outbox(): readonly OutboxEventRecord[] {
    return this.store.listOutbox();
  }

  projection(questionId: string): InboxProjection | null {
    return this.store.projection(questionId);
  }

  armHoldClearFailure(): void {
    this.store.armHoldClearFailure();
  }

  close(): void {
    this.state.close();
    this.telemetry.close();
  }
}

export function openQuestionArbiter(options: QuestionArbiterOpenOptions): QuestionArbiterRuntime {
  return new QuestionArbiterRuntime(options);
}
