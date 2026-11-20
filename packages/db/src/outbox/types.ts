export interface OutboxEventDraft {
  readonly id: string;
  readonly type: string;
  readonly subject?: string | null;
  readonly rev?: number | null;
  readonly revision?: number | null;
  readonly payload?: unknown;
  readonly createdAt?: number;
  readonly created?: string | number;
}

export interface StoredOutboxEvent {
  readonly seq: number;
  readonly id: string;
  readonly type: string;
  readonly subject: string | null;
  readonly rev: number | null;
  readonly payload: unknown;
  readonly createdAt: number;
}

export interface AppendedOutboxEvent extends StoredOutboxEvent {
  readonly consumers: readonly string[];
}

export interface OutboxDeliveryRecord {
  readonly event: StoredOutboxEvent;
  readonly seq: number;
  readonly consumer: string;
  readonly deliveryKey: string;
}

export interface OutboxReplayBatch {
  readonly events: readonly StoredOutboxEvent[];
  readonly resyncRequired: boolean;
  readonly minRetainedSeq: number | null;
  readonly highWaterSeq: number;
  readonly streamEpoch: string | null;
  readonly sinceSeq: number;
  readonly fromSeq: number | null;
  readonly toSeq: number | null;
  readonly hasMore: boolean;
}

export interface OutboxAuditAlert {
  readonly severity: "high";
  readonly code: "outbox_without_deliveries";
  readonly eventIds: readonly string[];
  readonly message: string;
}

export interface OutboxAuditResult {
  readonly eventIds: readonly string[];
  readonly alerted: boolean;
}

export interface OutboxConsumerLag {
  readonly consumer: string;
  readonly pending: number;
  readonly oldestSeq: number | null;
  readonly oldestCreatedAt: number | null;
  readonly ageMs: number | null;
  readonly lagging: boolean;
}

export interface OutboxPruneResult {
  readonly deleted: number;
  readonly cutoff: number;
  readonly lags: readonly OutboxConsumerLag[];
}

export interface OutboxLagMetric {
  readonly name: "outbox.consumer_lag";
  readonly consumer: string;
  readonly pending: number;
  readonly oldestSeq: number | null;
  readonly ageMs: number | null;
}

export type OutboxConsumerHandler = (
  event: StoredOutboxEvent,
  seq: number,
  deliveryKey: string,
) => void | Promise<void>;

export interface OutboxStartupResult {
  readonly audit: OutboxAuditResult;
  readonly delivered: number;
  readonly blockedConsumers: readonly string[];
}

export interface OutboxDispatchResult {
  readonly delivered: number;
  readonly blockedConsumers: readonly string[];
}
