import { z } from "zod";
import { withHonestExit } from "../blocked.js";
import {
  HttpUrlSchema,
  IdSchema,
  IsoDateSchema,
  NonNegativeIntSchema,
  ResearchQuoteSchema,
  ScopePredicateSchema,
  ScreenSpecSchema,
  TextSchema,
  TouchesTagSchema,
  addIssue,
} from "../common.js";

const ResearchClaimSchema = z
  .object({
    id: IdSchema,
    text: TextSchema,
    source: z
      .object({
        url: HttpUrlSchema,
        fetched: IsoDateSchema,
        quote: ResearchQuoteSchema,
      })
      .strict(),
    confidence: z.enum(["low", "medium", "high"]),
  })
  .strict();

const ResearchNoteSchema = z
  .object({
    id: IdSchema,
    text: TextSchema,
  })
  .strict();

const FeatureResearcherSuccessSchema = z
  .object({
    id: IdSchema,
    topic: TextSchema,
    claims: z.array(ResearchClaimSchema),
    constraints: z.array(ResearchNoteSchema),
    edge_cases: z.array(ResearchNoteSchema),
    failure_modes: z.array(ResearchNoteSchema),
    open_contradictions: z.array(ResearchNoteSchema),
  })
  .strict();

export const FeatureResearcherV1Schema = withHonestExit(FeatureResearcherSuccessSchema);
export type FeatureResearcherV1 = z.infer<typeof FeatureResearcherV1Schema>;

const SystemArchitectSuccessSchema = z
  .object({
    components: z.array(
      z
        .object({
          id: IdSchema,
          name: TextSchema,
          boundary: TextSchema,
        })
        .strict(),
    ),
    entities: z.array(
      z
        .object({
          id: IdSchema,
          fields: z.array(
            z
              .object({
                name: IdSchema,
                type: TextSchema,
              })
              .strict(),
          ),
          relations: z.array(
            z
              .object({
                target: IdSchema,
                kind: TextSchema,
              })
              .strict(),
          ),
          owner: IdSchema,
        })
        .strict(),
    ),
    contracts: z.array(
      z
        .object({
          id: IdSchema,
          producer: IdSchema,
          consumers: z.array(IdSchema).min(1),
          schema: TextSchema,
        })
        .strict(),
    ),
    rules: z.array(
      z
        .object({
          id: IdSchema,
          text: TextSchema,
          scope_predicate: ScopePredicateSchema,
          check_kind: TextSchema,
        })
        .strict(),
    ),
    conventions: z.array(TextSchema),
    env_manifest: z.array(
      z
        .object({
          name: IdSchema,
          required: z.boolean(),
          description: TextSchema,
        })
        .strict(),
    ),
    risks: z.array(ResearchNoteSchema),
  })
  .strict();

export const SystemArchitectV1Schema = withHonestExit(SystemArchitectSuccessSchema);
export type SystemArchitectV1 = z.infer<typeof SystemArchitectV1Schema>;

