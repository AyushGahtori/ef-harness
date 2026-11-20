import { z } from "zod";
import { withHonestExit } from "../blocked.js";
import { IdSchema, NonNegativeIntSchema, TextSchema, addIssue } from "../common.js";

export const CANDIDATE_NOTE_MAX_CHARS = 2000;

const DependencyIntentSchema = z
  .object({
    name: TextSchema,
    range: z.string().nullable(),
    reason: TextSchema,
  })
  .strict();

const WiringNeedSchema = z
  .object({
    kind: z.enum(["route", "page", "export", "migration", "env", "component"]),
    path: TextSchema,
    component: z.string().nullable(),
  })
  .strict();

const LeafWorkerSuccessSchema = z
  .object({
    schema: z.literal("candidate@1"),
    task: IdSchema,
    attempt: NonNegativeIntSchema,
    epoch: NonNegativeIntSchema,
    commit: TextSchema,
    changed_paths: z.array(TextSchema),
    dependency_intents: z.array(DependencyIntentSchema),
    migration_intents: z
      .array(
        z
          .object({
            id: IdSchema,
            text: TextSchema,
          })
          .strict(),
      )
      .default([]),
    wiring_needs: z.array(WiringNeedSchema),
    local_checks: z.array(
      z
        .object({
          cmd: TextSchema,
          exit: z.number().int(),
        })
        .strict(),
    ),
    note: z.string().max(CANDIDATE_NOTE_MAX_CHARS),
  })
  .strict();

export const LeafWorkerV1Schema = withHonestExit(LeafWorkerSuccessSchema);
export type LeafWorkerV1 = z.infer<typeof LeafWorkerV1Schema>;

const EXPECTATION_KEY = /expected|expectation|oracle|assertion/i;

function rejectExpectationKeys(
  value: unknown,
  ctx: z.RefinementCtx,
  path: (string | number)[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      rejectExpectationKeys(item, ctx, [...path, index]);
    });
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (EXPECTATION_KEY.test(key)) {
      addIssue(ctx, [...path, key], "blind-binder output cannot carry expected values");
    }
    rejectExpectationKeys(child, ctx, [...path, key]);
  }
}

