import { z } from "zod/v4";
import {
  ARRAY_MAX_ITEMS,
  BINARY_CHUNK_BYTES,
  createJsonValueSchema,
  idSchema,
  JSON_IPC_MAX_BYTES,
  nonNegativeIntSchema,
  noteSchema,
  pathSchema,
  SNAPSHOT_SECTION_MAX_BYTES,
  withinJsonByteLimit,
} from "./bounds.js";
import { EventV1Schema } from "./messages.js";

export const JSON_RPC_CHANNEL = 0 as const;
export const BINARY_STREAM_CHANNEL = 1 as const;

const jsonrpc = z.literal("2.0");

export const JsonRpcIdSchema = z.union([z.string().min(1).max(256), nonNegativeIntSchema]);

export const OpIdSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value.trim().length > 0, { message: "op_id must be non-empty" });

const protocolSchema = z.string().regex(/^1\.\d+$/, {
  message: 'protocol must be a 1.x minor version such as "1.0"',
});

export const READ_ONLY_RPC_METHODS = [
  "session.hello",
  "session.ping",
  "project.list",
  "node.get",
  "node.search",
  "graph.view",
  "impact.preview",
  "plan.preview",
  "inbox.list",
  "artifact.open",
  "diff.get",
  "preview.url",
  "settings.get",
  "events.subscribe",
  "snapshot.get",
] as const;

export const MUTATING_RPC_METHODS = [
  "project.open",
  "project.close",
  "chat.send",
  "question.answer",
  "batch.accept",
  "build.start",
  "build.pauseAll",
  "build.stop",
  "task.retry",
  "task.takeOver",
  "inbox.resolve",
  "preview.start",
  "settings.set",
  "diag.export",
] as const;

export const RPC_METHODS = [...READ_ONLY_RPC_METHODS, ...MUTATING_RPC_METHODS] as const;

function readOnlyRequest<const M extends string, P extends z.ZodType>(method: M, params: P) {
  return z
    .object({
      jsonrpc,
      id: JsonRpcIdSchema,
      method: z.literal(method),
      params,
    })
    .strict();
}

function mutatingRequest<const M extends string, P extends z.ZodType>(method: M, params: P) {
  return z
    .object({
      jsonrpc,
      id: JsonRpcIdSchema,
      method: z.literal(method),
      op_id: OpIdSchema,
      params,
    })
    .strict();
}

const emptyParams = z.object({}).strict();
const projectParams = z.object({ project_id: idSchema }).strict();

export const SessionHelloParamsSchema = z
  .object({
    token: z.string().min(1).max(512),
    protocol: protocolSchema,
    client: z
      .object({
        name: idSchema,
        version: z.string().min(1).max(64),
      })
      .strict(),
  })
  .strict();

export const ChatSendParamsSchema = z
  .object({
    target: idSchema.nullable(),
    text: noteSchema.refine((text) => text.trim().length > 0, { message: "text must not be empty" }),
    clauses: z.array(z.string().min(1).max(4_096)).max(100),
  })
  .strict();

export const QuestionAnswerParamsSchema = z
  .object({
    question_id: idSchema,
    answer: noteSchema.refine((answer) => answer.trim().length > 0, {
      message: "answer must not be empty",
    }),
  })
  .strict();

export const BatchAcceptParamsSchema = z.object({ batch_id: idSchema }).strict();

export const NodeGetParamsSchema = z.object({ id: idSchema }).strict();

export const NodeSearchParamsSchema = z
  .object({
    query: z.string().min(1).max(1_024),
    limit: z.int().positive().max(100).optional(),
  })
  .strict();

export const GraphViewParamsSchema = z
  .object({
    view: idSchema,
    filter: z.record(z.string().min(1).max(64), z.string().max(512)).optional(),
  })
  .strict();

export const ImpactPreviewParamsSchema = z
  .object({
    change: createJsonValueSchema(JSON_IPC_MAX_BYTES),
  })
  .strict();

export const PlanPreviewParamsSchema = z
  .object({
    feature: idSchema.optional(),
  })
  .strict();

export const InboxListParamsSchema = z
  .object({
    status: z.enum(["open", "answered", "superseded", "dismissed"]).optional(),
  })
  .strict();

export const InboxResolveParamsSchema = z
  .object({
    id: idSchema,
    resolution: z.enum(["answered", "dismissed", "superseded"]),
  })
  .strict();

export const ArtifactOpenParamsSchema = z
  .object({
    id: idSchema,
    range: z
      .object({
        start: nonNegativeIntSchema,
        end: nonNegativeIntSchema,
      })
      .strict()
      .refine((range) => range.end >= range.start, { message: "range end must be >= start" })
      .optional(),
  })
  .strict();

export const DiffGetParamsSchema = z
  .object({
    task: idSchema,
    file: pathSchema,
    hunks: z.array(nonNegativeIntSchema).max(ARRAY_MAX_ITEMS).optional(),
  })
  .strict();

export const SettingsGetParamsSchema = z
  .object({
    key: z.string().min(1).max(256).optional(),
  })
  .strict();

