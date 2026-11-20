import type {
  AskOwnerKind,
  AskOwnerSchemaPayload,
  ReviewerFindingKind,
  SchemaChange,
  TasteFindingKind,
  TasteSeverity,
} from "./types.js";

export type SchemaParse<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

const REVIEWER_KINDS = new Set<ReviewerFindingKind>([
  "special_casing",
  "weakened_logic",
  "missing_rule",
  "unsafe",
]);

const TASTE_KINDS = new Set<TasteFindingKind>([
  "spacing",
  "alignment",
  "hierarchy",
  "color",
  "consistency",
]);

const TASTE_SEVERITY = new Set<TasteSeverity>(["low", "medium", "high"]);

const ASK_KINDS = new Set<AskOwnerKind>([
  "answer",
  "brief_fix",
  "dispute_upheld",
  "dispute_rejected",
  "escalate",
]);

export interface ReviewerFindingV1 {
  readonly kind: ReviewerFindingKind;
  readonly location: string;
  readonly explanation: string;
}

export interface ReviewerSuccessV1 {
  readonly blocked?: undefined;
  readonly findings: readonly ReviewerFindingV1[];
  readonly verdict: "ok" | "concerns";
}

export interface BlockedExitV1 {
  readonly blocked: true;
  readonly reason: string;
  readonly missing_ids?: readonly string[];
}

export type ReviewerV1 = ReviewerSuccessV1 | BlockedExitV1;

export interface TasteFindingV1 {
  readonly screen: string;
  readonly region: string;
  readonly kind: TasteFindingKind;
  readonly severity: TasteSeverity;
  readonly suggestion: string;
}

export interface TasteSuccessV1 {
  readonly blocked?: undefined;
  readonly advisory: true;
  readonly findings: readonly TasteFindingV1[];
}

export type TasteReviewerV1 = TasteSuccessV1 | BlockedExitV1;

