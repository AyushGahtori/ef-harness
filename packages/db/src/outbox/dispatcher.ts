import type { OutboxConnection } from "./connection.js";
import {
  OutboxStartupReplayPendingError,
  PermanentOutboxDeliveryError,
  isRetryableDeliveryError,
} from "./errors.js";
import type { OutboxRepo } from "./repo.js";
import {
  DEFAULT_DELIVERY_ATTEMPTS,
  DELIVERY_BACKOFF_BASE_MS,
  DELIVERY_BACKOFF_MAX_MS,
  deliveryBackoffMs,
} from "./replay-rules.js";
import type {
  OutboxConsumerHandler,
  OutboxDispatchResult,
  OutboxStartupResult,
} from "./types.js";

export interface OutboxDispatcherOptions {
  readonly sleep?: (ms: number) => Promise<void>;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly maxAttempts?: number;
  readonly batchSize?: number;
  readonly maintenanceIntervalMs?: number;
}

const DEFAULT_MAINTENANCE_MS = 60_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * At-least-once delivery. Each consumer is polled through `outbox_pending`
 * in `seq ASC`. A failing consumer does not block other consumers. Within one
 * consumer, a later seq is not delivered ahead of an earlier undelivered seq.
 */
export class OutboxDispatcher {
  private readonly handlers = new Map<string, OutboxConsumerHandler>();
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxAttempts: number;
  private readonly batchSize: number;
  private readonly maintenanceIntervalMs: number;
  private tail: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private startupReplayFinished = false;

  constructor(
    private readonly repo: OutboxRepo,
    private readonly conn: OutboxConnection,
    options: OutboxDispatcherOptions = {},
  ) {
    this.sleep = options.sleep ?? defaultSleep;
    this.baseDelayMs = options.baseDelayMs ?? DELIVERY_BACKOFF_BASE_MS;
    this.maxDelayMs = options.maxDelayMs ?? DELIVERY_BACKOFF_MAX_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_DELIVERY_ATTEMPTS;
    this.batchSize = options.batchSize ?? 500;
    this.maintenanceIntervalMs = options.maintenanceIntervalMs ?? DEFAULT_MAINTENANCE_MS;
  }

  registerConsumer(consumer: string, handler: OutboxConsumerHandler): void {
    this.handlers.set(consumer, handler);
  }

  assertNewTurnsAllowed(): void {
    if (!this.startupReplayFinished) throw new OutboxStartupReplayPendingError();
  }

  async start(): Promise<OutboxStartupResult> {
    this.stopped = false;
    const startup = await this.replayPendingOnStartup();
    this.startPeriodicMaintenance();
    return startup;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  startPeriodicMaintenance(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.exclusive(async () => {
        this.runMaintenanceUnlocked();
      });
    }, this.maintenanceIntervalMs);
    const timer = this.timer as { unref?: () => void };
    timer.unref?.();
  }

  runMaintenance(): { readonly auditIds: readonly string[]; readonly deleted: number } {
    return this.runMaintenanceUnlocked();
  }

  async replayPendingOnStartup(): Promise<OutboxStartupResult> {
    return this.exclusive(async () => {
      const audit = this.repo.auditOutboxDeliveries(this.conn);
      const dispatched = await this.dispatchUnlocked();
      this.startupReplayFinished = true;
      return { audit, ...dispatched };
    });
  }

  async dispatchPending(consumer?: string): Promise<OutboxDispatchResult> {
    return this.exclusive(async () => this.dispatchUnlocked(consumer));
  }

  private runMaintenanceUnlocked(): { readonly auditIds: readonly string[]; readonly deleted: number } {
    const audit = this.repo.auditOutboxDeliveries(this.conn);
    const pruned = this.repo.pruneAcknowledgedOutbox(this.conn);
    return { auditIds: audit.eventIds, deleted: pruned.deleted };
  }

  private async dispatchUnlocked(onlyConsumer?: string): Promise<OutboxDispatchResult> {
    const blockedConsumers: string[] = [];
    let delivered = 0;
    for (const consumer of this.orderedConsumers(onlyConsumer)) {
      if (this.stopped) break;
      const handler = this.handlers.get(consumer);
      if (!handler) {
        blockedConsumers.push(consumer);
        continue;
      }
      const outcome = await this.drainConsumer(consumer, handler);
      delivered += outcome.delivered;
      if (outcome.blocked) blockedConsumers.push(consumer);
    }
    return { delivered, blockedConsumers };
  }

  private orderedConsumers(onlyConsumer?: string): string[] {
    const pending = onlyConsumer ? [onlyConsumer] : this.repo.listUnackedConsumers(this.conn);
    return pending
      .map((consumer) => ({
        consumer,
        oldest: this.repo.fetchPendingForConsumer(this.conn, consumer, 1)[0]?.seq ?? Number.MAX_SAFE_INTEGER,
      }))
      .sort((left, right) => left.oldest - right.oldest || left.consumer.localeCompare(right.consumer))
      .map((item) => item.consumer);
  }

  private async drainConsumer(
    consumer: string,
    handler: OutboxConsumerHandler,
  ): Promise<{ delivered: number; blocked: boolean }> {
    let delivered = 0;
    for (;;) {
      if (this.stopped) return { delivered, blocked: false };
      const batch = this.repo.fetchPendingForConsumer(this.conn, consumer, this.batchSize);
      if (batch.length === 0) return { delivered, blocked: false };
      for (const record of batch) {
        const ok = await this.attemptDelivery(handler, record.event.id, consumer, record);
        if (!ok) return { delivered, blocked: true };
        delivered += 1;
      }
      if (batch.length < this.batchSize) return { delivered, blocked: false };
    }
  }

  private async attemptDelivery(
    handler: OutboxConsumerHandler,
    eventId: string,
    consumer: string,
    record: { readonly event: Parameters<OutboxConsumerHandler>[0]; readonly seq: number; readonly deliveryKey: string },
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      if (this.stopped) return false;
      const openBefore = this.conn.isTransaction;
      try {
        await handler(record.event, record.seq, record.deliveryKey);
        if (!openBefore && this.conn.isTransaction) {
          this.conn.exec("ROLLBACK");
          throw new PermanentOutboxDeliveryError("consumer handler left a transaction open");
        }
        this.acknowledgeIfNeeded(eventId, consumer);
        return true;
      } catch (error) {
        if (!openBefore && this.conn.isTransaction) this.conn.exec("ROLLBACK");
        const retry = isRetryableDeliveryError(error) && attempt < this.maxAttempts && !this.stopped;
        if (!retry) return false;
        await this.sleep(deliveryBackoffMs(attempt, this.baseDelayMs, this.maxDelayMs));
      }
    }
    return false;
  }

  private acknowledgeIfNeeded(eventId: string, consumer: string): void {
    if (this.repo.isDeliveryAcknowledged(this.conn, eventId, consumer)) return;
    const joined = this.conn.isTransaction;
    if (!joined) this.conn.exec("BEGIN IMMEDIATE");
    try {
      this.repo.acknowledgeDelivery(this.conn, eventId, consumer);
      if (!joined) this.conn.exec("COMMIT");
    } catch (error) {
      if (!joined && this.conn.isTransaction) this.conn.exec("ROLLBACK");
      throw error;
    }
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