export const SettingsSetParamsSchema = z
  .object({
    key: z.string().min(1).max(256),
    value: createJsonValueSchema(JSON_IPC_MAX_BYTES),
  })
  .strict();

export const DiagExportParamsSchema = z
  .object({
    from: nonNegativeIntSchema.optional(),
    to: nonNegativeIntSchema.optional(),
  })
  .strict()
  .refine((range) => range.from === undefined || range.to === undefined || range.to >= range.from, {
    message: "to must be >= from",
  });

export const EventsSubscribeParamsSchema = z
  .object({
    project: idSchema,
    topics: z.array(z.string().min(1).max(128)).min(1).max(64),
    since_seq: nonNegativeIntSchema,
  })
  .strict();

export const SnapshotGetParamsSchema = z
  .object({
    project: idSchema,
    views: z.array(z.string().min(1).max(128)).min(1).max(32),
  })
  .strict();

export const SessionHelloRequestSchema = readOnlyRequest("session.hello", SessionHelloParamsSchema);
export const SessionPingRequestSchema = readOnlyRequest("session.ping", emptyParams);
export const ProjectListRequestSchema = readOnlyRequest("project.list", emptyParams);
export const NodeGetRequestSchema = readOnlyRequest("node.get", NodeGetParamsSchema);
export const NodeSearchRequestSchema = readOnlyRequest("node.search", NodeSearchParamsSchema);
export const GraphViewRequestSchema = readOnlyRequest("graph.view", GraphViewParamsSchema);
export const ImpactPreviewRequestSchema = readOnlyRequest(
  "impact.preview",
  ImpactPreviewParamsSchema,
);
export const PlanPreviewRequestSchema = readOnlyRequest("plan.preview", PlanPreviewParamsSchema);
export const InboxListRequestSchema = readOnlyRequest("inbox.list", InboxListParamsSchema);
export const ArtifactOpenRequestSchema = readOnlyRequest("artifact.open", ArtifactOpenParamsSchema);
export const DiffGetRequestSchema = readOnlyRequest("diff.get", DiffGetParamsSchema);
export const PreviewUrlRequestSchema = readOnlyRequest("preview.url", projectParams);
export const SettingsGetRequestSchema = readOnlyRequest("settings.get", SettingsGetParamsSchema);
export const EventsSubscribeRequestSchema = readOnlyRequest(
  "events.subscribe",
  EventsSubscribeParamsSchema,
);
export const SnapshotGetRequestSchema = readOnlyRequest("snapshot.get", SnapshotGetParamsSchema);

export const ProjectOpenRequestSchema = mutatingRequest("project.open", projectParams);
export const ProjectCloseRequestSchema = mutatingRequest("project.close", projectParams);
export const ChatSendRequestSchema = mutatingRequest("chat.send", ChatSendParamsSchema);
export const QuestionAnswerRequestSchema = mutatingRequest(
  "question.answer",
  QuestionAnswerParamsSchema,
);
export const BatchAcceptRequestSchema = mutatingRequest("batch.accept", BatchAcceptParamsSchema);
export const BuildStartRequestSchema = mutatingRequest("build.start", projectParams);
export const BuildPauseAllRequestSchema = mutatingRequest("build.pauseAll", projectParams);
export const BuildStopRequestSchema = mutatingRequest("build.stop", projectParams);
export const TaskRetryRequestSchema = mutatingRequest(
  "task.retry",
  z.object({ task: idSchema }).strict(),
);
export const TaskTakeOverRequestSchema = mutatingRequest(
  "task.takeOver",
  z.object({ task: idSchema }).strict(),
);
export const InboxResolveRequestSchema = mutatingRequest(
  "inbox.resolve",
  InboxResolveParamsSchema,
);
export const PreviewStartRequestSchema = mutatingRequest("preview.start", projectParams);
export const SettingsSetRequestSchema = mutatingRequest("settings.set", SettingsSetParamsSchema);
export const DiagExportRequestSchema = mutatingRequest("diag.export", DiagExportParamsSchema);

export const JsonRpcRequestSchema = withinJsonByteLimit(
  z.discriminatedUnion("method", [
    SessionHelloRequestSchema,
    SessionPingRequestSchema,
    ProjectListRequestSchema,
    NodeGetRequestSchema,
    NodeSearchRequestSchema,
    GraphViewRequestSchema,
    ImpactPreviewRequestSchema,
    PlanPreviewRequestSchema,
    InboxListRequestSchema,
    ArtifactOpenRequestSchema,
    DiffGetRequestSchema,
    PreviewUrlRequestSchema,
    SettingsGetRequestSchema,
    EventsSubscribeRequestSchema,
    SnapshotGetRequestSchema,
    ProjectOpenRequestSchema,
    ProjectCloseRequestSchema,
    ChatSendRequestSchema,
    QuestionAnswerRequestSchema,
    BatchAcceptRequestSchema,
    BuildStartRequestSchema,
    BuildPauseAllRequestSchema,
    BuildStopRequestSchema,
    TaskRetryRequestSchema,
    TaskTakeOverRequestSchema,
    InboxResolveRequestSchema,
    PreviewStartRequestSchema,
    SettingsSetRequestSchema,
    DiagExportRequestSchema,
  ]),
);

