import { z } from "zod";
import { SNAPSHOT_VIEWS, SUPPORTED_PROTOCOL_VERSIONS } from "./constants.js";

const opId = z.string().trim().min(1);
const projectId = z.string().trim().min(1);

export const domainEventSchema = z
  .object({
    seq: z.number().int().nonnegative(),
    id: z.string().min(1),
    type: z.string().min(1),
    payload: z.unknown(),
    topic: z.string().min(1).optional(),
    subject: z.string().nullable().optional(),
    rev: z.number().int().nullable().optional(),
    createdAt: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const eventsBatchSchema = z
  .object({
    from_seq: z.number().int().nonnegative(),
    to_seq: z.number().int().nonnegative(),
    events: z.array(domainEventSchema),
  })
  .passthrough();

export const resyncRequiredSchema = z
  .object({
    status: z.literal("resync_required"),
    current_stream_epoch: z.string().min(1),
    latest_seq: z.number().int().nonnegative(),
  })
  .passthrough();

export const subscribeLiveSchema = z
  .object({
    status: z.literal("live"),
    stream_epoch: z.string().min(1),
    last_seq: z.number().int().nonnegative(),
    replayed_from: z.number().int().nonnegative(),
    replayed_to: z.number().int().nonnegative(),
  })
  .passthrough();

export const snapshotPageSchema = z
  .object({
    as_of_seq: z.number().int().nonnegative(),
    stream_epoch: z.string().min(1),
    sections: z.record(z.unknown()),
    nextCursor: z.string().min(1).nullable(),
  })
  .passthrough();

export const telemetryParamsSchema = z
  .object({
    project: projectId,
    kind: z.string().min(1),
    payload: z.unknown(),
  })
  .passthrough();

export const subscribeParamsSchema = z
  .object({
    project: projectId,
    topics: z.array(z.string().trim().min(1)),
    since_seq: z.number().int().nonnegative(),
    stream_epoch: z.string().trim().min(1).optional(),
  })
  .passthrough();

export const snapshotParamsSchema = z
  .object({
    project: projectId,
    views: z.array(z.enum(SNAPSHOT_VIEWS)).min(1),
    cursor: z.string().min(1).optional(),
  })
  .passthrough();

const loose = z.object({}).passthrough();

export const rpcParamSchemas = {
  "session.hello": z
    .object({
      token: z.string().min(1),
      protocol: z.enum(SUPPORTED_PROTOCOL_VERSIONS),
      client: z.union([z.string().min(1), z.record(z.unknown())]),
    })
    .passthrough(),
  "session.ping": loose,
  "project.list": loose,
  "project.open": z.object({ op_id: opId, project: projectId }).passthrough(),
  "project.close": z.object({ op_id: opId, project: projectId }).passthrough(),
  "chat.send": z
    .object({
      op_id: opId,
      target: z.string().trim().min(1),
      text: z.string(),
      clauses: z.array(z.unknown()),
      project: projectId.optional(),
    })
    .passthrough(),
  "question.answer": z
    .object({
      op_id: opId,
      questionId: z.string().trim().min(1),
      answer: z.unknown(),
      project: projectId.optional(),
    })
    .passthrough(),
  "batch.accept": z
    .object({
      op_id: opId,
      batchId: z.string().trim().min(1),
      project: projectId.optional(),
    })
    .passthrough(),
  "node.get": z.object({ id: z.string().trim().min(1), project: projectId.optional() }).passthrough(),
  "node.search": z
    .object({ query: z.string(), project: projectId.optional() })
    .passthrough(),
  "graph.view": z
    .object({
      view: z.string().trim().min(1),
      filter: z.record(z.unknown()).optional(),
      project: projectId.optional(),
    })
    .passthrough(),
  "impact.preview": z
    .object({
      change: z.record(z.unknown()),
      project: projectId.optional(),
    })
    .passthrough(),
  "plan.preview": z
    .object({ feature: z.string().trim().min(1).optional(), project: projectId.optional() })
    .passthrough(),
  "build.start": z.object({ op_id: opId, project: projectId.optional() }).passthrough(),
  "build.pauseAll": z.object({ op_id: opId, project: projectId.optional() }).passthrough(),
  "build.stop": z.object({ op_id: opId, project: projectId.optional() }).passthrough(),
  "task.retry": z.object({ op_id: opId, task: z.string().trim().min(1), project: projectId.optional() }).passthrough(),
  "task.takeOver": z
    .object({ op_id: opId, task: z.string().trim().min(1), project: projectId.optional() })
    .passthrough(),
  "inbox.list": z
    .object({
      project: projectId.optional(),
      status: z.enum(["open", "answered", "superseded", "dismissed"]).optional(),
    })
    .passthrough(),
  "inbox.resolve": z
    .object({
      op_id: opId,
      id: z.string().trim().min(1),
      resolution: z.string().trim().min(1),
      project: projectId.optional(),
    })
    .passthrough(),
  "artifact.open": z
    .object({
      op_id: opId,
      id: z.string().trim().min(1),
      range: z
        .object({
          start: z.number().int().nonnegative(),
          end: z.number().int().nonnegative(),
        })
        .optional(),
      project: projectId.optional(),
    })
    .passthrough(),
  "diff.get": z
    .object({
      task: z.string().trim().min(1),
      file: z.string().trim().min(1),
      hunks: z
        .array(
          z.object({
            start: z.number().int().nonnegative(),
            end: z.number().int().nonnegative(),
          }),
        )
        .optional(),
      project: projectId.optional(),
    })
    .passthrough(),
  "preview.start": z.object({ op_id: opId, project: projectId.optional() }).passthrough(),
  "preview.url": z.object({ project: projectId.optional() }).passthrough(),
  "settings.get": z.object({ key: z.string().trim().min(1).optional(), project: projectId.optional() }).passthrough(),
  "settings.set": z
    .object({
      op_id: opId,
      key: z.string().trim().min(1),
      value: z.unknown(),
      project: projectId.optional(),
    })
    .passthrough(),
  "diag.export": z.object({ project: projectId.optional() }).passthrough(),
  "events.subscribe": subscribeParamsSchema,
  "snapshot.get": snapshotParamsSchema,
} as const;

export type RpcMethodName = keyof typeof rpcParamSchemas;
