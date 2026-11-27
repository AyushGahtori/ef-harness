import { z } from "zod";
import {
  idSchema,
  integerUnits,
  jsonValueSchema,
  microUsdSchema,
  nonNegativeIntSchema,
  noteSchema,
  pathSchema,
  shortTextSchema,
  unixMsSchema,
  ARRAY_MAX_ITEMS,
} from "./bounds.js";

export const WORKER_TOOL_KINDS = ["read", "search", "edit", "shell", "web", "mcp"] as const;
export const WORKER_ERROR_KINDS = [
  "auth",
  "rate_limit",
  "usage_limit",
  "billing",
  "overloaded",
  "context_overflow",
  "other",
] as const;

const workerSchema = z.literal("worker-event@1");

export const WorkerEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      schema: workerSchema,
      type: z.literal("session.started"),
      session_ref: idSchema,
    })
    .strict(),
  z
    .object({
      schema: workerSchema,
      type: z.literal("session.ended"),
      session_ref: idSchema,
    })
    .strict(),
  z
    .object({
      schema: workerSchema,
      type: z.literal("turn.started"),
      session_ref: idSchema,
    })
    .strict(),
  z
    .object({
      schema: workerSchema,
      type: z.literal("turn.completed"),
      session_ref: idSchema,
      stop_reason: idSchema,
    })
    .strict(),
  z
    .object({
      schema: workerSchema,
      type: z.literal("plan.updated"),
      steps: z.array(shortTextSchema).max(ARRAY_MAX_ITEMS),
    })
    .strict(),
  z
    .object({
      schema: workerSchema,
      type: z.literal("tool.requested"),
      kind: z.enum(WORKER_TOOL_KINDS),
      args: jsonValueSchema,
    })
    .strict(),
  z
    .object({
      schema: workerSchema,
      type: z.literal("permission.requested"),
      id: idSchema,
      tool: idSchema,
      args: jsonValueSchema,
    })
    .strict(),
  z
    .object({
      schema: workerSchema,
      type: z.literal("tool.completed"),
      result: noteSchema,
      exit_code: z
        .number()
        .int()
        .min(0)
        .max(2_147_483_647)
        .refine((value) => !Object.is(value, -0), {
          message: "signed zero is not an integer unit",
        }),
    })
    .strict(),
  z
    .object({
      schema: workerSchema,
      type: z.literal("file.changed"),
      paths: z.array(pathSchema).min(1).max(ARRAY_MAX_ITEMS),
    })
    .strict(),
  z
    .object({
      schema: workerSchema,
      type: z.literal("input.requested"),
      question: shortTextSchema,
    })
    .strict(),
  z
    .object({
      schema: workerSchema,
      type: z.literal("subagent.started"),
      session_ref: idSchema,
    })
    .strict(),
  z
    .object({
      schema: workerSchema,
      type: z.literal("subagent.stopped"),
      session_ref: idSchema,
    })
    .strict(),
  z
    .object({
      schema: workerSchema,
      type: z.literal("usage"),
      tokens: nonNegativeIntSchema,
      cost_micro_usd: microUsdSchema.optional(),
    })
    .strict(),
  z
    .object({
      schema: workerSchema,
      type: z.literal("rate_limit"),
      status: idSchema,
      resets_at: unixMsSchema.optional(),
      used_ppm: integerUnits({ max: 1_000_000 }).optional(),
    })
    .strict(),
  z
    .object({
      schema: workerSchema,
      type: z.literal("error"),
      kind: z.enum(WORKER_ERROR_KINDS),
      message: noteSchema.optional(),
    })
    .strict(),
  z
    .object({
      schema: workerSchema,
      type: z.literal("message.delta"),
      text: noteSchema,
    })
    .strict(),
]);

export type WorkerEvent = z.infer<typeof WorkerEventSchema>;
