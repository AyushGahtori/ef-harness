import { ZodError } from "zod";
import {
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_OP_ID_REUSED,
  JSON_RPC_PROJECT_NOT_FOUND,
  JSON_RPC_SNAPSHOT_ITEM_TOO_LARGE,
  PROTOCOL_VERSION,
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
import { snapshotParamsSchema, subscribeParamsSchema } from "./schemas.js";

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
    let params: Record<string, unknown>;
    try {
      params = asRecord(spec.schema.parse(incoming.params));
    } catch (error) {
      if (error instanceof ZodError) return zodFailure(incoming.id, error);
      return failure(incoming.id, JSON_RPC_INTERNAL_ERROR, "Invalid params");
    }
    try {
      if (incoming.method === "events.subscribe") {
        const parsed = subscribeParamsSchema.parse(params);
        const subscribeParams: SubscribeParams =
          parsed.stream_epoch === undefined
            ? {
                project: parsed.project,
                topics: parsed.topics,
                since_seq: parsed.since_seq,
              }
            : {
                project: parsed.project,
                topics: parsed.topics,
                since_seq: parsed.since_seq,
                stream_epoch: parsed.stream_epoch,
              };
        const result = await this.subscriptions.subscribe(connection, subscribeParams);
        return success(incoming.id, result);
      }
      if (incoming.method === "snapshot.get") {
        const parsed = snapshotParamsSchema.parse(params);
        const snapshotParams: SnapshotGetParams =
          parsed.cursor === undefined
            ? { project: parsed.project, views: parsed.views }
            : { project: parsed.project, views: parsed.views, cursor: parsed.cursor };
        const result = await this.snapshots.get(snapshotParams);
        return success(incoming.id, result);
      }
      if (spec.mutating) {
        const opId = readOpId(params);
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

  private async invoke(
    connection: ProtocolConnection,
    method: string,
    params: Record<string, unknown>,
    opId: string | null,
  ): Promise<unknown> {
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

function readOpId(params: Record<string, unknown>): string | null {
  const opId = params.op_id;
  if (typeof opId !== "string") return null;
  const trimmed = opId.trim();
  return trimmed.length > 0 ? trimmed : null;
}
