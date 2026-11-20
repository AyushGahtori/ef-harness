import type { OutboxConnection, OutboxStatement, SqlValue } from "./connection.js";
import {
  isTelemetryEventType,
  mandatoryConsumersFor,
  resolveEventConsumers,
} from "./consumers.js";
import {
  EmptyOutboxConsumersError,
  InvalidOutboxEventError,
  OutboxTransactionRequiredError,
  TelemetryNotAllowedInOutboxError,
} from "./errors.js";
import { canonicalOutboxQueries } from "./queries.js";
import {
  DEFAULT_LAG_PENDING_THRESHOLD,
  DEFAULT_OUTBOX_RETENTION_MS,
  DEFAULT_REPLAY_LIMIT,
  deliveryKey,
  retainedHistoryRequiresResync,
  takeGapFreePrefix,
} from "./replay-rules.js";
import { changeCount, readOptionalInt, readRequiredInt, readRequiredText, readStoredEvent, encodePayload } from "./rows.js";
import {
  ACK_DELIVERY_SQL,
  CONSUMER_LAG_SQL,
  HIGH_WATER_SEQ_SQL,
  INSERT_OUTBOX_SQL,
  MIN_RETAINED_SEQ_SQL,
  PENDING_FOR_CONSUMER_SQL,
  SELECT_OUTBOX_BY_ID_SQL,
  STREAM_EPOCH_SQL,
  UNACKED_CONSUMERS_SQL,
  replaySql,
} from "./statements.js";
import type {
  AppendedOutboxEvent,
  OutboxAuditAlert,
  OutboxAuditResult,
  OutboxConsumerLag,
  OutboxDeliveryRecord,
  OutboxEventDraft,
  OutboxLagMetric,
  OutboxPruneResult,
  OutboxReplayBatch,
  StoredOutboxEvent,
} from "./types.js";

export interface OutboxRepoOptions {
  readonly now?: () => number;
  readonly retentionMs?: number;
  readonly lagPendingThreshold?: number;
  readonly replayLimit?: number;
  readonly onAlert?: (alert: OutboxAuditAlert) => void;
  readonly onLag?: (metric: OutboxLagMetric) => void;
}

function assertInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new InvalidOutboxEventError(`${field} must be a safe integer`);
  }
  return value;
}

function resolveCreatedAt(event: OutboxEventDraft, now: number): number {
  if (event.createdAt !== undefined) return assertInteger(event.createdAt, "createdAt");
  if (typeof event.created === "number") return assertInteger(event.created, "created");
  if (typeof event.created === "string") {
    const parsed = Date.parse(event.created);
    if (!Number.isFinite(parsed)) {
      throw new InvalidOutboxEventError("created is not a valid UTC timestamp");
    }
    return parsed;
  }
  return now;
}

function resolveRevision(event: OutboxEventDraft): number | null {
  const hasRev = event.rev !== undefined && event.rev !== null;
  const hasRevision = event.revision !== undefined && event.revision !== null;
  if (hasRev && hasRevision && event.rev !== event.revision) {
    throw new InvalidOutboxEventError("rev and revision disagree");
  }
  const value = hasRev ? event.rev : hasRevision ? event.revision : null;
  if (value === null || value === undefined) return null;
  return assertInteger(value, "rev");
}

function run(statement: OutboxStatement, params: Readonly<Record<string, SqlValue>>) {
  return statement.run(params);
}

export class OutboxRepo {
  private readonly now: () => number;
  private readonly retentionMs: number;
  private readonly lagPendingThreshold: number;
  private readonly replayLimit: number;
  private readonly onAlert: ((alert: OutboxAuditAlert) => void) | undefined;
  private readonly onLag: ((metric: OutboxLagMetric) => void) | undefined;
  private readonly alerts: OutboxAuditAlert[] = [];
  private readonly lagMetrics: OutboxLagMetric[] = [];

