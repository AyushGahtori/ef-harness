import { z } from "zod";
import {
  ARRAY_MAX_ITEMS,
  digestSchema,
  idSchema,
  nonNegativeIntSchema,
  positiveIntSchema,
  withinJsonByteLimit,
} from "./bounds.js";

export const SANDBOX_TIERS = ["A", "B", "C", "D", "E"] as const;
export const CHECK_STATUSES = ["pass", "fail", "skip", "missing", "error"] as const;

export const STATIC_AUDIT_RULES = [
  "unfinished_markers",
  "stub_bodies",
  "swallowed_errors",
  "dead_controls",
  "hard_coded_data",
  "test_tampering",
  "type_escapes",
  "unreachable_code",
  "unused_planned_fields",
  "unregistered_names",
  "missing_assets",
  "missing_contract_surface",
  "truncated_files",
  "out_of_scope_edits",
  "secret_in_diff",
  "diff_smaller_than_estimate",
  "complexity_below_rules",
  "special_casing",
] as const;

export const SandboxMetadataSchema = z
  .object({
    tier: z.enum(SANDBOX_TIERS).nullable(),
    unsandboxed: z.boolean(),
  })
  .strict()
  .refine((sandbox) => (sandbox.unsandboxed ? sandbox.tier === null : sandbox.tier !== null), {
    message: "unsandboxed receipts use a null tier; sandboxed receipts name tier A-E",
  });

export const CheckOutcomeSchema = z
  .object({
    check_id: idSchema,
    check_version: positiveIntSchema,
    artifact_digest: digestSchema,
    status: z.enum(CHECK_STATUSES),
    collected_count: nonNegativeIntSchema,
  })
  .strict()
  .refine((check) => !(check.status === "pass" && check.collected_count === 0), {
    message: "a passing check must collect at least one case (missing or zero collected tests never pass)",
    path: ["collected_count"],
  });

export const CheckCountsSchema = z
  .object({
    pass: nonNegativeIntSchema,
    fail: nonNegativeIntSchema,
    skip: nonNegativeIntSchema,
    missing: nonNegativeIntSchema,
    error: nonNegativeIntSchema,
  })
  .strict();

export const StaticFindingSchema = z
  .object({
    rule_id: z.enum(STATIC_AUDIT_RULES),
    file: z.string().min(1).max(4_096),
    line: positiveIntSchema.optional(),
    column: positiveIntSchema.optional(),
    snippet: z.string().max(2_000).optional(),
    message: z.string().min(1).max(4_096),
    remediation: z.string().max(4_096).optional(),
  })
  .strict();

export const StaticAuditReportSchema = withinJsonByteLimit(
  z
    .object({
      schema: z.literal("static-audit@1"),
      artifact_digest: digestSchema,
      coverage_mode: z.enum(["full", "reduced_text_only"]),
      hard: z.array(StaticFindingSchema).max(ARRAY_MAX_ITEMS),
      soft: z.array(StaticFindingSchema).max(ARRAY_MAX_ITEMS),
      sandbox: SandboxMetadataSchema,
    })
    .strict(),
);

export const VerificationReceiptSchema = withinJsonByteLimit(
  z
    .object({
      schema: z.literal("verification-receipt@1"),
      id: idSchema,
      task: idSchema,
      attempt: idSchema,
      artifact_digest: digestSchema,
      checks: z.array(CheckOutcomeSchema).max(ARRAY_MAX_ITEMS),
      counts: CheckCountsSchema,
      sandbox: SandboxMetadataSchema,
      static_audit: StaticAuditReportSchema.optional(),
    })
    .strict()
    .superRefine((receipt, ctx) => {
      const tally = { pass: 0, fail: 0, skip: 0, missing: 0, error: 0 };
      for (const check of receipt.checks) {
        tally[check.status] += 1;
      }
      for (const status of CHECK_STATUSES) {
        if (tally[status] !== receipt.counts[status]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["counts", status],
            message: `counts.${status} must equal the number of ${status} checks`,
          });
        }
      }
      if (receipt.static_audit && receipt.static_audit.artifact_digest !== receipt.artifact_digest) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["static_audit", "artifact_digest"],
          message: "static audit artifact_digest must match the receipt",
        });
      }
    }),
);

export type SandboxMetadata = z.infer<typeof SandboxMetadataSchema>;
export type CheckOutcome = z.infer<typeof CheckOutcomeSchema>;
export type StaticFinding = z.infer<typeof StaticFindingSchema>;
export type StaticAuditReport = z.infer<typeof StaticAuditReportSchema>;
export type VerificationReceipt = z.infer<typeof VerificationReceiptSchema>;
