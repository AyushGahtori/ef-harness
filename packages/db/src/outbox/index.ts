export {
  EmptyOutboxConsumersError,
  InvalidOutboxEventError,
  OutboxStartupReplayPendingError,
  OutboxTransactionRequiredError,
  PermanentOutboxDeliveryError,
  TelemetryNotAllowedInOutboxError,
  TransientOutboxDeliveryError,
  isRetryableDeliveryError,
} from "./errors.js";
export {
  DEFAULT_EVENT_CONSUMERS,
  ROUTED_OUTBOX_EVENT_TYPES,
  isTelemetryEventType,
  mandatoryConsumersFor,
  resolveEventConsumers,
} from "./consumers.js";
export type { RoutedOutboxEventType } from "./consumers.js";
export type { OutboxConnection, OutboxStatement, SqlValue } from "./connection.js";
export { canonicalOutboxQueries, parseNamedQueries, readStateSchemaSql, repositoryRoot } from "./queries.js";
export type { CanonicalOutboxQueries } from "./queries.js";
export {
  DEFAULT_DELIVERY_ATTEMPTS,
  DEFAULT_LAG_PENDING_THRESHOLD,
  DEFAULT_OUTBOX_RETENTION_MS,
  DEFAULT_REPLAY_LIMIT,
  DELIVERY_BACKOFF_BASE_MS,
  DELIVERY_BACKOFF_MAX_MS,
  deliveryBackoffMs,
  deliveryKey,
  retainedHistoryRequiresResync,
  streamEpochRequiresResync,
  takeGapFreePrefix,
} from "./replay-rules.js";
export { OutboxRepo } from "./repo.js";
export type { OutboxRepoOptions } from "./repo.js";
export { OutboxDispatcher } from "./dispatcher.js";
export type { OutboxDispatcherOptions } from "./dispatcher.js";
export { PENDING_FOR_CONSUMER_SQL } from "./statements.js";
export type {
  AppendedOutboxEvent,
  OutboxAuditAlert,
  OutboxAuditResult,
  OutboxConsumerHandler,
  OutboxConsumerLag,
  OutboxDeliveryRecord,
  OutboxDispatchResult,
  OutboxEventDraft,
  OutboxLagMetric,
  OutboxPruneResult,
  OutboxReplayBatch,
  OutboxStartupResult,
  StoredOutboxEvent,
} from "./types.js";