const BlindBinderSuccessSchema = z
  .object({
    entry_used: TextSchema,
    observations_schema: z
      .object({
        fields: z.array(
          z
            .object({
              name: IdSchema,
              type: TextSchema,
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    value.observations_schema.fields.forEach((field, index) => {
      if (EXPECTATION_KEY.test(field.name)) {
        addIssue(
          ctx,
          ["observations_schema", "fields", index, "name"],
          "observation fields cannot name expected values",
        );
      }
    });
    rejectExpectationKeys(value, ctx, []);
  });

export const BlindBinderV1Schema = withHonestExit(BlindBinderSuccessSchema);
export type BlindBinderV1 = z.infer<typeof BlindBinderV1Schema>;

const ReviewerSuccessSchema = z
  .object({
    findings: z.array(
      z
        .object({
          kind: z.enum(["special_casing", "weakened_logic", "missing_rule", "unsafe"]),
          location: TextSchema,
          explanation: TextSchema,
        })
        .strict(),
    ),
    verdict: z.enum(["ok", "concerns"]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.verdict === "ok" && value.findings.length > 0) {
      addIssue(ctx, ["verdict"], "verdict ok requires an empty findings list");
    }
    if (value.verdict === "concerns" && value.findings.length === 0) {
      addIssue(ctx, ["verdict"], "verdict concerns requires at least one finding");
    }
  });

export const ReviewerV1Schema = withHonestExit(ReviewerSuccessSchema);
export type ReviewerV1 = z.infer<typeof ReviewerV1Schema>;

const FeatureIntegratorSuccessSchema = z
  .object({
    resolved_conflicts: z.array(
      z
        .object({
          path: TextSchema,
          summary: TextSchema,
        })
        .strict(),
    ),
    wiring_done: z.array(IdSchema),
    rerun_checks: z.array(IdSchema),
  })
  .strict();

export const FeatureIntegratorV1Schema = withHonestExit(FeatureIntegratorSuccessSchema);
export type FeatureIntegratorV1 = z.infer<typeof FeatureIntegratorV1Schema>;

const ProjectIntegratorSuccessSchema = z
  .object({
    migrations_order: z.array(IdSchema),
    ccr_decisions: z.array(
      z
        .object({
          id: IdSchema,
          class: z.enum(["additive", "breaking"]),
          decision: z.enum(["approve", "revise"]),
        })
        .strict()
        .superRefine((row, ctx) => {
          if (row.class === "additive" && row.decision !== "approve") {
            addIssue(ctx, ["decision"], "additive change requests are approved");
          }
          if (row.class === "breaking" && row.decision !== "revise") {
            addIssue(ctx, ["decision"], "breaking change requests are sent to revision");
          }
        }),
    ),
    rerun_suites: z.array(IdSchema),
  })
  .strict();

export const ProjectIntegratorV1Schema = withHonestExit(ProjectIntegratorSuccessSchema);
export type ProjectIntegratorV1 = z.infer<typeof ProjectIntegratorV1Schema>;

const LocatedFindingSchema = z
  .object({
    requirement: IdSchema,
    location: TextSchema,
    detail: TextSchema,
  })
  .strict();

const FinalProjectAuditorSuccessSchema = z
  .object({
    missing: z.array(LocatedFindingSchema),
    stubbed: z.array(LocatedFindingSchema),
    unhandled_edge_cases: z.array(LocatedFindingSchema),
    weak_checks: z.array(
      z
        .object({
          check: IdSchema,
          requirement: IdSchema,
          why: TextSchema,
        })
        .strict(),
    ),
    verdict: z.enum(["complete", "incomplete"]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const nonempty =
      value.missing.length > 0 ||
      value.stubbed.length > 0 ||
      value.unhandled_edge_cases.length > 0 ||
      value.weak_checks.length > 0;
    if (value.verdict === "complete" && nonempty) {
      addIssue(
        ctx,
        ["verdict"],
        "verdict complete is valid only when missing, stubbed, unhandled_edge_cases, and weak_checks are all empty",
      );
    }
  });

export const FinalProjectAuditorV1Schema = withHonestExit(FinalProjectAuditorSuccessSchema);
export type FinalProjectAuditorV1 = z.infer<typeof FinalProjectAuditorV1Schema>;

const ExperimentSchema = z
  .object({
    outcome: z.literal("experiment"),
    hypothesis: TextSchema,
    experiment: TextSchema,
    expected_if_true: TextSchema,
    expected_if_false: TextSchema,
  })
  .strict();

const RootCauseSchema = z
  .object({
    outcome: z.literal("root_cause"),
    root_cause: TextSchema,
    evidence: z.array(TextSchema).min(1),
    minimal_change: TextSchema,
  })
  .strict();

const InvestigatorOutcomeSchema = z.discriminatedUnion("outcome", [
  ExperimentSchema,
  RootCauseSchema,
]);

function tagInvestigatorOutcome(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  if ("blocked" in record || "outcome" in record) return input;
  if ("hypothesis" in record && !("root_cause" in record)) {
    return { ...record, outcome: "experiment" };
  }
  if ("root_cause" in record && !("hypothesis" in record)) {
    return { ...record, outcome: "root_cause" };
  }
  return input;
}

export const InvestigatorV1Schema = z.preprocess(
  tagInvestigatorOutcome,
  withHonestExit(InvestigatorOutcomeSchema),
);
export type InvestigatorV1 = z.infer<typeof InvestigatorV1Schema>;

const CiTriageSuccessSchema = z
  .object({
    class: z.enum(["platform", "missing_secret", "flaky", "regression", "infrastructure"]),
    evidence_lines: z.array(TextSchema).min(1),
    suggested_owner: TextSchema,
  })
  .strict();

export const CiTriageV1Schema = withHonestExit(CiTriageSuccessSchema);
export type CiTriageV1 = z.infer<typeof CiTriageV1Schema>;
