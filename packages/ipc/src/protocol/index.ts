export {
  CHANNEL0_MAX_FRAME_BYTES,
  DEFAULT_MAX_QUEUED_TELEMETRY,
  DEFAULT_REPLAY_PAGE_SIZE,
  DEFAULT_SNAPSHOT_SEQ_BUFFER,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_OP_ID_REUSED,
  JSON_RPC_PARSE_ERROR,
  JSON_RPC_PROJECT_NOT_FOUND,
  JSON_RPC_SNAPSHOT_ITEM_TOO_LARGE,
  JSON_RPC_UNAUTHORIZED,
  MAX_EVENT_BATCH_EVENTS,
  MAX_SNAPSHOT_FRAME_BYTES,
  MAX_SNAPSHOT_SECTION_BYTES,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  SNAPSHOT_VIEWS,
} from "./constants.js";
export type { SnapshotViewName } from "./constants.js";

export { OpIdReusedError, ProjectNotFoundError, SnapshotItemTooLargeError } from "./errors.js";

export { utf8Size } from "./byte-size.js";

export type {
  BoardLaneCount,
  BoardSummary,
  ClientSubscriptionMetrics,
  CoordinatorWriteQueue,
  DomainEvent,
  DriftReport,
  FeatureProgress,
  JsonRpcFailure,
  JsonRpcNotification,
  JsonRpcResponse,
  JsonRpcSuccess,
  KeysetReader,
  OutboxRepo,
  PinnedSnapshot,
  ProjectOutboxDirectory,
  ProtocolConnection,
  QueueLatencyMetrics,
  ReadModelRepo,
  ReadModelSnapshotBindings,
  SnapshotReadBatch,
  SnapshotRow,
  SnapshotSource,
  TelemetryNote,
  TraceabilityGaps,
  WriteOperation,
  WritePriority,
} from "./ports.js";

export { RPC_METHOD_NAMES, RPC_METHODS, RPC_NAMESPACES, getRpcMethod, listRpcMethodNames } from "./methods.js";
export type { RpcMethodName, RpcMethodSpec } from "./methods.js";

export { decodeDaemonMessage, failure, notify, parseIncoming, success } from "./jsonrpc.js";
export type { DecodedDaemonMessage } from "./jsonrpc.js";

export { SubscriptionMetricsRegistry } from "./metrics.js";
export { ClientOutbound } from "./outbound.js";
export { buildEnvelope, dedupeSort, matchesTopic, splitEnvelopes, topicOf } from "./envelopes.js";
export type { EventsBatch } from "./envelopes.js";

export { EventSubscriptionServer } from "./event-subscription-server.js";
export type {
  ResyncRequiredResult,
  SubscribeAbortedResult,
  SubscribeLiveResult,
  SubscribeParams,
  SubscribeResult,
} from "./event-subscription-server.js";

export { SnapshotAssembler, snapshotSourceFromReadModels } from "./snapshot-assembler.js";
export type { ResyncRequired, SnapshotGetParams, SnapshotGetResult, SnapshotPage } from "./snapshot-assembler.js";

export { reduceBatch } from "./reduce-batch.js";
export type { ReduceAction, SyncCursor } from "./reduce-batch.js";

export { ClientStateSyncer, mergeSections } from "./client-state-syncer.js";
export type { ClientStateSyncerOptions, ClientTransport, IngestAction, IngestResult } from "./client-state-syncer.js";

export { ProjectSyncRegistry, createProjectSyncer } from "./project-sync-registry.js";

export { RpcRouter } from "./rpc-router.js";
export type { RpcContext, RpcHandler, RpcHandlerMap, RpcRouterOptions } from "./rpc-router.js";

export { createSessionProtocol } from "./session-protocol.js";
export type { SessionProtocol, SessionProtocolOptions } from "./session-protocol.js";

export {
  bindIpcProject,
  createDbOutboxDirectory,
  createDbOutboxPort,
  createDbReadModelPort,
  createDbSnapshotSource,
  createDbWriteQueuePort,
} from "./db-bind.js";
export type { BindIpcProjectOptions, DbWriteQueuePortOptions, IpcProjectBinding } from "./db-bind.js";