  constructor(options: OutboxRepoOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.retentionMs = options.retentionMs ?? DEFAULT_OUTBOX_RETENTION_MS;
    this.lagPendingThreshold = options.lagPendingThreshold ?? DEFAULT_LAG_PENDING_THRESHOLD;
    this.replayLimit = options.replayLimit ?? DEFAULT_REPLAY_LIMIT;
    this.onAlert = options.onAlert;
    this.onLag = options.onLag;
    canonicalOutboxQueries();
  }

  readAlerts(): readonly OutboxAuditAlert[] {
    return this.alerts;
  }

  readLagMetrics(): readonly OutboxLagMetric[] {
    return this.lagMetrics;
  }

  /**
   * Insert one domain event and a delivery row per consumer inside the caller's
   * open `BEGIN IMMEDIATE` transaction. `seq` is assigned by SQLite AUTOINCREMENT.
   */
  appendEventInTx(
    conn: OutboxConnection,
    event: OutboxEventDraft,
    consumers: readonly string[],
  ): AppendedOutboxEvent {
    if (typeof event.id !== "string" || event.id.trim().length === 0) {
      throw new InvalidOutboxEventError("outbox event id is required");
    }
    if (typeof event.type !== "string" || event.type.trim().length === 0) {
      throw new InvalidOutboxEventError("outbox event type is required");
    }
    const id = event.id.trim();
    const type = event.type.trim();
    if (isTelemetryEventType(type)) {
      throw new TelemetryNotAllowedInOutboxError(type);
    }
    if (!Array.isArray(consumers)) {
      throw new InvalidOutboxEventError("consumers must be an array");
    }
    if (consumers.length === 0) {
      throw new EmptyOutboxConsumersError();
    }
    if (conn.isTransaction !== true) {
      throw new OutboxTransactionRequiredError();
    }

    const createdAt = resolveCreatedAt(event, this.now());
    const rev = resolveRevision(event);
    const subject = event.subject === undefined ? null : event.subject;
    if (subject !== null && typeof subject !== "string") {
      throw new InvalidOutboxEventError("subject must be a string or null");
    }
    const payload = encodePayload(event.payload);
    const resolved = resolveEventConsumers(type, consumers);
    if (resolved.length === 0) {
      throw new EmptyOutboxConsumersError();
    }

    run(conn.prepare(INSERT_OUTBOX_SQL), {
      id,
      type,
      subject,
      rev,
      payload,
      created_at: createdAt,
    });
    const queries = canonicalOutboxQueries();
    const register = conn.prepare(queries.register_delivery);
    for (const consumer of resolved) {
      run(register, { event_id: id, consumer });
    }
    const stored = this.readById(conn, id);
    return { ...stored, consumers: resolved };
  }

  fetchPendingForConsumer(
    conn: OutboxConnection,
    consumer: string,
    limit: number = this.replayLimit,
  ): OutboxDeliveryRecord[] {
    const bounded = assertInteger(limit, "limit");
    if (bounded < 1) throw new InvalidOutboxEventError("limit must be at least 1");
    const rows = conn.prepare(PENDING_FOR_CONSUMER_SQL).all({ consumer, limit: bounded });
    return rows.map((row) => {
      const stored = readStoredEvent(row);
      return {
        event: stored,
        seq: stored.seq,
        consumer,
        deliveryKey: deliveryKey(stored.id, consumer),
      };
    });
  }

  listUnackedConsumers(conn: OutboxConnection): string[] {
    return conn
      .prepare(UNACKED_CONSUMERS_SQL)
      .all()
      .map((row) => readRequiredText(row.consumer, "consumer"));
  }

  acknowledgeDelivery(
    conn: OutboxConnection,
    eventId: string,
    consumer: string,
    deliveredAt?: number,
  ): boolean {
    const stamp = deliveredAt === undefined ? this.now() : assertInteger(deliveredAt, "deliveredAt");
    const result = run(conn.prepare(ACK_DELIVERY_SQL), {
      event_id: eventId,
      consumer,
      delivered_at: stamp,
    });
    return changeCount(result.changes) > 0;
  }

