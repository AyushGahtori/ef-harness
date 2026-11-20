import { z } from "zod";

export const RubricCriterionScoreSchema = z
  .object({
    id: z.string().min(1),
    met: z.boolean(),
  })
  .strict();

export const RubricScoreSchema = z
  .object({
    caseId: z.string().min(1),
    passed: z.boolean(),
    criticalFailure: z.boolean(),
    criteria: z.array(RubricCriterionScoreSchema).min(1),
  })
  .strict();

export type RubricScore = z.infer<typeof RubricScoreSchema>;

export function parseRubricScore(
  text: string,
  caseId: string,
): { ok: true; score: RubricScore } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    return { ok: false, error: "response is not a JSON object" };
  }
  let value: unknown;
  try {
    value = JSON.parse(trimmed) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
  const parsed = RubricScoreSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join("; ") };
  }
  if (parsed.data.caseId !== caseId) {
    return { ok: false, error: "caseId does not match the eval case" };
  }
  return { ok: true, score: parsed.data };
}