export type AskOwnerResponderV1 = AskOwnerSchemaPayload | BlockedExitV1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keysOf(value: Record<string, unknown>): string[] {
  return Object.keys(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const key of keysOf(value)) {
    if (!allowed.includes(key)) return `unexpected field ${key}`;
  }
  return null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseBlocked(value: Record<string, unknown>): SchemaParse<BlockedExitV1> {
  const extra = exactKeys(value, ["blocked", "reason", "missing_ids"]);
  if (extra) return { ok: false, reason: extra };
  if (value.blocked !== true) return { ok: false, reason: "blocked exit must set blocked true" };
  if (!nonEmptyString(value.reason)) return { ok: false, reason: "blocked exit needs a reason" };
  let missing: readonly string[] | undefined;
  if ("missing_ids" in value) {
    if (!Array.isArray(value.missing_ids) || value.missing_ids.some((item) => !nonEmptyString(item))) {
      return { ok: false, reason: "missing_ids must be non-empty strings" };
    }
    missing = value.missing_ids;
  }
  if (missing) {
    return { ok: true, value: { blocked: true, reason: value.reason.trim(), missing_ids: missing } };
  }
  return { ok: true, value: { blocked: true, reason: value.reason.trim() } };
}

function asObject(value: unknown): SchemaParse<Record<string, unknown>> {
  if (!isRecord(value)) return { ok: false, reason: "output must be an object" };
  return { ok: true, value };
}

export function parseReviewerV1(value: unknown): SchemaParse<ReviewerV1> {
  const object = asObject(value);
  if (!object.ok) return object;
  if (object.value.blocked === true) return parseBlocked(object.value);
  const extra = exactKeys(object.value, ["findings", "verdict"]);
  if (extra) return { ok: false, reason: extra };
  if (object.value.verdict !== "ok" && object.value.verdict !== "concerns") {
    return { ok: false, reason: "verdict must be ok or concerns" };
  }
  if (!Array.isArray(object.value.findings)) return { ok: false, reason: "findings must be an array" };
  const findings: ReviewerFindingV1[] = [];
  for (const raw of object.value.findings) {
    if (!isRecord(raw)) return { ok: false, reason: "finding must be an object" };
    const findingExtra = exactKeys(raw, ["kind", "location", "explanation"]);
    if (findingExtra) return { ok: false, reason: findingExtra };
    if (typeof raw.kind !== "string" || !REVIEWER_KINDS.has(raw.kind as ReviewerFindingKind)) {
      return { ok: false, reason: "finding kind is not a reviewer kind" };
    }
    if (!nonEmptyString(raw.location) || !nonEmptyString(raw.explanation)) {
      return { ok: false, reason: "finding needs a location and an explanation" };
    }
    findings.push({
      kind: raw.kind as ReviewerFindingKind,
      location: raw.location.trim(),
      explanation: raw.explanation.trim(),
    });
  }
  if (object.value.verdict === "ok" && findings.length > 0) {
    return { ok: false, reason: "verdict ok requires an empty findings list" };
  }
  if (object.value.verdict === "concerns" && findings.length === 0) {
    return { ok: false, reason: "verdict concerns requires at least one finding" };
  }
  return { ok: true, value: { findings, verdict: object.value.verdict } };
}

export function parseTasteReviewerV1(value: unknown): SchemaParse<TasteReviewerV1> {
  const object = asObject(value);
  if (!object.ok) return object;
  if (object.value.blocked === true) return parseBlocked(object.value);
  const extra = exactKeys(object.value, ["advisory", "findings"]);
  if (extra) return { ok: false, reason: extra };
  if (object.value.advisory !== true) return { ok: false, reason: "taste review must set advisory true" };
  if (!Array.isArray(object.value.findings)) return { ok: false, reason: "findings must be an array" };
  const findings: TasteFindingV1[] = [];
  for (const raw of object.value.findings) {
    if (!isRecord(raw)) return { ok: false, reason: "finding must be an object" };
    const findingExtra = exactKeys(raw, ["screen", "region", "kind", "severity", "suggestion"]);
    if (findingExtra) return { ok: false, reason: findingExtra };
    if (!nonEmptyString(raw.screen) || !nonEmptyString(raw.region) || !nonEmptyString(raw.suggestion)) {
      return { ok: false, reason: "taste finding needs screen, region, and suggestion" };
    }
    if (typeof raw.kind !== "string" || !TASTE_KINDS.has(raw.kind as TasteFindingKind)) {
      return { ok: false, reason: "taste finding kind is closed" };
    }
    if (typeof raw.severity !== "string" || !TASTE_SEVERITY.has(raw.severity as TasteSeverity)) {
      return { ok: false, reason: "taste severity is closed" };
    }
    findings.push({
      screen: raw.screen.trim(),
      region: raw.region.trim(),
      kind: raw.kind as TasteFindingKind,
      severity: raw.severity as TasteSeverity,
      suggestion: raw.suggestion.trim(),
    });
  }
  return { ok: true, value: { advisory: true, findings } };
}

function parseChanges(value: unknown): SchemaParse<readonly SchemaChange[]> {
  if (!Array.isArray(value)) return { ok: false, reason: "changes must be an array" };
  const changes: SchemaChange[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) return { ok: false, reason: "change must be an object" };
    const extra = exactKeys(raw, ["target_id", "text"]);
    if (extra) return { ok: false, reason: extra };
    if (!nonEmptyString(raw.target_id) || !nonEmptyString(raw.text)) {
      return { ok: false, reason: "change needs target_id and text" };
    }
    changes.push({ target_id: raw.target_id.trim(), text: raw.text.trim() });
  }
  return { ok: true, value: changes };
}

export function parseAskOwnerResponderV1(value: unknown): SchemaParse<AskOwnerResponderV1> {
  const object = asObject(value);
  if (!object.ok) return object;
  if (object.value.blocked === true) return parseBlocked(object.value);
  const extra = exactKeys(object.value, ["kind", "text", "changes"]);
  if (extra) return { ok: false, reason: extra };
  if (typeof object.value.kind !== "string" || !ASK_KINDS.has(object.value.kind as AskOwnerKind)) {
    return { ok: false, reason: "ask-owner kind is closed" };
  }
  if (!nonEmptyString(object.value.text)) return { ok: false, reason: "ask-owner text is required" };
  const changes = parseChanges(object.value.changes);
  if (!changes.ok) return changes;
  const kind = object.value.kind as AskOwnerKind;
  const needsChange = kind === "brief_fix" || kind === "dispute_upheld";
  const forbidsChange = kind === "dispute_rejected" || kind === "escalate";
  if (needsChange && changes.value.length === 0) {
    return { ok: false, reason: "this kind needs at least one change" };
  }
  if (forbidsChange && changes.value.length > 0) {
    return { ok: false, reason: "this kind does not carry changes" };
  }
  return {
    ok: true,
    value: { kind, text: object.value.text.trim(), changes: changes.value },
  };
}

export function isBlockedExit(value: ReviewerV1 | TasteReviewerV1 | AskOwnerResponderV1): value is BlockedExitV1 {
  return "blocked" in value && value.blocked === true;
}