  isDeliveryAcknowledged(conn: OutboxConnection, eventId: string, consumer: string): boolean {
    const row = conn.prepare(
      `SELECT delivered_at AS delivered_at FROM outbox_deliveries WHERE event_id = :event_id AND consumer = :consumer`,
    ).get({ event_id: eventId, consumer });
    if (!row) return false;
    return row.delivered_at !== null && row.delivered_at !== undefined;
  }

  replayEventsSince(
    conn: OutboxConnection,
    sinceSeq: number,
    topics?: readonly string[],
    limit?: number,
  ): OutboxReplayBatch {
    const since = assertInteger(sinceSeq, "sinceSeq");
    if (since < 0) throw new InvalidOutboxEventError("sinceSeq must be >= 0");
    const pageLimit = limit === undefined ? this.replayLimit : assertInteger(limit, "limit");
    if (pageLimit < 1 || pageLimit > 100_000) {
      throw new InvalidOutboxEventError("limit must be between 1 and 100000");
    }
    const topicList = topics === undefined ? undefined : [...topics];
    if (topicList?.some((topic) => typeof topic !== "string" || topic.length === 0)) {
      throw new InvalidOutboxEventError("topics must be non-empty event type strings");
    }

    const minRetainedSeq = this.getMinRetainedSeq(conn);
    const highWaterSeq = this.getHighWaterSeq(conn);
    const streamEpoch = this.getStreamEpoch(conn);
    const resyncRequired = retainedHistoryRequiresResync({
      sinceSeq: since,
      minRetainedSeq,
      highWaterSeq,
    });
    if (resyncRequired || topicList?.length === 0) {
      return {
        events: [],
        resyncRequired,
        minRetainedSeq,
        highWaterSeq,
        streamEpoch,
        sinceSeq: since,
        fromSeq: null,
        toSeq: null,
        hasMore: false,
      };
    }

    const params: Record<string, SqlValue> = { since_seq: since, limit: pageLimit + 1 };
    for (let index = 0; index < (topicList?.length ?? 0); index += 1) {
      const topic = topicList?.[index];
      if (topic !== undefined) params[`topic_${index}`] = topic;
    }
    const rows = conn.prepare(replaySql(topicList?.length ?? 0)).all(params);
    const fetched = rows.map((row) => readStoredEvent(row));
    for (let index = 1; index < fetched.length; index += 1) {
      const previous = fetched[index - 1];
      const current = fetched[index];
      if (!previous || !current || current.seq <= previous.seq) {
        throw new InvalidOutboxEventError("outbox replay returned seq out of order");
      }
    }

    if (topicList && topicList.length > 0) {
      const hasMore = fetched.length > pageLimit;
      const events = hasMore ? fetched.slice(0, pageLimit) : fetched;
      return this.batch(since, events, false, hasMore, minRetainedSeq, highWaterSeq, streamEpoch);
    }

    const taken = takeGapFreePrefix(fetched, since);
    if (taken.page.length === 0 && fetched.length > 0) {
      return this.batch(since, [], true, false, minRetainedSeq, highWaterSeq, streamEpoch);
    }
    const hasMore = taken.page.length > pageLimit || taken.hole;
    const events = taken.page.slice(0, pageLimit);
    return this.batch(since, events, false, hasMore, minRetainedSeq, highWaterSeq, streamEpoch);
  }

  getMinRetainedSeq(conn: OutboxConnection): number | null {
    const row = conn.prepare(MIN_RETAINED_SEQ_SQL).get();
    return readOptionalInt(row?.seq, "seq");
  }

  getHighWaterSeq(conn: OutboxConnection): number {
    const row = conn.prepare(HIGH_WATER_SEQ_SQL).get();
    if (!row) return 0;
    return readOptionalInt(row.seq, "seq") ?? 0;
  }

  getStreamEpoch(conn: OutboxConnection): string | null {
    const row = conn.prepare(STREAM_EPOCH_SQL).get();
    if (!row || row.value === null || row.value === undefined) return null;
    return readRequiredText(row.value, "stream_epoch");
  }

