import { JsonRpcRequestSchema, type JsonRpcRequest } from "@ef-harness/shared-contracts";
import { ZodError } from "zod";
import {
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_OP_ID_REUSED,
  JSON_RPC_PROJECT_NOT_FOUND,
  JSON_RPC_SNAPSHOT_ITEM_TOO_LARGE,
  PROTOCOL_VERSION,
  SNAPSHOT_VIEWS,
  SUPPORTED_PROTOCOL_VERSIONS,
  type SnapshotViewName,
} from "./constants.js";
import { EventSubscriptionServer, type SubscribeParams } from "./event-subscription-server.js";
import {
  ProjectNotFoundError,
  SnapshotItemTooLargeError,
  isOpIdReusedError,
  opIdFromReusedError,
} from "./errors.js";
import { failure, parseIncoming, success, zodFailure } from "./jsonrpc.js";
import { getRpcMethod } from "./methods.js";
import type {
  JsonRpcResponse,
  ProtocolConnection,
  WriteOperation,
  WritePriority,
  CoordinatorWriteQueue,
} from "./ports.js";
import { SnapshotAssembler, type SnapshotGetParams } from "./snapshot-assembler.js";
import { canonicalEpochString, prepareRpcRequest } from "./wire.js";

export interface RpcContext {
  readonly connectionId: string;
  readonly method: string;
  readonly opId: string | null;
}

export type RpcHandler = (ctx: RpcContext, params: Record<string, unknown>) => Promise<unknown> | unknown;

export type RpcHandlerMap = Readonly<Partial<Record<string, RpcHandler>>>;

export interface RpcRouterOptions {
  readonly writeQueue: CoordinatorWriteQueue;
  readonly subscriptions: EventSubscriptionServer;
  readonly snapshots: SnapshotAssembler;
  readonly handlers?: RpcHandlerMap;
  readonly protocolVersion?: string;
}

export class RpcRouter {
  readonly protocolVersion: string;
  private readonly writeQueue: CoordinatorWriteQueue;
  private readonly subscriptions: EventSubscriptionServer;
  private readonly snapshots: SnapshotAssembler;
  private readonly handlers: RpcHandlerMap;

  constructor(options: RpcRouterOptions) {
    this.writeQueue = options.writeQueue;
    this.subscriptions = options.subscriptions;
    this.snapshots = options.snapshots;
    this.handlers = options.handlers ?? {};
    this.protocolVersion = options.protocolVersion ?? PROTOCOL_VERSION;
  }

