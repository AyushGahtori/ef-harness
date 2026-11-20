import { isTouchTag, type ScopePredicate, type TouchTag } from "./closed-tags.js";
import { EXPECTED_RULE_IDS, isRecord, readScope, type RuleId } from "./rules.js";

export const SHARED_EDGE_KINDS = ["entity", "endpoint", "event"] as const;
export type SharedEdgeKind = (typeof SHARED_EDGE_KINDS)[number];

export const EXPECTED_SEAM_IDS = [
  "S-01",
  "S-02",
  "S-03",
  "S-04",
  "S-05",
  "S-06",
  "S-07",
  "S-08",
  "S-09",
  "S-10",
] as const;

export type SeamId = (typeof EXPECTED_SEAM_IDS)[number];

export const EXPECTED_SEAM_NAMES: Readonly<Record<SeamId, string>> = {
  "S-01": "Auth Middleware ↔ Protected API Route",
  "S-02": "Web Client Form/State ↔ Backend API Contract",
  "S-03": "Backend Service ↔ Relational DB / Migration",
  "S-04": "External Webhook Provider ↔ Signature Verifier & Queue",
  "S-05": "File Upload UI ↔ Presigned/Local Storage & Scanner",
  "S-06": "Transactional Email / Notification Trigger ↔ Mailer/Queue",
  "S-07": "Scheduled Job / Cutoff Timer ↔ Business State Mutation",
  "S-08": "Payment Checkout ↔ Order/Ledger Finalization",
  "S-09": "Cache Layer ↔ Primary Store Invalidation",
  "S-10": "Realtime Stream/WebSocket ↔ Client Reconnect/Resync",
};

export interface SeamActivation {
  readonly shared: readonly SharedEdgeKind[];
  readonly scope: ScopePredicate;
}

export interface SeamMatchCase {
  readonly polarity: "positive" | "negative";
  readonly sharedEntities: readonly string[];
  readonly sharedEndpoints: readonly string[];
  readonly sharedEvents: readonly string[];
  readonly tags: readonly TouchTag[];
}

export interface SeamTemplate {
  readonly id: SeamId;
  readonly name: string;
  readonly left: string;
  readonly right: string;
  readonly corpusSeam: string;
  readonly questions: readonly string[];
  readonly contractShape: string;
  readonly failureModes: readonly string[];
  readonly integrationOracle: string;
  readonly ruleIds: readonly RuleId[];
  readonly activation: SeamActivation;
  readonly matchCases: readonly SeamMatchCase[];
}

const SEAM_KEYS = new Set([
  "id",
  "name",
  "left",
  "right",
  "corpus_seam",
  "questions",
  "contract_shape",
  "failure_modes",
  "integration_oracle",
  "rules",
  "activation",
  "match_cases",
]);

function push(issues: string[], message: string): void {
  issues.push(message);
}

function readString(value: unknown, label: string, issues: string[]): string {
  if (typeof value !== "string" || value.trim() === "") {
    push(issues, `${label} must be a non-empty string`);
    return "";
  }
  return value.trim();
}

function readStringArray(value: unknown, label: string, issues: string[]): string[] {
  if (!Array.isArray(value)) {
    push(issues, `${label} must be an array of strings`);
    return [];
  }
  const out: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim() === "") {
      push(issues, `${label}[${index}] must be a non-empty string`);
      continue;
    }
    out.push(item.trim());
  }
  return out;
}

function readShared(value: unknown, label: string, issues: string[]): SharedEdgeKind[] {
  const raw = readStringArray(value, label, issues);
  const kinds: SharedEdgeKind[] = [];
  for (const item of raw) {
    if (!SHARED_EDGE_KINDS.includes(item as SharedEdgeKind)) {
      push(issues, `${label} kind ${item} must be entity, endpoint, or event`);
      continue;
    }
    kinds.push(item as SharedEdgeKind);
  }
  if (kinds.length === 0) {
    push(issues, `${label} must list at least one shared edge kind`);
  }
  return kinds;
}

function readRuleIds(value: unknown, label: string, issues: string[]): RuleId[] {
  const raw = readStringArray(value, label, issues);
  const ids: RuleId[] = [];
  for (const item of raw) {
    if (!EXPECTED_RULE_IDS.includes(item as RuleId)) {
      push(issues, `${label} rule ${item} is outside X-01..X-14`);
      continue;
    }
    ids.push(item as RuleId);
  }
  return ids;
}

function readActivation(value: unknown, label: string, issues: string[]): SeamActivation {
  if (!isRecord(value)) {
    push(issues, `${label} must be an object`);
    return { shared: [], scope: {} };
  }
  for (const key of Object.keys(value)) {
    if (key !== "shared" && key !== "scope") {
      push(issues, `${label}.${key} is not allowed`);
    }
  }
  return {
    shared: readShared(value.shared, `${label}.shared`, issues),
    scope: readScope(value.scope, `${label}.scope`, issues),
  };
}

