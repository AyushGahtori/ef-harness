/** Durable ship session lifecycle (crash-resumable). */
export const SHIP_RUN_PHASES = [
  "PREFLIGHT",
  "PUSH_APPROVAL",
  "PUSHING",
  "PR_OPEN",
  "CI_WATCHING",
  "CI_TRIAGING",
  "CI_FIXING",
  "CI_GREEN",
  "CI_ESCALATED",
  "DEPLOYING",
  "SHIPPED",
] as const;

export type ShipRunPhase = (typeof SHIP_RUN_PHASES)[number];

export type ShipRunDbStatus = "pending" | "running" | "passed" | "failed" | "cancelled" | "rolled_back";

export const CI_OPERATIONAL_CLASSES = [
  "class_1_regression",
  "class_2_portability",
  "class_3_transient",
  "class_4_missing_secret",
  "class_5_preexisting_main",
] as const;

export type CiOperationalClass = (typeof CI_OPERATIONAL_CLASSES)[number];

/** ci-triage@1 contract classes (Task 009). */
export type CiTriageV1Class = "platform" | "missing_secret" | "flaky" | "regression" | "infrastructure";

export type CiTriageV1Result = {
  readonly class: CiTriageV1Class;
  readonly evidence_lines: readonly string[];
  readonly suggested_owner: string;
};

export type ShipRunRecord = {
  readonly id: string;
  readonly kind: "pr" | "ci" | "deploy" | "migration";
  readonly feature: string | null;
  readonly effect: string | null;
  readonly repo: string | null;
  readonly prNumber: number | null;
  readonly headSha: string | null;
  readonly runId: string | null;
  readonly environment: string | null;
  readonly status: ShipRunDbStatus;
  readonly failureFingerprint: string | null;
  readonly repairGeneration: number;
  readonly url: string | null;
  readonly phase: ShipRunPhase;
  readonly updatedAt: number;
  /** push attempts keyed by fingerprint -> count */
  readonly repairPushesByFingerprint: Readonly<Record<string, number>>;
  readonly totalRepairPushes: number;
};

export type VerificationReceiptRow = {
  readonly gate: string;
  readonly result: "pass" | "fail" | "skip" | "waived";
  readonly detail?: string;
};

export type GraphPrNodeRef = {
  readonly nid: number;
  readonly kind: string;
  readonly title: string;
};

export type GraphGeneratedPrInput = {
  readonly featureTitle: string;
  readonly requirementRefs: readonly GraphPrNodeRef[];
  readonly landingSummaryParagraph: string;
  readonly verificationReceipts: readonly VerificationReceiptRow[];
  readonly migrationNotes: readonly string[];
  readonly envVarNames: readonly string[];
  readonly humanFixedNotes: readonly string[];
  readonly delegatedDecisions: readonly string[];
  readonly deferredNotes: readonly string[];
  readonly effectId: string;
};

export type GeneratedPullRequestDraft = {
  readonly title: string;
  readonly bodyMarkdown: string;
};

export type PrePushSafetyInput = {
  readonly baseRef: string;
  readonly headRef?: string;
  readonly trackedFiles: readonly string[];
  readonly localChecksPassed: boolean;
};

export type PrePushSafetyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly blockedEffect: "git_push" };

export type RedactedCiLog = {
  readonly lines: readonly string[];
  readonly truncated: boolean;
};

export type CiFailureInput = {
  readonly jobName: string;
  readonly logExcerpt: readonly string[];
  readonly commitSha: string;
  readonly baseBranch: string;
  readonly baseBranchFailedChecks?: readonly string[];
  readonly localVerificationPassed: boolean;
};

export type CiClassification = {
  readonly operationalClass: CiOperationalClass;
  readonly triage: CiTriageV1Result;
  readonly allowsAutomatedCodeRepair: boolean;
  readonly allowsBoundedRerun: boolean;
  readonly userFacingSummary: string;
};

export type RepairLoopDecision =
  | { readonly kind: "push_repair"; readonly fingerprint: string; readonly pushNumber: number }
  | { readonly kind: "rerun_failed_jobs"; readonly fingerprint: string }
  | { readonly kind: "escalate_human"; readonly reason: string; readonly fingerprint?: string }
  | { readonly kind: "surface_secret_card"; readonly secretName: string }
  | { readonly kind: "report_preexisting"; readonly baseCheckUrl?: string }
  | { readonly kind: "celebrate_green"; readonly message: string };

export type CaseRepairAction =
  | { readonly kind: "rewrite_import"; readonly file: string; readonly before: string; readonly after: string }
  | { readonly kind: "two_step_git_mv"; readonly from: string; readonly to: string; readonly commands: readonly [string, string] }
  | { readonly kind: "normalize_crlf"; readonly file: string }
  | { readonly kind: "chmod_executable"; readonly file: string };