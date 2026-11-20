import type { ChangeClass, ClassifiedChange, RevisionEdit } from "./types.js";
import { isRecord } from "./graph.js";

const CLARIFYING_PHRASE =
  /\b(e\.g\.|for example|for instance|such as|must include|including|for clarity)\b/i;

const AUTH_PATTERNS: readonly { readonly id: string; readonly pattern: RegExp }[] = [
  { id: "magic_link", pattern: /magic\s*link/i },
  { id: "email_password", pattern: /email\s*\+\s*password|email\s+and\s+password/i },
  { id: "oauth", pattern: /\boauth\b/i },
  { id: "sso", pattern: /\bsso\b/i },
  { id: "otp", pattern: /\botp\b/i },
];

interface FieldSpec {
  readonly type: string;
  readonly required: boolean;
}

interface EndpointSpec {
  readonly name: string;
  readonly optional: boolean;
}

export class ChangeClassifier {
  classify(edit: RevisionEdit): ClassifiedChange {
    return classifyChange(edit);
  }

  classifyAll(edits: readonly RevisionEdit[]): {
    readonly changes: readonly ClassifiedChange[];
    readonly changeClass: ChangeClass;
  } {
    const changes = edits.map((edit) => this.classify(edit));
    return { changes, changeClass: batchClass(changes) };
  }
}

export function classifyChange(edit: RevisionEdit): ClassifiedChange {
  const reasons: string[] = [];
  const breaking = breakingReasons(edit);
  if (breaking.length > 0) {
    reasons.push(...breaking);
    const requested = edit.requestedClass;
    const floorApplied =
      requested === "cosmetic" || requested === "clarifying" || requested === "compatible";
    if (floorApplied) reasons.push("classification_floor");
    return { edit, changeClass: "breaking", reasons: unique(reasons), floorApplied };
  }

  const compatible = compatibleReasons(edit);
  if (compatible.length > 0) {
    return { edit, changeClass: "compatible", reasons: unique(compatible), floorApplied: false };
  }

  if (clarifyingReason(edit)) {
    return {
      edit,
      changeClass: "clarifying",
      reasons: ["clarifying_tightening"],
      floorApplied: false,
    };
  }

  if (isCosmeticWording(edit.beforeText, edit.afterText) && semanticSignature(edit.beforeText, edit.beforeFields) === semanticSignature(edit.afterText, edit.afterFields)) {
    return { edit, changeClass: "cosmetic", reasons: ["wording_or_format"], floorApplied: false };
  }

  return {
    edit,
    changeClass: "breaking",
    reasons: ["unclassified_semantic_change"],
    floorApplied: false,
  };
}

export function batchClass(changes: readonly ClassifiedChange[]): ChangeClass {
  const ranks: Record<ChangeClass, number> = {
    cosmetic: 0,
    clarifying: 1,
    compatible: 2,
    breaking: 3,
  };
  let best: ChangeClass = "cosmetic";
  for (const change of changes) {
    if (ranks[change.changeClass] > ranks[best]) best = change.changeClass;
  }
  return best;
}

export function additiveUnits(change: ClassifiedChange): number {
  if (change.changeClass !== "compatible") return 0;
  const structural =
    addedOptionalFields(change.edit).length + addedOptionalEndpoints(change.edit).length;
  return structural > 0 ? structural : 1;
}

