import { RouterSchemaError } from "./errors.js";
import {
  ROUTER_INTENTS,
  type BlockedExitV1,
  type RouterClauseV1,
  type RouterIntent,
  type RouterSuccessV1,
  type RouterV1,
} from "./types.js";

const INTENT_SET = new Set<string>(ROUTER_INTENTS);

export interface RouterParseOk {
  readonly ok: true;
  readonly value: RouterV1;
}

export interface RouterParseFail {
  readonly ok: false;
  readonly errors: readonly string[];
}

export type RouterParse = RouterParseOk | RouterParseFail;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknown(record: Record<string, unknown>, allowed: readonly string[], label: string, errors: string[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) errors.push(`${label} has unknown key ${key}`);
  }
}

function parseSpan(value: unknown, errors: string[], textLength: number | null): RouterClauseV1["span"] | null {
  if (!isRecord(value)) {
    errors.push("span must be an object");
    return null;
  }
  rejectUnknown(value, ["start", "end"], "span", errors);
  const start = value.start;
  const end = value.end;
  if (typeof start !== "number" || !Number.isInteger(start) || start < 0) {
    errors.push("span.start must be a non-negative integer");
  }
  if (typeof end !== "number" || !Number.isInteger(end) || end <= 0) {
    errors.push("span.end must be a positive integer");
  }
  if (typeof start === "number" && typeof end === "number" && end <= start) {
    errors.push("span.end must be greater than span.start");
  }
  if (
    textLength !== null &&
    typeof start === "number" &&
    typeof end === "number" &&
    (start > textLength || end > textLength)
  ) {
    errors.push("span is outside the message");
  }
  if (typeof start !== "number" || typeof end !== "number") return null;
  return { start, end };
}

function parseClause(value: unknown, index: number, errors: string[], textLength: number | null): RouterClauseV1 | null {
  const label = `clauses[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return null;
  }
  rejectUnknown(value, ["span", "intent", "target_id", "confidence", "needs_clarification"], label, errors);
  const span = parseSpan(value.span, errors, textLength);
  if (typeof value.intent !== "string" || !INTENT_SET.has(value.intent)) {
    errors.push(`${label}.intent is not a router@1 intent`);
  }
  if (value.target_id !== null && (typeof value.target_id !== "string" || value.target_id.trim() === "" || /\s/.test(value.target_id))) {
    errors.push(`${label}.target_id must be null or a whitespace-free id`);
  }
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) {
    errors.push(`${label}.confidence must be a number from 0 to 1`);
  }
  if (typeof value.needs_clarification !== "boolean") {
    errors.push(`${label}.needs_clarification must be a boolean`);
  }
  const intent = value.intent;
  const needsTarget = intent === "change" || intent === "correct_evidence" || intent === "remove";
  if (needsTarget && value.target_id === null && value.needs_clarification !== true) {
    errors.push(`${label} needs a target or needs_clarification`);
  }
  if (
    span === null ||
    typeof intent !== "string" ||
    !INTENT_SET.has(intent) ||
    (value.target_id !== null && typeof value.target_id !== "string") ||
    typeof value.confidence !== "number" ||
    typeof value.needs_clarification !== "boolean"
  ) {
    return null;
  }
  return {
    span,
    intent: intent as RouterIntent,
    target_id: value.target_id,
    confidence: value.confidence,
    needs_clarification: value.needs_clarification,
  };
}

function parseBlocked(value: Record<string, unknown>, errors: string[]): BlockedExitV1 | null {
  rejectUnknown(value, ["blocked", "reason", "missing_ids"], "blocked", errors);
  if (value.blocked !== true) {
    errors.push("blocked must be true");
    return null;
  }
  if (typeof value.reason !== "string" || value.reason.trim() === "") {
    errors.push("blocked.reason must be non-blank text");
    return null;
  }
  let missing: readonly string[] | undefined;
  if (value.missing_ids !== undefined) {
    if (!Array.isArray(value.missing_ids) || value.missing_ids.some((item) => typeof item !== "string" || item.trim() === "")) {
      errors.push("blocked.missing_ids must be an array of ids");
      return null;
    }
    missing = value.missing_ids;
  }
  if (missing) return { blocked: true, reason: value.reason.trim(), missing_ids: missing };
  return { blocked: true, reason: value.reason.trim() };
}

/**
 * Local port of `RouterV1Schema` (Task 009). Closed object, honest `blocked` exit,
 * eight canvas intents, numeric confidence, and the mutating-target refinement.
 * Zod is not on this package. Swap this parser for the published schema.
 */
export function parseRouterV1(value: unknown, textLength: number | null = null): RouterParse {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["router@1 output must be an object"] };
  }
  if ("blocked" in value) {
    const blocked = parseBlocked(value, errors);
    if (!blocked || errors.length > 0) return { ok: false, errors };
    return { ok: true, value: blocked };
  }
  rejectUnknown(value, ["clauses"], "router", errors);
  if (!Array.isArray(value.clauses)) {
    errors.push("clauses must be an array");
    return { ok: false, errors };
  }
  const clauses: RouterClauseV1[] = [];
  for (let index = 0; index < value.clauses.length; index += 1) {
    const clause = parseClause(value.clauses[index], index, errors, textLength);
    if (clause) clauses.push(clause);
  }
  if (errors.length > 0) return { ok: false, errors };
  const success: RouterSuccessV1 = { clauses };
  return { ok: true, value: success };
}

export function assertRouterV1(value: unknown, textLength: number | null = null): RouterV1 {
  const parsed = parseRouterV1(value, textLength);
  if (!parsed.ok) throw new RouterSchemaError(parsed.errors);
  return parsed.value;
}

export function foreignTargetIds(value: RouterV1, allowed: ReadonlySet<string>): string[] {
  if ("blocked" in value) return [];
  const foreign: string[] = [];
  for (const clause of value.clauses) {
    if (clause.target_id !== null && !allowed.has(clause.target_id)) foreign.push(clause.target_id);
  }
  return foreign;
}