function readMatchCases(value: unknown, label: string, issues: string[]): SeamMatchCase[] {
  if (!Array.isArray(value) || value.length === 0) {
    push(issues, `${label} must contain at least one match case`);
    return [];
  }
  const cases: SeamMatchCase[] = [];
  for (const [index, item] of value.entries()) {
    const caseLabel = `${label}[${index}]`;
    if (!isRecord(item)) {
      push(issues, `${caseLabel} must be an object`);
      continue;
    }
    const polarity = item.polarity;
    if (polarity !== "positive" && polarity !== "negative") {
      push(issues, `${caseLabel}.polarity must be positive or negative`);
      continue;
    }
    const tags = readStringArray(item.tags, `${caseLabel}.tags`, issues);
    const touchTags: TouchTag[] = [];
    for (const tag of tags) {
      if (!isTouchTag(tag)) {
        push(issues, `${caseLabel}.tags tag ${tag} is outside the closed touches tags`);
        continue;
      }
      touchTags.push(tag);
    }
    cases.push({
      polarity,
      sharedEntities: readStringArray(item.shared_entities, `${caseLabel}.shared_entities`, issues),
      sharedEndpoints: readStringArray(
        item.shared_endpoints,
        `${caseLabel}.shared_endpoints`,
        issues,
      ),
      sharedEvents: readStringArray(item.shared_events, `${caseLabel}.shared_events`, issues),
      tags: touchTags,
    });
  }
  return cases;
}

export function parseSeamTemplate(value: unknown, index: number): {
  readonly seam: SeamTemplate | null;
  readonly issues: readonly string[];
} {
  const issues: string[] = [];
  const label = `seams[${index}]`;
  if (!isRecord(value)) return { seam: null, issues: [`${label} must be an object`] };
  for (const key of Object.keys(value)) {
    if (!SEAM_KEYS.has(key)) push(issues, `${label}.${key} is not allowed on a seam template`);
  }
  const id = readString(value.id, `${label}.id`, issues);
  if (id && !EXPECTED_SEAM_IDS.includes(id as SeamId)) {
    push(issues, `${label}.id ${id} is outside S-01..S-10`);
  }
  const name = readString(value.name, `${label}.name`, issues);
  const left = readString(value.left, `${label}.left`, issues);
  const right = readString(value.right, `${label}.right`, issues);
  const corpusSeam = readString(value.corpus_seam, `${label}.corpus_seam`, issues);
  const questions = readStringArray(value.questions, `${label}.questions`, issues);
  if (questions.length === 0) push(issues, `${label}.questions must not be empty`);
  const contractShape = readString(value.contract_shape, `${label}.contract_shape`, issues);
  const failureModes = readStringArray(value.failure_modes, `${label}.failure_modes`, issues);
  if (failureModes.length === 0) push(issues, `${label}.failure_modes must not be empty`);
  const integrationOracle = readString(
    value.integration_oracle,
    `${label}.integration_oracle`,
    issues,
  );
  const ruleIds = readRuleIds(value.rules, `${label}.rules`, issues);
  const activation = readActivation(value.activation, `${label}.activation`, issues);
  const scope = activation.scope;
  if ((scope.any?.length ?? 0) === 0 && (scope.all?.length ?? 0) === 0) {
    push(issues, `${label}.activation.scope is empty`);
  }
  const matchCases = readMatchCases(value.match_cases, `${label}.match_cases`, issues);
  if (!id || !EXPECTED_SEAM_IDS.includes(id as SeamId) || issues.length > 0) {
    return { seam: null, issues };
  }
  const seamId = id as SeamId;
  if (name !== EXPECTED_SEAM_NAMES[seamId]) {
    push(issues, `${label}.name must be the Task 077 seam name for ${seamId}`);
  }
  if (issues.length > 0) return { seam: null, issues };
  return {
    seam: {
      id: seamId,
      name,
      left,
      right,
      corpusSeam,
      questions,
      contractShape,
      failureModes,
      integrationOracle,
      ruleIds,
      activation,
      matchCases,
    },
    issues,
  };
}

export function parseSeamDocument(value: unknown): SeamTemplate[] {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new Error("seam document must be an object");
  }
  for (const key of Object.keys(value)) {
    if (key !== "version" && key !== "seams") push(issues, `unexpected document key ${key}`);
  }
  if (value.version !== 1) push(issues, "version must be 1");
  if (!Array.isArray(value.seams)) {
    issues.push("seams must be an array");
    throw new Error(issues.join("\n"));
  }
  if (value.seams.length !== EXPECTED_SEAM_IDS.length) {
    push(issues, `expected exactly ${EXPECTED_SEAM_IDS.length} seams, found ${value.seams.length}`);
  }
  const seams: SeamTemplate[] = [];
  for (const [index, item] of value.seams.entries()) {
    const parsed = parseSeamTemplate(item, index);
    issues.push(...parsed.issues);
    if (parsed.seam) seams.push(parsed.seam);
  }
  const ids = seams.map((seam) => seam.id);
  for (const [index, expected] of EXPECTED_SEAM_IDS.entries()) {
    if (ids[index] !== expected) push(issues, `seams[${index}].id must be ${expected}`);
  }
  if (issues.length > 0) {
    throw new Error(issues.join("\n"));
  }
  return seams;
}