function breakingReasons(edit: RevisionEdit): string[] {
  const reasons: string[] = [];
  const beforeSchema = readSchema(edit.beforeFields);
  const afterSchema = readSchema(edit.afterFields);
  for (const [name, before] of beforeSchema) {
    const after = afterSchema.get(name);
    if (!after) {
      reasons.push("removed_contract_field");
      continue;
    }
    if (before.type !== after.type) reasons.push("changed_contract_field");
    if (!before.required && after.required) reasons.push("tightened_required_field");
  }
  for (const [name, after] of afterSchema) {
    if (!beforeSchema.has(name) && after.required) reasons.push("added_required_field");
  }
  if (removedNames(readEndpoints(edit.beforeFields), readEndpoints(edit.afterFields)).length > 0) {
    reasons.push("removed_endpoint");
  }
  if (addedRequiredEndpoints(edit).length > 0) reasons.push("added_required_endpoint");
  if (explicitRemovals(edit.afterFields).length > 0 || explicitRemovals(edit.beforeFields).length > 0) {
    const removed = new Set([
      ...explicitRemovals(edit.beforeFields),
      ...explicitRemovals(edit.afterFields),
    ]);
    if (removed.size > 0 && schemaLostKeys(beforeSchema, afterSchema)) {
      reasons.push("removed_contract_field");
    }
  }
  if (listChanged(edit.beforeFields.removedFields, edit.afterFields.removedFields)) {
    reasons.push("removed_contract_field");
  }
  if (valueChanged(edit.beforeFields.auth, edit.afterFields.auth)) reasons.push("auth_changed");
  if (valueChanged(edit.beforeFields.authMethod, edit.afterFields.authMethod)) reasons.push("auth_changed");
  if (!sameSet(authIds(edit.beforeText, edit.beforeFields), authIds(edit.afterText, edit.afterFields))) {
    reasons.push("auth_changed");
  }
  if (valueChanged(edit.beforeFields.cutoff, edit.afterFields.cutoff)) reasons.push("cutoff_changed");
  if (!sameMultiset(timeTokens(edit.beforeText), timeTokens(edit.afterText))) reasons.push("cutoff_changed");
  if (valueChanged(edit.beforeFields.transitions, edit.afterFields.transitions)) {
    reasons.push("state_machine_changed");
  }
  if (valueChanged(edit.beforeFields.states, edit.afterFields.states)) reasons.push("state_machine_changed");
  if (valueChanged(edit.beforeFields.invariant, edit.afterFields.invariant)) reasons.push("core_rule_changed");
  if (valueChanged(edit.beforeFields.invariants, edit.afterFields.invariants)) reasons.push("core_rule_changed");
  if (valueChanged(edit.beforeFields.coreRule, edit.afterFields.coreRule)) reasons.push("core_rule_changed");
  if (numbersReplaced(edit.beforeText, edit.afterText)) reasons.push("core_value_changed");
  return unique(reasons);
}

function compatibleReasons(edit: RevisionEdit): string[] {
  const reasons: string[] = [];
  if (addedOptionalFields(edit).length > 0) reasons.push("additive_field");
  if (addedOptionalEndpoints(edit).length > 0) reasons.push("optional_endpoint");
  if (valueChanged(edit.beforeFields.uiDetail, edit.afterFields.uiDetail)) {
    reasons.push("non_breaking_ui_detail");
  }
  if (edit.afterFields.additiveRule === true && edit.beforeFields.additiveRule !== true) {
    reasons.push("non_breaking_rule");
  }
  return reasons;
}

function clarifyingReason(edit: RevisionEdit): boolean {
  const before = CLARIFYING_PHRASE.test(edit.beforeText);
  const after = CLARIFYING_PHRASE.test(edit.afterText);
  if (after && !before) return true;
  return after && edit.afterText.trim().length > edit.beforeText.trim().length;
}

function isCosmeticWording(before: string, after: string): boolean {
  if (normalizeWording(before) === normalizeWording(after)) return true;
  const beforeWords = words(before);
  const afterWords = words(after);
  if (beforeWords.length !== afterWords.length || beforeWords.length === 0) return false;
  let changed = 0;
  for (let index = 0; index < beforeWords.length; index += 1) {
    const left = beforeWords[index];
    const right = afterWords[index];
    if (left === undefined || right === undefined) return false;
    if (left === right) continue;
    changed += 1;
    if (changed > 2 || levenshtein(left, right) > 2) return false;
  }
  return changed > 0;
}

function addedOptionalFields(edit: RevisionEdit): string[] {
  const before = readSchema(edit.beforeFields);
  const after = readSchema(edit.afterFields);
  const names: string[] = [];
  for (const [name, spec] of after) {
    if (!before.has(name) && !spec.required) names.push(name);
  }
  return names;
}

function addedOptionalEndpoints(edit: RevisionEdit): string[] {
  const before = new Set(readEndpoints(edit.beforeFields).map((endpoint) => endpoint.name));
  return readEndpoints(edit.afterFields)
    .filter((endpoint) => endpoint.optional && !before.has(endpoint.name))
    .map((endpoint) => endpoint.name);
}

function addedRequiredEndpoints(edit: RevisionEdit): string[] {
  const before = new Set(readEndpoints(edit.beforeFields).map((endpoint) => endpoint.name));
  return readEndpoints(edit.afterFields)
    .filter((endpoint) => !endpoint.optional && !before.has(endpoint.name))
    .map((endpoint) => endpoint.name);
}

function schemaLostKeys(before: ReadonlyMap<string, FieldSpec>, after: ReadonlyMap<string, FieldSpec>): boolean {
  for (const name of before.keys()) {
    if (!after.has(name)) return true;
  }
  return false;
}

