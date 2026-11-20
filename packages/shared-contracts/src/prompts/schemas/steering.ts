import { z } from "zod";
import { withHonestExit } from "../blocked.js";
import {
  EARS_TEXT_PATTERN,
  IdSchema,
  NonNegativeIntSchema,
  PositiveIntSchema,
  TextSchema,
  UnitIntervalSchema,
  addIssue,
} from "../common.js";

const ROUTER_INTENTS = [
  "question",
  "change",
  "correct_evidence",
  "add",
  "remove",
  "explain_impact",
  "new_feature",
  "control",
] as const;

const RouterClauseSchema = z
  .object({
    span: z
      .object({
        start: NonNegativeIntSchema,
        end: PositiveIntSchema,
      })
      .strict(),
    intent: z.enum(ROUTER_INTENTS),
    target_id: IdSchema.nullable(),
    confidence: UnitIntervalSchema,
    needs_clarification: z.boolean(),
  })
  .strict()
  .superRefine((clause, ctx) => {
    if (clause.span.end <= clause.span.start) {
      addIssue(ctx, ["span", "end"], "end must be greater than start");
    }
    const needsTarget =
      clause.intent === "change" ||
      clause.intent === "correct_evidence" ||
      clause.intent === "remove";
    if (needsTarget && clause.target_id === null && !clause.needs_clarification) {
      addIssue(ctx, ["target_id"], "a mutating clause needs a target or needs_clarification");
    }
  });

const RouterSuccessSchema = z
  .object({
    clauses: z.array(RouterClauseSchema),
  })
  .strict();

export const RouterV1Schema = withHonestExit(RouterSuccessSchema);
export type RouterV1 = z.infer<typeof RouterV1Schema>;

const SpecExpanderCellSchema = z
  .object({
    cell_id: IdSchema,
    value: z.string().trim().min(1).nullable(),
    basis: z.enum(["proposed"]).nullable(),
    status: z.enum(["asked"]).nullable(),
    ears_text: TextSchema,
    oracle_sketch: TextSchema,
    risk: z.enum(["low", "medium", "high"]),
    premises: z.array(IdSchema),
  })
  .strict()
  .superRefine((cell, ctx) => {
    const proposed = cell.basis === "proposed";
    const asked = cell.status === "asked";
    if (proposed === asked) {
      addIssue(ctx, ["basis"], "set basis proposed or status asked, and never both");
    }
    if (proposed && cell.value === null) {
      addIssue(ctx, ["value"], "a proposed cell needs a value");
    }
    if (asked && cell.value !== null) {
      addIssue(ctx, ["value"], "an asked cell leaves the value unset");
    }
    if (!EARS_TEXT_PATTERN.test(cell.ears_text)) {
      addIssue(ctx, ["ears_text"], "ears_text must be one EARS sentence");
    }
  });

const SpecExpanderSuccessSchema = z
  .object({
    cells: z.array(SpecExpanderCellSchema),
  })
  .strict();

export const SpecExpanderV1Schema = withHonestExit(SpecExpanderSuccessSchema);
export type SpecExpanderV1 = z.infer<typeof SpecExpanderV1Schema>;

const ContradictionCheckSuccessSchema = z
  .object({
    verdict: z.enum(["conflict", "compatible", "unclear"]),
    explanation: TextSchema,
    minimal_change_suggestion: z.string().trim().min(1).nullable(),
  })
  .strict();

export const ContradictionCheckV1Schema = withHonestExit(ContradictionCheckSuccessSchema);
export type ContradictionCheckV1 = z.infer<typeof ContradictionCheckV1Schema>;
