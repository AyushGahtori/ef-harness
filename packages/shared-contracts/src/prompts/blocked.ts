import { z } from "zod";
import { IdSchema, TextSchema } from "./common.js";

/** Honest exit every role may return instead of guessing. */
export const BlockedExitSchema = z
  .object({
    blocked: z.literal(true),
    reason: TextSchema,
    missing_ids: z.array(IdSchema).optional(),
  })
  .strict();

export type BlockedExit = z.infer<typeof BlockedExitSchema>;

export function withHonestExit<T extends z.ZodType>(success: T) {
  return z.union([BlockedExitSchema, success]);
}
