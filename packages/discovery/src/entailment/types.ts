/** Decision vocabulary from database-design basis/status, plus pending verification. */
export const DECISION_STATUSES = [
  "open",
  "partial",
  "missing",
  "conflict",
  "asked",
  "deferred",
  "not_applicable",
  "settled",
  "pending_verification",
] as const;

export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const SETTLED_BASES = [
  "explicit",
  "derived",
  "delegated",
  "defaulted",
  "proposed",
  "observed",
] as const;

export type SettledBasis = (typeof SETTLED_BASES)[number];

/** Roots a derivation may terminate in. Defaulted and proposed never ground a chain. */
export const GROUNDED_ROOT_BASES = ["explicit", "delegated", "observed"] as const;

export type GroundedRootBasis = (typeof GROUNDED_ROOT_BASES)[number];

export const REVERSIBILITIES = ["easy", "moderate", "hard"] as const;

export type Reversibility = (typeof REVERSIBILITIES)[number];

export const VALUE_KINDS = ["time", "amount", "count", "behavioral_name", "other"] as const;

export type ValueKind = (typeof VALUE_KINDS)[number];

export const ENTAILMENT_VERDICTS = ["establishes", "contradicts", "leaves_open"] as const;

export type EntailmentVerdict = (typeof ENTAILMENT_VERDICTS)[number];

export type MetricVerdict = EntailmentVerdict | "unavailable";

export const NODE_LIFECYCLES = ["draft", "active", "retired", "superseded"] as const;

export type NodeLifecycle = (typeof NODE_LIFECYCLES)[number];

export type JsonValue =
  | null
  | string
  | number
  | boolean
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface ModelIdentity {
  readonly family: string;
  readonly modelId: string;
}

export interface CitedExcerpt {
  readonly turnId: string;
  readonly author: "developer" | "harness";
  /** `explicit_value` is independent user support. `cited_for_derivation` only feeds a rule. */
  readonly support: "explicit_value" | "cited_for_derivation";
  readonly quote: string;
  readonly surroundingParagraph: string;
  readonly start: number;
  readonly end: number;
  readonly retracted: boolean;
  readonly superseded: boolean;
  readonly lowConfidence: boolean;
  readonly valueKind: ValueKind;
}

export interface DecisionFields {
  readonly criterion: string;
  readonly status: DecisionStatus;
  readonly value: JsonValue;
  readonly basis: SettledBasis | null;
  readonly rule: string | null;
  readonly premises: readonly string[];
  readonly evidence: readonly CitedExcerpt[];
  readonly retracted: boolean;
  readonly feature: string | null;
  readonly costly: boolean;
  readonly reversibility: Reversibility;
  readonly mustAsk: boolean;
  readonly criterionKind: string;
  readonly release: "current" | "later";
  readonly changeSummary: string | null;
  readonly entailmentVerdict: MetricVerdict | null;
  readonly entailmentReason: string | null;
}

export interface TurnSnapshot {
  readonly id: string;
  readonly author: "developer" | "harness";
  readonly text: string;
}

export interface EntailmentClaim {
  readonly decisionId: string;
  readonly criterion: string;
  readonly criterionKind: string;
  readonly basis: "derived" | "explicit";
  readonly proposedValue: JsonValue;
  readonly excerpts: readonly CitedExcerpt[];
  readonly rule: string | null;
  readonly premises: readonly string[];
  readonly costly: boolean;
  readonly reversibility: Reversibility;
  readonly mustAsk: boolean;
  readonly feature: string | null;
  readonly resolverModel: ModelIdentity;
}

export interface EntailmentClaimResult {
  readonly decisionId: string;
  readonly criterion: string;
  readonly outcome: "settled" | "pending_verification" | "conflict" | "open" | "rejected";
  readonly basis: SettledBasis | null;
  readonly verdict: MetricVerdict | null;
  readonly reason: string;
  readonly credit: boolean;
  readonly modelInvoked: boolean;
  readonly changeSummary: string | null;
  readonly errorName: string | null;
}

export interface DerivationProposal {
  readonly decisionId: string;
  readonly criterion: string;
  readonly rule: string;
  readonly premises: readonly string[];
  readonly costly: boolean;
  readonly reversibility: Reversibility;
  readonly mustAsk: boolean;
  readonly evidence: readonly CitedExcerpt[];
}

export function isDecisionStatus(value: unknown): value is DecisionStatus {
  return typeof value === "string" && (DECISION_STATUSES as readonly string[]).includes(value);
}

export function isSettledBasis(value: unknown): value is SettledBasis {
  return typeof value === "string" && (SETTLED_BASES as readonly string[]).includes(value);
}

export function isGroundedRootBasis(value: SettledBasis): value is GroundedRootBasis {
  return (GROUNDED_ROOT_BASES as readonly string[]).includes(value);
}

export function isReversibility(value: unknown): value is Reversibility {
  return typeof value === "string" && (REVERSIBILITIES as readonly string[]).includes(value);
}

export function earnsReadinessCredit(fields: DecisionFields): boolean {
  return fields.status === "settled" && fields.basis !== null && !fields.retracted;
}

export function needsEntailmentCheck(claim: Pick<EntailmentClaim, "basis" | "costly" | "reversibility">): boolean {
  return claim.basis === "derived" || claim.costly || claim.reversibility === "hard";
}

export function isCostlyDerivation(claim: Pick<EntailmentClaim, "basis" | "costly" | "reversibility" | "mustAsk">): boolean {
  return claim.basis === "derived" && (claim.costly || claim.reversibility === "hard" || claim.mustAsk);
}