const StateMachineSchema = z
  .object({
    id: IdSchema,
    states: z.array(IdSchema).min(1),
    initial: IdSchema,
    transitions: z.array(
      z
        .object({
          from: IdSchema,
          to: IdSchema,
          event: TextSchema,
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((machine, ctx) => {
    if (!machine.states.includes(machine.initial)) {
      addIssue(ctx, ["initial"], "initial state must be one of states");
    }
    machine.transitions.forEach((transition, index) => {
      if (!machine.states.includes(transition.from)) {
        addIssue(ctx, ["transitions", index, "from"], "transition leaves an unknown state");
      }
      if (!machine.states.includes(transition.to)) {
        addIssue(ctx, ["transitions", index, "to"], "transition enters an unknown state");
      }
    });
  });

const HoistedRuleSchema = z
  .object({
    id: IdSchema,
    text: TextSchema,
    classification: z.enum(["local", "cross_cutting"]),
    reason: z.string().trim().min(1).nullable(),
    scope_predicate: ScopePredicateSchema.nullable(),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.classification === "local") {
      if (rule.reason === null) {
        addIssue(ctx, ["reason"], "a local rule needs a reason");
      }
      if (rule.scope_predicate !== null) {
        addIssue(ctx, ["scope_predicate"], "a local rule does not take a cross-cutting scope");
      }
    }
    if (rule.classification === "cross_cutting") {
      if (rule.scope_predicate === null) {
        addIssue(ctx, ["scope_predicate"], "a cross-cutting rule needs a scope predicate");
      }
      if (rule.reason !== null) {
        addIssue(ctx, ["reason"], "a cross-cutting rule is hoisted without a local reason");
      }
    }
  });

const FeatureArchitectSuccessSchema = z
  .object({
    flows: z.array(
      z
        .object({
          id: IdSchema,
          steps: z.array(TextSchema).min(1),
        })
        .strict(),
    ),
    screens: z.array(ScreenSpecSchema),
    state_machines: z.array(StateMachineSchema),
    internal_contracts: z.array(
      z
        .object({
          id: IdSchema,
          producer: IdSchema,
          consumers: z.array(IdSchema).min(1),
        })
        .strict(),
    ),
    handling: z.array(
      z
        .object({
          spec_item_or_edge_case: IdSchema,
          node_id: IdSchema,
        })
        .strict(),
    ),
    hoisted_rules: z.array(HoistedRuleSchema),
  })
  .strict();

export const FeatureArchitectV1Schema = withHonestExit(FeatureArchitectSuccessSchema);
export type FeatureArchitectV1 = z.infer<typeof FeatureArchitectV1Schema>;

const MasterPlannerSuccessSchema = z
  .object({
    phase0: z.array(
      z
        .object({
          id: IdSchema,
          commands: z.array(TextSchema).min(1),
          files: z.array(TextSchema),
          versions: z.array(TextSchema),
          expected_outputs: z.array(TextSchema).min(1),
        })
        .strict(),
    ),
    waves: z.array(
      z
        .object({
          features: z.array(IdSchema).min(1),
          depends_on: z.array(IdSchema),
        })
        .strict(),
    ),
    estimates: z.array(
      z
        .object({
          id: IdSchema,
          low: NonNegativeIntSchema,
          high: NonNegativeIntSchema,
          unit: z.enum(["hours", "usd_micro"]),
        })
        .strict()
        .superRefine((estimate, ctx) => {
          if (estimate.high < estimate.low) {
            addIssue(ctx, ["high"], "high must be greater than or equal to low");
          }
        }),
    ),
    paperwork_projection: z
      .object({
        ppm: z.number().int().nonnegative().max(1_000_000),
        note: TextSchema,
      })
      .strict(),
  })
  .strict();

export const MasterPlannerV1Schema = withHonestExit(MasterPlannerSuccessSchema);
export type MasterPlannerV1 = z.infer<typeof MasterPlannerV1Schema>;

const FeatureCheckSchema = z
  .object({
    id: IdSchema,
    kind: TextSchema,
    requirement_ids: z.array(IdSchema).min(1),
    visibility: z.enum(["visible", "held_back"]),
    example: TextSchema,
  })
  .strict();

const FeaturePlannerSuccessSchema = z
  .object({
    tasks: z.array(
      z
        .object({
          id: IdSchema,
          goal: TextSchema,
          write_scope: z.array(TextSchema).min(1),
          touches: z.array(TouchesTagSchema),
          requirements: z.array(IdSchema).min(1),
          depends_on: z.array(IdSchema),
          level: z.enum(["Junior", "Mid", "Senior", "Manager"]),
          checks: z.array(FeatureCheckSchema).min(1),
        })
        .strict(),
    ),
    wiring_tasks: z.array(
      z
        .object({
          id: IdSchema,
          goal: TextSchema,
          write_scope: z.array(TextSchema).min(1),
        })
        .strict(),
    ),
    journey_check: z
      .object({
        id: IdSchema,
        example: TextSchema,
      })
      .strict(),
  })
  .strict();

export const FeaturePlannerV1Schema = withHonestExit(FeaturePlannerSuccessSchema);
export type FeaturePlannerV1 = z.infer<typeof FeaturePlannerV1Schema>;

const OracleAuthorSuccessSchema = z
  .object({
    held_back: z.array(
      z
        .object({
          check_id: IdSchema,
          requirement_ids: z.array(IdSchema).min(1),
          input: TextSchema,
          expected: TextSchema,
          rule_id: IdSchema,
        })
        .strict(),
    ),
    rubrics: z.array(
      z
        .object({
          check_id: IdSchema,
          criteria: z.array(TextSchema).min(1),
          threshold: z.number().min(0).max(1),
        })
        .strict(),
    ),
  })
  .strict();

export const OracleAuthorV1Schema = withHonestExit(OracleAuthorSuccessSchema);
export type OracleAuthorV1 = z.infer<typeof OracleAuthorV1Schema>;
