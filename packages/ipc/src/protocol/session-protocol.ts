import { PROTOCOL_VERSION } from "./constants.js";
import { EventSubscriptionServer, type EventSubscriptionServerOptions } from "./event-subscription-server.js";
import { SubscriptionMetricsRegistry } from "./metrics.js";
import type { CoordinatorWriteQueue } from "./ports.js";
import { RpcRouter, type RpcHandlerMap } from "./rpc-router.js";
import { SnapshotAssembler, type SnapshotAssemblerOptions } from "./snapshot-assembler.js";

export interface SessionProtocol {
  readonly router: RpcRouter;
  readonly subscriptions: EventSubscriptionServer;
  readonly snapshots: SnapshotAssembler;
  readonly metrics: SubscriptionMetricsRegistry;
  readonly protocolVersion: string;
}

export interface SessionProtocolOptions {
  readonly writeQueue: CoordinatorWriteQueue;
  readonly outboxes: EventSubscriptionServerOptions["outboxes"];
  readonly snapshots: SnapshotAssemblerOptions["source"];
  readonly handlers?: RpcHandlerMap;
  readonly now?: () => number;
  readonly replayPageSize?: number;
  readonly maxQueuedTelemetry?: number;
  readonly seqBuffer?: number;
  readonly maxFrameBytes?: number;
  readonly protocolVersion?: string;
}

export function createSessionProtocol(options: SessionProtocolOptions): SessionProtocol {
  const metrics = new SubscriptionMetricsRegistry();
  const subscriptions = new EventSubscriptionServer({
    outboxes: options.outboxes,
    metrics,
    ...(options.now ? { now: options.now } : {}),
    ...(options.replayPageSize !== undefined ? { replayPageSize: options.replayPageSize } : {}),
    ...(options.maxQueuedTelemetry !== undefined ? { maxQueuedTelemetry: options.maxQueuedTelemetry } : {}),
  });
  const snapshots = new SnapshotAssembler({
    source: options.snapshots,
    ...(options.seqBuffer !== undefined ? { seqBuffer: options.seqBuffer } : {}),
    ...(options.maxFrameBytes !== undefined ? { maxFrameBytes: options.maxFrameBytes } : {}),
  });
  const router = new RpcRouter({
    writeQueue: options.writeQueue,
    subscriptions,
    snapshots,
    ...(options.handlers ? { handlers: options.handlers } : {}),
    protocolVersion: options.protocolVersion ?? PROTOCOL_VERSION,
  });
  return {
    router,
    subscriptions,
    snapshots,
    metrics,
    protocolVersion: router.protocolVersion,
  };
}