function explicitRemovals(fields: Readonly<Record<string, unknown>>): string[] {
  const raw = fields.removedFields;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

function readSchema(fields: Readonly<Record<string, unknown>>): Map<string, FieldSpec> {
  const raw = fields.schema ?? fields.properties ?? fields.apiFields;
  const parsed = typeof raw === "string" ? parseJsonRecord(raw) : raw;
  const map = new Map<string, FieldSpec>();
  if (!isRecord(parsed)) return map;
  for (const [name, spec] of Object.entries(parsed)) {
    if (!isRecord(spec)) {
      map.set(name, { type: "unknown", required: false });
      continue;
    }
    const type = typeof spec.type === "string" ? spec.type : "unknown";
    const required = spec.required === true || spec.optional === false;
    map.set(name, { type, required });
  }
  return map;
}

function readEndpoints(fields: Readonly<Record<string, unknown>>): EndpointSpec[] {
  const raw = fields.endpoints;
  if (!Array.isArray(raw)) return [];
  const endpoints: EndpointSpec[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.name !== "string") continue;
    endpoints.push({ name: item.name, optional: item.optional !== false && item.required !== true });
  }
  return endpoints;
}

function authIds(text: string, fields: Readonly<Record<string, unknown>>): string[] {
  const found = new Set<string>();
  const fieldAuth = [fields.auth, fields.authMethod]
    .filter((item): item is string => typeof item === "string")
    .join(" ");
  const haystack = `${text}\n${fieldAuth}`;
  for (const auth of AUTH_PATTERNS) {
    if (auth.pattern.test(haystack)) found.add(auth.id);
  }
  return [...found].sort();
}

function timeTokens(text: string): string[] {
  return [...text.matchAll(/\b\d{1,2}:\d{2}\b/g)].map((match) => match[0] ?? "").filter(Boolean).sort();
}

function numberTokens(text: string): string[] {
  const withoutTimes = text.replace(/\b\d{1,2}:\d{2}\b/g, " ");
  return [...withoutTimes.matchAll(/\b\d+(?:\.\d+)?\b/g)].map((match) => match[0] ?? "").filter(Boolean).sort();
}

function numbersReplaced(before: string, after: string): boolean {
  const beforeNumbers = numberTokens(before);
  const afterNumbers = new Set(numberTokens(after));
  return beforeNumbers.some((token) => !afterNumbers.has(token));
}

function semanticSignature(text: string, fields: Readonly<Record<string, unknown>>): string {
  return JSON.stringify({
    times: timeTokens(text),
    numbers: numberTokens(text),
    auth: authIds(text, fields),
    cutoff: fields.cutoff ?? null,
    transitions: fields.transitions ?? null,
    states: fields.states ?? null,
    invariant: fields.invariant ?? null,
  });
}

function normalizeWording(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~#>]/g, "")
    .replace(/[.,;:!?'"()[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function words(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[^a-z0-9:+]+/g, " ").trim();
  if (!normalized) return [];
  return normalized.split(/\s+/);
}

function levenshtein(left: string, right: string): number {
  const previous: number[] = [];
  const current: number[] = [];
  for (let column = 0; column <= right.length; column += 1) previous.push(column);
  for (let row = 1; row <= left.length; row += 1) {
    current.length = 0;
    current.push(row);
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      const insert = (current[column - 1] ?? row) + 1;
      const remove = (previous[column] ?? column) + 1;
      const replace = (previous[column - 1] ?? 0) + cost;
      current.push(Math.min(insert, remove, replace));
    }
    previous.length = 0;
    for (const value of current) previous.push(value);
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
}

function valueChanged(before: unknown, after: unknown): boolean {
  return stable(before) !== stable(after);
}

function listChanged(before: unknown, after: unknown): boolean {
  const left = Array.isArray(before) ? before.map((item) => stable(item)).sort() : [];
  const right = Array.isArray(after) ? after.map((item) => stable(item)).sort() : [];
  if (left.length === 0 && right.length === 0) return false;
  return left.join("\n") !== right.join("\n");
}

function stable(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(",")}]`;
  const entries = Object.entries(value).sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}

function sameMultiset(left: readonly string[], right: readonly string[]): boolean {
  return left.join("\n") === right.join("\n");
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.join("\n") === right.join("\n");
}

function removedNames(before: readonly EndpointSpec[], after: readonly EndpointSpec[]): string[] {
  const afterNames = new Set(after.map((endpoint) => endpoint.name));
  return before.filter((endpoint) => !afterNames.has(endpoint.name)).map((endpoint) => endpoint.name);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}