export const EventsBatchParamsSchema = z
  .object({
    from_seq: nonNegativeIntSchema,
    to_seq: nonNegativeIntSchema,
    events: z.array(EventV1Schema).max(ARRAY_MAX_ITEMS),
  })
  .catchall(z.unknown())
  .refine((batch) => batch.to_seq >= batch.from_seq, {
    message: "to_seq must be >= from_seq",
  });

export const EventsBatchNotificationSchema = z
  .object({
    jsonrpc,
    method: z.literal("events.batch"),
    params: EventsBatchParamsSchema,
  })
  .catchall(z.unknown());

export const ResyncRequiredNotificationSchema = z
  .object({
    jsonrpc,
    method: z.literal("resync_required"),
    params: z
      .object({
        project: idSchema,
        reason: z.enum(["outbox_expired", "stream_epoch_changed"]),
        stream_epoch: nonNegativeIntSchema.optional(),
      })
      .catchall(z.unknown()),
  })
  .catchall(z.unknown());

export const TelemetryNotificationSchema = z
  .object({
    jsonrpc,
    method: z.literal("telemetry"),
    params: z
      .object({
        name: idSchema,
        fields: z.record(
          z.string().min(1).max(64),
          z.union([z.string().max(4_096), z.number(), z.boolean(), z.null()]),
        ),
      })
      .catchall(z.unknown()),
  })
  .catchall(z.unknown());

export const DaemonNotificationSchema = z.discriminatedUnion("method", [
  EventsBatchNotificationSchema,
  ResyncRequiredNotificationSchema,
  TelemetryNotificationSchema,
]);

export const StreamCreditGrantSchema = z
  .object({
    jsonrpc,
    method: z.literal("stream.credit"),
    params: z
      .object({
        stream_id: nonNegativeIntSchema,
        credits: z.int().positive().max(1_024),
      })
      .strict(),
  })
  .strict();

/** Responses keep unknown keys so an older window accepts a newer minor protocol. */
export const JsonRpcSuccessResponseSchema = z
  .object({
    jsonrpc,
    id: JsonRpcIdSchema,
    result: z.unknown(),
  })
  .catchall(z.unknown());

export const JsonRpcErrorObjectSchema = z
  .object({
    code: z.int(),
    message: z.string().min(1).max(8_192),
    data: z.unknown().optional(),
  })
  .catchall(z.unknown());

export const JsonRpcErrorResponseSchema = z
  .object({
    jsonrpc,
    id: JsonRpcIdSchema.nullable(),
    error: JsonRpcErrorObjectSchema,
  })
  .catchall(z.unknown());

export const ArtifactOpenResultSchema = z
  .object({
    stream_id: nonNegativeIntSchema,
  })
  .catchall(z.unknown());

const snapshotSectionSchema = createJsonValueSchema(SNAPSHOT_SECTION_MAX_BYTES);

export const SnapshotGetResultSchema = z
  .object({
    as_of_seq: nonNegativeIntSchema,
    views: z
      .array(
        z
          .object({
            name: idSchema,
            section: snapshotSectionSchema,
          })
          .catchall(z.unknown()),
      )
      .max(32),
  })
  .catchall(z.unknown());

export const FrameHeaderSchema = z.discriminatedUnion("channel", [
  z
    .object({
      channel: z.literal(JSON_RPC_CHANNEL),
      length: nonNegativeIntSchema.max(JSON_IPC_MAX_BYTES),
    })
    .strict(),
  z
    .object({
      channel: z.literal(BINARY_STREAM_CHANNEL),
      length: nonNegativeIntSchema.max(BINARY_CHUNK_BYTES),
      stream_id: nonNegativeIntSchema.max(0xffff_ffff),
    })
    .strict(),
]);

export function decodeFrameHeader(bytes: Uint8Array): FrameHeader {
  if (bytes.byteLength < 5) {
    throw new Error("frame header is shorter than 5 bytes");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(0, false);
  const channel = bytes[4];
  if (channel === JSON_RPC_CHANNEL) {
    return FrameHeaderSchema.parse({ channel: JSON_RPC_CHANNEL, length });
  }
  if (channel === BINARY_STREAM_CHANNEL) {
    if (bytes.byteLength < 9) {
      throw new Error("binary frame header is shorter than 9 bytes");
    }
    const streamId = view.getUint32(5, false);
    return FrameHeaderSchema.parse({
      channel: BINARY_STREAM_CHANNEL,
      length,
      stream_id: streamId,
    });
  }
  throw new Error(`unknown frame channel ${String(channel)}`);
}

export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;
export type DaemonNotification = z.infer<typeof DaemonNotificationSchema>;
export type StreamCreditGrant = z.infer<typeof StreamCreditGrantSchema>;
export type FrameHeader = z.infer<typeof FrameHeaderSchema>;
export type ReadOnlyRpcMethod = (typeof READ_ONLY_RPC_METHODS)[number];
export type MutatingRpcMethod = (typeof MUTATING_RPC_METHODS)[number];
