import { z } from "zod";
import { withHonestExit } from "../blocked.js";
import {
  DiscoverySettledBasisSchema,
  IdSchema,
  OpeningRubricIdSchema,
  TextSchema,
  TurnEvidenceSchema,
  addIssue,
} from "../common.js";

const OpeningClaimSchema = z
  .object({
    criterion: IdSchema,
    kind: z.enum(["value", "recommendation_request", "delegation"]),
    value: z.string().nullable(),
    evidence: z.array(TurnEvidenceSchema).min(1),
  })
  .strict()
  .superRefine((claim, ctx) => {
    if (claim.value !== null && claim.value.trim().length === 0) {
      addIssue(ctx, ["value"], "value must not be blank");
    }
  });

const OpeningRubricSchema = z
  .object({
    rubric: OpeningRubricIdSchema,
    covered: z.array(IdSchema),
    claims: z.array(OpeningClaimSchema),
    smallest_gap: z.string().trim().min(1).nullable(),
  })
  .strict();

const OpeningDomainSchema = z
  .object({
    pack: IdSchema,
    evidence: z.array(TurnEvidenceSchema),
    certain: z.boolean(),
  })
  .strict()
  .superRefine((domain, ctx) => {
    if (domain.certain && domain.evidence.length === 0) {
      addIssue(ctx, ["evidence"], "a certain domain needs evidence");
    }
  });

const OpeningReviewSuccessSchema = z
  .object({
    rubrics: z.array(OpeningRubricSchema),
    follow_up: z
      .object({
        rubric: OpeningRubricIdSchema,
        question: TextSchema,
      })
      .strict()
      .nullable(),
    domains: z.array(OpeningDomainSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.rubrics.length === 0 && value.follow_up === null && value.domains.length === 0) {
      addIssue(ctx, ["rubrics"], "opening review needs rubrics, a follow-up, or domains");
    }
  });

export const OpeningReviewV1Schema = withHonestExit(OpeningReviewSuccessSchema);
export type OpeningReviewV1 = z.infer<typeof OpeningReviewV1Schema>;

const DelegationSchema = z
  .object({
    scope: TextSchema,
    limits: z.array(TextSchema),
    turn: IdSchema,
  })
  .strict();

const ConflictSpanSchema = z
  .object({
    evidence: TurnEvidenceSchema,
  })
  .strict();

const BatchResolveSuccessSchema = z
  .object({
    criterion: IdSchema,
    question: IdSchema,
    status: z.enum(["settled", "partial", "missing", "conflict"]),
    basis: DiscoverySettledBasisSchema.nullable(),
    value: z.string().nullable(),
    evidence: z.array(TurnEvidenceSchema),
    rule: z.string().trim().min(1).nullable(),
    premises: z.array(IdSchema),
    delegation: DelegationSchema.nullable(),
    conflict: z.array(ConflictSpanSchema).nullable(),
    missing_detail: z.string().trim().min(1).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "settled" && value.basis === null) {
      addIssue(ctx, ["basis"], "basis is required when status is settled");
    }
    if (value.status !== "settled" && value.basis !== null) {
      addIssue(ctx, ["basis"], "basis is set only when status is settled");
    }
    if (value.status === "settled" && value.value === null) {
      addIssue(ctx, ["value"], "a settled criterion needs a value");
    }
    if (value.value !== null && value.value.trim().length === 0) {
      addIssue(ctx, ["value"], "value must not be blank");
    }
    if ((value.status === "missing" || value.status === "conflict") && value.value !== null) {
      addIssue(ctx, ["value"], "missing and conflict criteria have a null value");
    }
    if (value.basis === "delegated" && value.delegation === null) {
      addIssue(ctx, ["delegation"], "delegated basis requires delegation scope and limits");
    }
    if (value.basis !== "delegated" && value.delegation !== null) {
      addIssue(ctx, ["delegation"], "delegation is set only for basis delegated");
    }
    if (value.basis === "derived" && (value.rule === null || value.premises.length === 0)) {
      addIssue(ctx, ["rule"], "derived basis requires an allowlisted rule and premises");
    }
    if (value.basis !== "derived" && value.rule !== null) {
      addIssue(ctx, ["rule"], "rule is set only for basis derived");
    }
    if (value.basis !== "derived" && value.premises.length > 0) {
      addIssue(ctx, ["premises"], "premises are set only for basis derived");
    }
    if (
      (value.basis === "explicit" || value.basis === "derived") &&
      value.evidence.length === 0
    ) {
      addIssue(ctx, ["evidence"], "explicit and derived values cite a quote");
    }
    if (value.status === "conflict" && (value.conflict === null || value.conflict.length < 2)) {
      addIssue(ctx, ["conflict"], "conflict status requires at least two supporting spans");
    }
    if (value.status !== "conflict" && value.conflict !== null) {
      addIssue(ctx, ["conflict"], "conflict spans are set only when status is conflict");
    }
  });

export const BatchResolveV1Schema = withHonestExit(BatchResolveSuccessSchema);
export type BatchResolveV1 = z.infer<typeof BatchResolveV1Schema>;

const ClarifyOptionSchema = z
  .object({
    id: IdSchema,
    label: TextSchema,
    recommended: z.boolean(),
  })
  .strict();

const ClarifySuccessSchema = z
  .object({
    question_id: IdSchema,
    criterion: IdSchema,
    text: TextSchema,
    options: z.array(ClarifyOptionSchema),
    free_text: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.free_text && value.options.length === 0) {
      addIssue(ctx, ["options"], "a question without free text needs at least one option");
    }
  });

export const ClarifyV1Schema = withHonestExit(ClarifySuccessSchema);
export type ClarifyV1 = z.infer<typeof ClarifyV1Schema>;
