import type { SearchResultItem } from "./search-hash.js";

export const TASK_ACCEPTED_CONSUMERS = [
  "scheduler",
  "integrator",
  "exporter",
  "ui_projection",
] as const;

export type TaskAcceptedConsumer = (typeof TASK_ACCEPTED_CONSUMERS)[number];

export const BLOCKING_HOLD_REASONS = [
  "requirement_change",
  "budget",
  "ccr",
  "governor",
] as const;

export const PAUSE_HOLD_REASON = "user_pause";

export const SEARCH_READ_LIMIT = 50;

export const MAX_REVISION_RETRIES = 5;

export type AcceptanceReasonCode =
  | "accepted"
  | "already_accepted"
  | "stale_epoch"
  | "attempt_mismatch"
  | "wrong_state"
  | "submission_not_pending"
  | "missing_attempt"
  | "missing_task"
  | "missing_candidate"
  | "blocking_hold"
  | "user_pause"
  | "unmet_checks"
  | "stale_check_version"
  | "artifact_digest_mismatch"
  | "stale_node_reads"
  | "stale_edge_reads"
  | "stale_search_reads"
  | "search_reads_over_limit"
  | "diff_detected_rule"
  | "revision_advancing"
  | "finish_submission_lost"
  | "attempt_not_open"
  | "ref_cas_failed";

export type AcceptanceRoute =
  | "accepted"
  | "reverify"
  | "paused"
  | "repair_checks"
  | "blocked"
  | "rejected";

export interface AcceptanceReasonDetail {
  readonly code: AcceptanceReasonCode;
  readonly message: string;
}

export interface StaleNodeRead {
  readonly node: string;
  readonly readVersion: number;
  readonly currentVersion: number;
  readonly how: "pushed" | "pulled" | "unknown";
  readonly detail: string;
}

export interface StaleEdgeRead {
  readonly node: string;
  readonly dir: string;
  readonly type: string;
  readonly readVersion: number;
  readonly currentVersion: number;
  readonly detail: string;
}

export interface SearchDivergence {
  readonly queryHash: string;
  readonly recordedResultHash: string;
  readonly currentResultHash: string;
  readonly recordedWasEmpty: boolean;
  readonly currentItems: readonly SearchResultItem[];
  readonly appeared: readonly SearchResultItem[];
}

export interface UnmetCheck {
  readonly checkId: string;
  readonly status: string;
  readonly checkVersion: number | null;
  readonly currentVersion: number | null;
  readonly detail: string;
}

export interface QueuedRuleCheck {
  readonly task: string;
  readonly attempt: string;
  readonly ruleId: string;
  readonly checkIds: readonly string[];
  readonly reason: "diff_detected_rule";
}

export interface HoldView {
  readonly reason: string;
  readonly source: string;
  readonly blocking: boolean;
}

export interface MergeExportChange {
  readonly symbol: string;
  readonly kind: string;
}

export interface MergeDiffstat {
  readonly files: number;
  readonly insertions: number;
  readonly deletions: number;
}

export interface MergeContractVerified {
  readonly id: string;
  readonly v: number;
}

export interface MergeInstructionsV1 {
  readonly schema: "merge-instructions@1";
  readonly task: string;
  readonly commit: string;
  readonly diffstat: MergeDiffstat;
  readonly exports_changed: readonly MergeExportChange[];
  readonly dependency_intents: readonly unknown[];
  readonly migration_intents: readonly unknown[];
  readonly wiring_needs: readonly unknown[];
  readonly contracts_verified: readonly MergeContractVerified[];
  readonly receipt: string;
}