  async handle(connection: ProtocolConnection, payload: unknown): Promise<JsonRpcResponse | null> {
    const incoming = parseIncoming(payload);
    if (!incoming.ok) return incoming.response;
    if (incoming.kind === "notification") return null;
    const spec = getRpcMethod(incoming.method);
    if (!spec) {
      return failure(incoming.id, JSON_RPC_METHOD_NOT_FOUND, `Method not found: ${incoming.method}`);
    }
    let parsed: JsonRpcRequest;
    try {
      parsed = JsonRpcRequestSchema.parse(prepareRpcRequest(incoming.body));
    } catch (error) {
      if (error instanceof ZodError) return zodFailure(incoming.id, error);
      return failure(incoming.id, JSON_RPC_INTERNAL_ERROR, "Invalid params");
    }
    if (parsed.method !== incoming.method) {
      return failure(incoming.id, JSON_RPC_INVALID_PARAMS, "Invalid params");
    }
    try {
      if (parsed.method === "session.hello" && !isSupportedProtocol(parsed.params.protocol)) {
        return failure(incoming.id, JSON_RPC_INVALID_PARAMS, "unsupported protocol");
      }
      if (parsed.method === "events.subscribe") {
        const subscribeParams: SubscribeParams =
          parsed.params.stream_epoch === undefined
            ? {
                project: parsed.params.project,
                topics: parsed.params.topics,
                since_seq: parsed.params.since_seq,
              }
            : {
                project: parsed.params.project,
                topics: parsed.params.topics,
                since_seq: parsed.params.since_seq,
                stream_epoch: canonicalEpochString(parsed.params.stream_epoch),
              };
        const result = await this.subscriptions.subscribe(connection, subscribeParams);
        return success(incoming.id, result);
      }
      if (parsed.method === "snapshot.get") {
        const views = snapshotViews(parsed.params.views);
        if (!views) return failure(incoming.id, JSON_RPC_INVALID_PARAMS, "Invalid params");
        const snapshotParams: SnapshotGetParams =
          parsed.params.cursor === undefined
            ? { project: parsed.params.project, views }
            : { project: parsed.params.project, views, cursor: parsed.params.cursor };
        const result = await this.snapshots.get(snapshotParams);
        return success(incoming.id, result);
      }
      const params = asRecord(parsed.params);
      if (spec.mutating) {
        const opId = readEnvelopeOpId(parsed);
        if (opId === null || spec.priority === null) {
          return failure(incoming.id, JSON_RPC_INTERNAL_ERROR, "op_id is required");
        }
        const operation: WriteOperation = {
          opId,
          kind: incoming.method,
          priority: spec.priority,
          request: params,
          execute: () => this.invoke(connection, incoming.method, params, opId),
        };
        const result = await this.submit(spec.priority, operation);
        return success(incoming.id, result);
      }
      const result = await this.invoke(connection, incoming.method, params, null);
      return success(incoming.id, result);
    } catch (error) {
      return this.fail(incoming.id, error);
    }
  }

  private submit(priority: WritePriority, operation: WriteOperation): Promise<unknown> {
    if (priority === "knowledge_barrier") return this.writeQueue.submitKnowledgeBarrier(operation);
    return this.writeQueue.submitOperation(operation);
  }

  private invoke(
    connection: ProtocolConnection,
    method: string,
    params: Record<string, unknown>,
    opId: string | null,
  ): unknown {
    const handler = this.handlers[method];
    if (handler) {
      return handler({ connectionId: connection.connectionId, method, opId }, params);
    }
    if (method === "session.ping") return { pong: true, protocol: this.protocolVersion };
    if (method === "session.hello") {
      return { accepted: true, protocol: this.protocolVersion };
    }
    return { ok: true, method };
  }

  private fail(id: string | number, error: unknown): JsonRpcResponse {
    if (isOpIdReusedError(error)) {
      const opId = opIdFromReusedError(error);
      return failure(id, JSON_RPC_OP_ID_REUSED, "op_id_reused", opId === null ? {} : { op_id: opId });
    }
    if (error instanceof ProjectNotFoundError) {
      return failure(id, JSON_RPC_PROJECT_NOT_FOUND, "project_not_found", { project: error.projectId });
    }
    if (error instanceof SnapshotItemTooLargeError) {
      return failure(id, JSON_RPC_SNAPSHOT_ITEM_TOO_LARGE, "snapshot_section_item_exceeds_cap", {
        view: error.view,
        itemId: error.itemId,
      });
    }
    const message = error instanceof Error ? error.message : "Internal error";
    return failure(id, JSON_RPC_INTERNAL_ERROR, message);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function readEnvelopeOpId(parsed: JsonRpcRequest): string | null {
  if (!("op_id" in parsed) || typeof parsed.op_id !== "string") return null;
  const trimmed = parsed.op_id.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isSupportedProtocol(protocol: string): boolean {
  for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
    if (version === protocol) return true;
  }
  return false;
}

function snapshotViews(views: readonly string[]): readonly SnapshotViewName[] | null {
  const accepted: SnapshotViewName[] = [];
  for (const view of views) {
    if (!isSnapshotView(view)) return null;
    accepted.push(view);
  }
  return accepted;
}

function isSnapshotView(view: string): view is SnapshotViewName {
  return (SNAPSHOT_VIEWS as readonly string[]).includes(view);
}
