import { z } from "zod";

export const WiringNeedSchema = z
  .object({
    kind: z.string().min(1),
    path: z.string().min(1),
    component: z.string().min(1),
  })
  .strict();

export const LocalCheckSchema = z
  .object({
    cmd: z.string().min(1),
    exit: z.number().int(),
  })
  .strict();

/**
 * Local stand-in for Task 008 `CandidateV1Schema`.
 * Shape matches `candidate@1` in the build pipeline. `changed_paths` is accepted
 * and then ignored: the kernel computes paths from git.
 */
export const CandidateV1Schema = z
  .object({
    schema: z.literal("candidate@1"),
    task: z.string().min(1),
    attempt: z.union([z.string().min(1), z.number().int()]),
    epoch: z.number().int(),
    commit: z.string().min(1).optional(),
    changed_paths: z.array(z.string()).optional(),
    dependency_intents: z.array(z.unknown()).optional(),
    wiring_needs: z.array(WiringNeedSchema).optional(),
    local_checks: z.array(LocalCheckSchema).optional(),
    note: z.string().optional(),
  })
  .strict();

export function formatValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "arguments";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}
