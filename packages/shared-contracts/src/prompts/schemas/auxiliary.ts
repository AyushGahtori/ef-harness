import { z } from "zod";
import { withHonestExit } from "../blocked.js";
import {
  FieldPairSchema,
  IdSchema,
  LocatorSchema,
  NonNegativeIntSchema,
  PositiveIntSchema,
  TextSchema,
  UnitIntervalSchema,
  VerbatimTextSchema,
  addIssue,
  refineLocator,
} from "../common.js";
import {
  COCKPIT_EXPLAINER_MAX_CHARS,
  COCKPIT_EXPLAINER_MAX_SENTENCES,
  TURN_SUMMARIZER_MAX_TOKENS,
  countSentences,
  estimatePromptTokens,
} from "../text-bounds.js";

const EntailmentCheckerSuccessSchema = z
  .object({
    verdict: z.enum(["establishes", "contradicts", "leaves_open"]),
    reason: TextSchema,
  })
  .strict();

export const EntailmentCheckerV1Schema = withHonestExit(EntailmentCheckerSuccessSchema);
export type EntailmentCheckerV1 = z.infer<typeof EntailmentCheckerV1Schema>;

const AskOwnerResponderSuccessSchema = z
  .object({
    kind: z.enum(["answer", "brief_fix", "dispute_upheld", "dispute_rejected", "escalate"]),
    text: TextSchema,
    changes: z.array(
      z
        .object({
          target_id: IdSchema,
          text: TextSchema,
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    const needsChange = value.kind === "brief_fix" || value.kind === "dispute_upheld";
    const forbidsChange = value.kind === "dispute_rejected" || value.kind === "escalate";
    if (needsChange && value.changes.length === 0) {
      addIssue(ctx, ["changes"], "this kind needs at least one change");
    }
    if (forbidsChange && value.changes.length > 0) {
      addIssue(ctx, ["changes"], "this kind does not carry changes");
    }
  });

export const AskOwnerResponderV1Schema = withHonestExit(AskOwnerResponderSuccessSchema);
export type AskOwnerResponderV1 = z.infer<typeof AskOwnerResponderV1Schema>;

const DocImportProposalSchema = z
  .object({
    kind: z.enum(["new_node", "update", "new_edge", "note"]),
    target_id: IdSchema.nullable(),
    node_type: z.string().trim().min(1).nullable(),
    fields: z.array(FieldPairSchema),
    text: VerbatimTextSchema,
    confidence: UnitIntervalSchema,
  })
  .strict()
  .superRefine((proposal, ctx) => {
    if (proposal.kind === "new_node") {
      if (proposal.target_id !== null) {
        addIssue(ctx, ["target_id"], "a new node has no target yet");
      }
      if (proposal.node_type === null) {
        addIssue(ctx, ["node_type"], "a new node needs a node type");
      }
    }
    if (
      (proposal.kind === "update" || proposal.kind === "new_edge") &&
      proposal.target_id === null
    ) {
      addIssue(ctx, ["target_id"], "update and new_edge proposals name a target");
    }
    if (proposal.kind === "note" && proposal.node_type !== null) {
      addIssue(ctx, ["node_type"], "a note does not invent a node type");
    }
  });

const DocImportSuccessSchema = z
  .object({
    proposals: z.array(DocImportProposalSchema),
  })
  .strict();

export const DocImportV1Schema = withHonestExit(DocImportSuccessSchema);
export type DocImportV1 = z.infer<typeof DocImportV1Schema>;

const IntakeStatementSchema = z
  .object({
    text: VerbatimTextSchema,
    locator: LocatorSchema,
    kind: z.enum(["decision", "requirement", "entity", "rule", "question"]),
    criterion_id: IdSchema.nullable(),
    value: z.string().nullable(),
  })
  .strict()
  .superRefine((statement, ctx) => {
    refineLocator(statement.locator, ctx, ["locator"]);
    if (statement.value !== null && statement.value.trim().length === 0) {
      addIssue(ctx, ["value"], "value must not be blank");
    }
  });

const SuspiciousInstructionSchema = z
  .object({
    text: VerbatimTextSchema,
    locator: LocatorSchema,
    reason: TextSchema,
  })
  .strict()
  .superRefine((item, ctx) => {
    refineLocator(item.locator, ctx, ["locator"]);
  });

const IntakeExtractorSuccessSchema = z
  .object({
    statements: z.array(IntakeStatementSchema),
    suspicious_instructions: z.array(SuspiciousInstructionSchema),
  })
  .strict();

export const IntakeExtractorV1Schema = withHonestExit(IntakeExtractorSuccessSchema);
export type IntakeExtractorV1 = z.infer<typeof IntakeExtractorV1Schema>;

const LocatedTextSchema = z
  .object({
    text: VerbatimTextSchema,
    locator: LocatorSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    refineLocator(value.locator, ctx, ["locator"]);
  });

const SYMPTOM_FIELDS = [
  "title",
  "observed",
  "expected",
  "steps",
  "environment",
  "frequency",
  "first_seen",
  "last_seen",
  "affected_users",
  "stack_frames",
] as const;

const IssueTriageSuccessSchema = z
  .object({
    title: LocatedTextSchema.nullable(),
    observed: LocatedTextSchema.nullable(),
    expected: LocatedTextSchema.nullable(),
    steps: LocatedTextSchema.nullable(),
    environment: LocatedTextSchema.nullable(),
    frequency: LocatedTextSchema.nullable(),
    first_seen: LocatedTextSchema.nullable(),
    last_seen: LocatedTextSchema.nullable(),
    affected_users: LocatedTextSchema.nullable(),
    stack_frames: z.array(
      z
        .object({
          text: VerbatimTextSchema,
          locator: LocatorSchema,
          file: z.string().nullable(),
          line: PositiveIntSchema.nullable(),
        })
        .strict()
        .superRefine((frame, ctx) => {
          refineLocator(frame.locator, ctx, ["locator"]);
        }),
    ),
    missing: z.array(z.enum(SYMPTOM_FIELDS)),
  })
  .strict()
  .superRefine((card, ctx) => {
    for (const name of SYMPTOM_FIELDS) {
      const present =
        name === "stack_frames" ? card.stack_frames.length > 0 : card[name] !== null;
      const listed = card.missing.includes(name);
      if (present && listed) {
        addIssue(ctx, ["missing"], `${name} is present and must not be listed as missing`);
      }
      if (!present && !listed) {
        addIssue(ctx, ["missing"], `${name} is absent and must be listed as missing`);
      }
    }
  });

export const IssueTriageV1Schema = withHonestExit(IssueTriageSuccessSchema);
export type IssueTriageV1 = z.infer<typeof IssueTriageV1Schema>;

const ModuleCardWriterSuccessSchema = z
  .object({
    module: TextSchema,
    purpose: TextSchema,
    key_exports: z.array(
      z
        .object({
          name: IdSchema,
          signature: TextSchema,
          file: TextSchema,
          line: PositiveIntSchema,
        })
        .strict(),
    ),
    reads: z.array(TextSchema),
    writes: z.array(TextSchema),
    side_effects: z.array(TextSchema),
    tests: z.array(TextSchema),
    confidence: z.enum(["low", "medium", "high"]),
  })
  .strict();

export const ModuleCardWriterV1Schema = withHonestExit(ModuleCardWriterSuccessSchema);
export type ModuleCardWriterV1 = z.infer<typeof ModuleCardWriterV1Schema>;

const MechanicalStepSchema = z
  .object({
    tool: TextSchema,
    script: z.string().trim().min(1).nullable(),
    codemod: z.string().trim().min(1).nullable(),
    scope: TextSchema,
  })
  .strict()
  .superRefine((step, ctx) => {
    const hasScript = step.script !== null;
    const hasCodemod = step.codemod !== null;
    if (hasScript === hasCodemod) {
      addIssue(ctx, ["script"], "a mechanical step sets exactly one of script or codemod");
    }
  });

const SweepPlannerSuccessSchema = z
  .object({
    mechanical_steps: z.array(MechanicalStepSchema),
    batches: z.array(
      z
        .object({
          paths: z.array(TextSchema).min(1),
          order: NonNegativeIntSchema,
          checks: z.array(TextSchema),
        })
        .strict(),
    ),
    behavior_preserving: z.boolean(),
    intended_changes: z.array(TextSchema),
    persisted_names: z.array(TextSchema),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const orders = new Set(plan.batches.map((batch) => batch.order));
    if (orders.size !== plan.batches.length) {
      addIssue(ctx, ["batches"], "batch order values must be unique");
    }
    if (!plan.behavior_preserving && plan.intended_changes.length === 0) {
      addIssue(ctx, ["intended_changes"], "name the behavior changes that are intended");
    }
  });

export const SweepPlannerV1Schema = withHonestExit(SweepPlannerSuccessSchema);
export type SweepPlannerV1 = z.infer<typeof SweepPlannerV1Schema>;

const SweepWorkerSuccessSchema = z
  .object({
    submit_batch: z.array(
      z
        .object({
          id: IdSchema,
          mark: z.enum(["fixed", "kept", "blocked"]),
          reason: z.string().trim().min(1).nullable(),
        })
        .strict()
        .superRefine((item, ctx) => {
          if (item.mark === "fixed" && item.reason !== null) {
            addIssue(ctx, ["reason"], "a fixed item does not need a reason");
          }
          if ((item.mark === "kept" || item.mark === "blocked") && item.reason === null) {
            addIssue(ctx, ["reason"], "kept and blocked items require a reason");
          }
        }),
    ),
  })
  .strict();

export const SweepWorkerV1Schema = withHonestExit(SweepWorkerSuccessSchema);
export type SweepWorkerV1 = z.infer<typeof SweepWorkerV1Schema>;

const VisualSteerSuccessSchema = z
  .object({
    target: z
      .object({
        kind: z.enum(["style", "copy", "layout", "behavior"]),
        node_id: IdSchema,
        file: TextSchema,
        component: TextSchema,
      })
      .strict(),
    intent: TextSchema,
    needs_question: z.boolean(),
    conflict: z.string().trim().min(1).nullable(),
  })
  .strict();

export const VisualSteerV1Schema = withHonestExit(VisualSteerSuccessSchema);
export type VisualSteerV1 = z.infer<typeof VisualSteerV1Schema>;

const TasteReviewerSuccessSchema = z
  .object({
    advisory: z.literal(true),
    findings: z.array(
      z
        .object({
          screen: TextSchema,
          region: TextSchema,
          kind: z.enum(["spacing", "alignment", "hierarchy", "color", "consistency"]),
          severity: z.enum(["low", "medium", "high"]),
          suggestion: TextSchema,
        })
        .strict(),
    ),
  })
  .strict();

export const TasteReviewerV1Schema = withHonestExit(TasteReviewerSuccessSchema);
export type TasteReviewerV1 = z.infer<typeof TasteReviewerV1Schema>;

const TurnSummarizerSuccessSchema = z
  .object({
    progress_note: z
      .string()
      .trim()
      .min(1)
      .superRefine((value, ctx) => {
        if (estimatePromptTokens(value) > TURN_SUMMARIZER_MAX_TOKENS) {
          addIssue(
            ctx,
            [],
            `progress_note exceeds ${String(TURN_SUMMARIZER_MAX_TOKENS)} tokens`,
          );
        }
      }),
  })
  .strict();

export const TurnSummarizerV1Schema = withHonestExit(TurnSummarizerSuccessSchema);
export type TurnSummarizerV1 = z.infer<typeof TurnSummarizerV1Schema>;

const CockpitExplainerSuccessSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1)
      .max(COCKPIT_EXPLAINER_MAX_CHARS)
      .superRefine((value, ctx) => {
        if (countSentences(value) > COCKPIT_EXPLAINER_MAX_SENTENCES) {
          addIssue(
            ctx,
            [],
            `cockpit explainer allows at most ${String(COCKPIT_EXPLAINER_MAX_SENTENCES)} sentences`,
          );
        }
      }),
  })
  .strict();

export const CockpitExplainerV1Schema = withHonestExit(CockpitExplainerSuccessSchema);
export type CockpitExplainerV1 = z.infer<typeof CockpitExplainerV1Schema>;