export interface AcceptanceDecision {
  readonly accepted: boolean;
  readonly task: string;
  readonly attempt: string;
  readonly epoch: number;
  readonly reason: AcceptanceReasonCode;
  readonly reasons: readonly AcceptanceReasonDetail[];
  readonly route: AcceptanceRoute;
  readonly staleNodes: readonly StaleNodeRead[];
  readonly staleEdges: readonly StaleEdgeRead[];
  readonly searchDivergences: readonly SearchDivergence[];
  readonly unmetChecks: readonly UnmetCheck[];
  readonly queuedRules: readonly QueuedRuleCheck[];
  readonly unexpectedTouches: readonly string[];
  readonly holds: readonly HoldView[];
  readonly mergeInstructions: MergeInstructionsV1 | null;
  readonly evidencePromoted: readonly string[];
  readonly preservedCommit: string | null;
  readonly downstreamUnlocked: boolean;
  readonly attemptState: string | null;
  readonly taskState: string | null;
  readonly submissionPending: number | null;
  readonly writeLockMs: number;
  readonly searchMs: number;
  readonly searchRevalidations: number;
}

export interface FinalizeCandidateAcceptanceInput {
  readonly task: string;
  readonly attempt: string;
  readonly epoch: number;
  readonly artifactDigest: string;
  readonly rev?: number;
  readonly now?: number;
  readonly receipt?: string;
}

export type RevalidationChangeClass = "compatible" | "clarifying" | "base_sync";

export interface RevalidatePriorEvidenceInput {
  readonly task: string;
  readonly attempt: string;
  readonly commitSha: string;
  readonly changeClass: RevalidationChangeClass | "breaking" | "cosmetic" | "retired" | "created";
  readonly rev?: number;
  readonly now?: number;
  readonly checkIds?: readonly string[];
}

export interface StampedCheckReceipt {
  readonly checkId: string;
  readonly checkVersion: number;
  readonly status: string;
  readonly artifactDigest: string;
  readonly receipt: string | null;
}

export interface RevalidationDecision {
  readonly revalidated: boolean;
  readonly codePreserved: boolean;
  readonly reworkSuggested: boolean;
  readonly task: string;
  readonly attempt: string;
  readonly commitSha: string;
  readonly reason: string;
  readonly attemptState: string | null;
  readonly taskState: string | null;
  readonly stamped: readonly StampedCheckReceipt[];
  readonly failures: readonly StampedCheckReceipt[];
}

export function routeFor(code: AcceptanceReasonCode): AcceptanceRoute {
  switch (code) {
    case "accepted":
    case "already_accepted":
      return "accepted";
    case "stale_node_reads":
    case "stale_edge_reads":
    case "stale_search_reads":
      return "reverify";
    case "user_pause":
      return "paused";
    case "unmet_checks":
    case "stale_check_version":
    case "artifact_digest_mismatch":
    case "diff_detected_rule":
      return "repair_checks";
    case "blocking_hold":
    case "search_reads_over_limit":
    case "revision_advancing":
    case "ref_cas_failed":
      return "blocked";
    default:
      return "rejected";
  }
}

const PRIMARY_ORDER: readonly AcceptanceReasonCode[] = [
  "missing_task",
  "missing_attempt",
  "stale_epoch",
  "attempt_mismatch",
  "wrong_state",
  "submission_not_pending",
  "missing_candidate",
  "blocking_hold",
  "revision_advancing",
  "search_reads_over_limit",
  "stale_node_reads",
  "stale_edge_reads",
  "stale_search_reads",
  "diff_detected_rule",
  "stale_check_version",
  "artifact_digest_mismatch",
  "unmet_checks",
  "user_pause",
  "finish_submission_lost",
  "attempt_not_open",
  "ref_cas_failed",
  "already_accepted",
  "accepted",
];

export function primaryReason(codes: readonly AcceptanceReasonCode[]): AcceptanceReasonCode {
  if (codes.length === 0) return "accepted";
  let best = codes[0] ?? "accepted";
  let bestIndex = PRIMARY_ORDER.indexOf(best);
  if (bestIndex < 0) bestIndex = PRIMARY_ORDER.length;
  for (const code of codes.slice(1)) {
    let index = PRIMARY_ORDER.indexOf(code);
    if (index < 0) index = PRIMARY_ORDER.length;
    if (index < bestIndex) {
      best = code;
      bestIndex = index;
    }
  }
  return best;
}
