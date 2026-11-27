import { z } from "zod";

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
    project: z.string().trim().min(1),
    kind: z.string().min(1),
    payload: z.unknown(),
  })
  .passthrough();