  /**
   * Runs `prune_outbox` from schema/queries.sql. Default cutoff is now minus 7 days.
   * Pass a numeric cutoff to match schema-test.js (`created_at < :cutoff`).
   */
  pruneAcknowledgedOutbox(conn: OutboxConnection, cutoff?: number): OutboxPruneResult {
    const resolvedCutoff =
      cutoff === undefined ? this.now() - this.retentionMs : assertInteger(cutoff, "cutoff");
    const result = run(conn.prepare(canonicalOutboxQueries().prune_outbox), {
      cutoff: resolvedCutoff,
    });
    const lags = this.collectLag(conn);
    return { deleted: changeCount(result.changes), cutoff: resolvedCutoff, lags };
  }

  /**
   * Runs `outbox_without_deliveries` from schema/queries.sql.
   * Matching rows are a kernel bug. They are logged and never deleted here.
   */
  auditOutboxDeliveries(conn: OutboxConnection): OutboxAuditResult {
    const rows = conn.prepare(canonicalOutboxQueries().outbox_without_deliveries).all();
    const eventIds = rows.map((row) => readRequiredText(row.id, "id"));
    if (eventIds.length > 0) {
      const alert: OutboxAuditAlert = {
        severity: "high",
        code: "outbox_without_deliveries",
        eventIds,
        message: `outbox events without delivery rows: ${eventIds.join(", ")}`,
      };
      this.alerts.push(alert);
      this.onAlert?.(alert);
    }
    return { eventIds, alerted: eventIds.length > 0 };
  }

  /** Exposed so callers and tests can prove every routed type names both sinks. */
  static mandatoryConsumers(type: string): readonly string[] {
    return mandatoryConsumersFor(type);
  }

  private collectLag(conn: OutboxConnection): OutboxConsumerLag[] {
    const now = this.now();
    const rows = conn.prepare(CONSUMER_LAG_SQL).all();
    return rows.map((row) => {
      const consumer = readRequiredText(row.consumer, "consumer");
      const pending = readRequiredInt(row.pending, "pending");
      const oldestSeq = readOptionalInt(row.oldest_seq, "oldest_seq");
      const oldestCreatedAt = readOptionalInt(row.oldest_created_at, "oldest_created_at");
      const ageMs = oldestCreatedAt === null ? null : now - oldestCreatedAt;
      const lagging =
        pending >= this.lagPendingThreshold ||
        (ageMs !== null && ageMs >= this.retentionMs);
      const lag: OutboxConsumerLag = {
        consumer,
        pending,
        oldestSeq,
        oldestCreatedAt,
        ageMs,
        lagging,
      };
      if (lagging) {
        const metric: OutboxLagMetric = {
          name: "outbox.consumer_lag",
          consumer,
          pending,
          oldestSeq,
          ageMs,
        };
        this.lagMetrics.push(metric);
        this.onLag?.(metric);
      }
      return lag;
    });
  }

  private readById(conn: OutboxConnection, id: string): StoredOutboxEvent {
    const row = conn.prepare(SELECT_OUTBOX_BY_ID_SQL).get({ id });
    if (!row) throw new InvalidOutboxEventError(`outbox event ${id} was not stored`);
    return readStoredEvent(row);
  }

  private batch(
    sinceSeq: number,
    events: readonly StoredOutboxEvent[],
    resyncRequired: boolean,
    hasMore: boolean,
    minRetainedSeq: number | null,
    highWaterSeq: number,
    streamEpoch: string | null,
  ): OutboxReplayBatch {
    const first = events[0];
    const last = events.length > 0 ? events[events.length - 1] : undefined;
    return {
      events,
      resyncRequired,
      minRetainedSeq,
      highWaterSeq,
      streamEpoch,
      sinceSeq,
      fromSeq: first?.seq ?? null,
      toSeq: last?.seq ?? null,
      hasMore,
    };
  }
}
