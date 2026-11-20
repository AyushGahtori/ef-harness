import {
  type ArchitectureViolation,
  type SystemSkeleton,
  violation,
  WORD_BUDGET,
} from "./types.js";

export const TOUCHES_TAGS = [
  "personal_data",
  "credentials",
  "money",
  "user_content",
  "authn",
  "authz",
  "session",
  "scheduling",
  "time_display",
  "file_upload",
  "file_download",
  "external_api",
  "inbound_webhook",
  "outbound_message",
  "background_job",
  "realtime",
  "destructive_write",
  "bulk_write",
  "migration",
  "search",
  "form_input",
  "route",
  "interactive_ui",
  "logging",
  "config_env",
  "caching",
  "rate_limited",
  "concurrent_edit",
] as const;

const TOUCHES = new Set<string>(TOUCHES_TAGS);

export type ArchitectParse =
  | { readonly kind: "skeleton"; readonly skeleton: SystemSkeleton }
  | { readonly kind: "blocked"; readonly violations: readonly ArchitectureViolation[] }
  | { readonly kind: "invalid"; readonly violations: readonly ArchitectureViolation[] };

export function parseArchitectOutput(raw: string): ArchitectParse {
  const extracted = extractJson(raw);
  if (!extracted.ok) {
    return { kind: "invalid", violations: [violation("schema_invalid", extracted.message)] };
  }
  let value: unknown;
  try {
    value = JSON.parse(extracted.json) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "invalid", violations: [violation("schema_invalid", message)] };
  }
  if (!isRecord(value)) {
    return { kind: "invalid", violations: [violation("schema_invalid", "system-architect@1 output must be an object")] };
  }
  if (value.blocked === true) {
    return parseBlocked(value);
  }
  const errors: string[] = [];
  const skeleton = readSkeleton(value, errors);
  if (!skeleton || errors.length > 0) {
    return {
      kind: "invalid",
      violations: [violation("schema_invalid", errors.join("; ") || "system-architect@1 output is invalid")],
    };
  }
  return { kind: "skeleton", skeleton };
}

export function countSkeletonWords(skeleton: SystemSkeleton): number {
  const chunks: string[] = [];
  collectStrings(skeleton, chunks);
  return chunks.join(" ").split(/\s+/).filter((word) => word.length > 0).length;
}

export function wordBudgetViolation(skeleton: SystemSkeleton): ArchitectureViolation | null {
  const count = countSkeletonWords(skeleton);
  if (count <= WORD_BUDGET) return null;
  return violation(
    "over_word_budget",
    `Skeleton is ${count} words; the upfront skeleton must stay within ${WORD_BUDGET} words.`,
  );
}

function extractJson(raw: string): { ok: true; json: string } | { ok: false; message: string } {
  const trimmed = raw.trim();
  const fences = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  if (fences.length > 1) {
    return { ok: false, message: "system-architect@1 output contains more than one JSON fence" };
  }
  const first = fences[0];
  if (first) {
    return { ok: true, json: (first[1] ?? "").trim() };
  }
  return { ok: true, json: trimmed };
}

function parseBlocked(value: Record<string, unknown>): ArchitectParse {
  const errors: string[] = [];
  exactKeys(value, ["blocked", "reason", "missing_ids"], "blocked", errors);
  const reason = readText(value.reason, "blocked.reason", errors);
  const missing = value.missing_ids === undefined ? [] : readIdList(value.missing_ids, "blocked.missing_ids", errors);
  if (!reason || errors.length > 0) {
    return { kind: "invalid", violations: [violation("schema_invalid", errors.join("; "))] };
  }
  return {
    kind: "blocked",
    violations: [violation("blocked", reason, missing ?? [])],
  };
}

function readSkeleton(value: Record<string, unknown>, errors: string[]): SystemSkeleton | null {
  exactKeys(
    value,
    [
      "components",
      "entities",
      "contracts",
      "rules",
      "conventions",
      "env_manifest",
      "risks",
      "topology",
      "stack",
      "auth",
      "feature_map",
      "seams",
      "diagrams",
      "adrs",
      "events",
      "routes",
      "error_envelope",
      "response_convention",
      "rewrites",
    ],
    "skeleton",
    errors,
  );
  const components = readArray(value.components, "components", errors, readComponent);
  const entities = readArray(value.entities, "entities", errors, readEntity);
  const contracts = readArray(value.contracts, "contracts", errors, readContract);
  const rules = readArray(value.rules, "rules", errors, readRule);
  const conventions = readTextList(value.conventions, "conventions", errors);
  const envManifest = readArray(value.env_manifest, "env_manifest", errors, readEnv);
  const risks = readArray(value.risks, "risks", errors, readRisk);
  const topology = readTopology(value.topology, errors);
  const stack = readArray(value.stack, "stack", errors, readStack);
  const auth = readAuth(value.auth, errors);
  const featureMap = readArray(value.feature_map, "feature_map", errors, readFeature);
  const seams = readArray(value.seams, "seams", errors, readSeam);
  const diagrams = readArray(value.diagrams, "diagrams", errors, readDiagram);
  const adrs = readArray(value.adrs, "adrs", errors, readAdr);
  const events = readArray(value.events, "events", errors, readEvent);
  const routes = readArray(value.routes, "routes", errors, readRoute);
  const errorEnvelope = readText(value.error_envelope, "error_envelope", errors);
  const responseConvention = readText(value.response_convention, "response_convention", errors);
  const rewrites = value.rewrites === undefined ? [] : readIdList(value.rewrites, "rewrites", errors);
  if (
    !components ||
    !entities ||
    !contracts ||
    !rules ||
    !conventions ||
    !envManifest ||
    !risks ||
    !topology ||
    !stack ||
    !auth ||
    !featureMap ||
    !seams ||
    !diagrams ||
    !adrs ||
    !events ||
    !routes ||
    !errorEnvelope ||
    !responseConvention ||
    !rewrites
  ) {
    return null;
  }
  if (featureMap.length === 0) errors.push("feature_map must name at least one feature");
  if (stack.length === 0) errors.push("stack must name at least one runtime");
  if (topology.directories.length === 0) errors.push("topology.directories must not be empty");
  const kinds = new Set(diagrams.map((diagram) => diagram.kind));
  if (!kinds.has("context") || !kinds.has("data_flow")) {
    errors.push("diagrams must include context and data_flow");
  }
  if (errors.length > 0) return null;
  return {
    components,
    entities,
    contracts,
    rules,
    conventions,
    env_manifest: envManifest,
    risks,
    topology,
    stack,
    auth,
    feature_map: featureMap,
    seams,
    diagrams,
    adrs,
    events,
    routes,
    error_envelope: errorEnvelope,
    response_convention: responseConvention,
    rewrites,
  };
}

function readComponent(value: unknown, path: string, errors: string[]) {
  const record = expectRecord(value, path, errors);
  if (!record) return null;
  exactKeys(record, ["id", "name", "boundary", "action"], path, errors);
  const id = readId(record.id, `${path}.id`, errors);
  const name = readText(record.name, `${path}.name`, errors);
  const boundary = readText(record.boundary, `${path}.boundary`, errors);
  const action = record.action === undefined ? "keep" : readEnum(record.action, `${path}.action`, ["keep", "rewrite"], errors);
  if (!id || !name || !boundary || !action) return null;
  return { id, name, boundary, action };
}

function readEntity(value: unknown, path: string, errors: string[]) {
  const record = expectRecord(value, path, errors);
  if (!record) return null;
  exactKeys(record, ["id", "table", "fields", "relations", "owner"], path, errors);
  const id = readId(record.id, `${path}.id`, errors);
  const table = readId(record.table, `${path}.table`, errors);
  const fields = readArray(record.fields, `${path}.fields`, errors, readField);
  const relations = readArray(record.relations, `${path}.relations`, errors, readRelation);
  const owner = readId(record.owner, `${path}.owner`, errors);
  if (!id || !table || !fields || !relations || !owner) return null;
  return { id, table, fields, relations, owner };
}

function readField(value: unknown, path: string, errors: string[]) {
  const record = expectRecord(value, path, errors);
  if (!record) return null;
  exactKeys(record, ["name", "type", "nullable"], path, errors);
  const name = readId(record.name, `${path}.name`, errors);
  const type = readText(record.type, `${path}.type`, errors);
  const nullable = record.nullable === undefined ? false : readBoolean(record.nullable, `${path}.nullable`, errors);
  if (!name || !type || nullable === null) return null;
  return { name, type, nullable };
}

function readRelation(value: unknown, path: string, errors: string[]) {
  const record = expectRecord(value, path, errors);
  if (!record) return null;
  exactKeys(record, ["target", "kind"], path, errors);
  const target = readId(record.target, `${path}.target`, errors);
  const kind = readText(record.kind, `${path}.kind`, errors);
  if (!target || !kind) return null;
  return { target, kind };
}

function readContract(value: unknown, path: string, errors: string[]) {
  const record = expectRecord(value, path, errors);
  if (!record) return null;
  exactKeys(record, ["id", "producer", "consumers", "schema"], path, errors);
  const id = readId(record.id, `${path}.id`, errors);
  const producer = readId(record.producer, `${path}.producer`, errors);
  const consumers = readIdList(record.consumers, `${path}.consumers`, errors);
  const schema = readText(record.schema, `${path}.schema`, errors);
  if (!id || !producer || !consumers || !schema) return null;
  if (consumers.length === 0) errors.push(`${path}.consumers must include at least one feature`);
  return { id, producer, consumers, schema };
}

function readRule(value: unknown, path: string, errors: string[]) {
  const record = expectRecord(value, path, errors);
  if (!record) return null;
  exactKeys(record, ["id", "text", "scope_predicate", "check_kind"], path, errors);
  const id = readId(record.id, `${path}.id`, errors);
  const text = readText(record.text, `${path}.text`, errors);
  const scope = readScope(record.scope_predicate, `${path}.scope_predicate`, errors);
  const checkKind = readText(record.check_kind, `${path}.check_kind`, errors);
  if (!id || !text || !scope || !checkKind) return null;
  return { id, text, scope_predicate: scope, check_kind: checkKind };
}

function readEnv(value: unknown, path: string, errors: string[]) {
  const record = expectRecord(value, path, errors);
  if (!record) return null;
  exactKeys(record, ["name", "required", "description"], path, errors);
  const name = readId(record.name, `${path}.name`, errors);
  const required = readBoolean(record.required, `${path}.required`, errors);
  const description = readText(record.description, `${path}.description`, errors);
  if (!name || required === null || !description) return null;
  return { name, required, description };
}

function readRisk(value: unknown, path: string, errors: string[]) {
  const record = expectRecord(value, path, errors);
  if (!record) return null;
  exactKeys(record, ["id", "text"], path, errors);
  const id = readId(record.id, `${path}.id`, errors);
  const text = readText(record.text, `${path}.text`, errors);
  if (!id || !text) return null;
  return { id, text };
}

function readTopology(value: unknown, errors: string[]) {
  const record = expectRecord(value, "topology", errors);
  if (!record) return null;
  exactKeys(record, ["directories", "packages"], "topology", errors);
  const directories = readTextList(record.directories, "topology.directories", errors);
  const packages = readArray(record.packages, "topology.packages", errors, readPackage);
  if (!directories || !packages) return null;
  return { directories, packages };
}

function readPackage(value: unknown, path: string, errors: string[]) {
  const record = expectRecord(value, path, errors);
  if (!record) return null;
  exactKeys(record, ["name", "path", "runtime"], path, errors);
  const name = readId(record.name, `${path}.name`, errors);
  const packagePath = readText(record.path, `${path}.path`, errors);
  const runtime = readText(record.runtime, `${path}.runtime`, errors);
  if (!name || !packagePath || !runtime) return null;
  return { name, path: packagePath, runtime };
}

function readStack(value: unknown, path: string, errors: string[]) {
  const record = expectRecord(value, path, errors);
  if (!record) return null;
  exactKeys(record, ["name", "version", "boundary"], path, errors);
  const name = readText(record.name, `${path}.name`, errors);
  const version = readText(record.version, `${path}.version`, errors);
  const boundary = readText(record.boundary, `${path}.boundary`, errors);
  if (!name || !version || !boundary) return null;
  return { name, version, boundary };
}

function readAuth(value: unknown, errors: string[]) {
  const record = expectRecord(value, "auth", errors);
  if (!record) return null;
  exactKeys(record, ["model", "tenant", "session", "contract_id"], "auth", errors);
  const model = readText(record.model, "auth.model", errors);
  const tenant = readText(record.tenant, "auth.tenant", errors);
  const session = readText(record.session, "auth.session", errors);
  const contractId = readId(record.contract_id, "auth.contract_id", errors);
  if (!model || !tenant || !session || !contractId) return null;
  return { model, tenant, session, contract_id: contractId };
}

function readFeature(value: unknown, path: string, errors: string[]) {
  const record = expectRecord(value, path, errors);
  if (!record) return null;
  exactKeys(record, ["id", "title", "depends_on", "requirements", "owns"], path, errors);
  const id = readId(record.id, `${path}.id`, errors);
  const title = readText(record.title, `${path}.title`, errors);
  const dependsOn = readIdList(record.depends_on, `${path}.depends_on`, errors);
  const requirements = readIdList(record.requirements, `${path}.requirements`, errors);
  const owns = record.owns === undefined ? [] : readIdList(record.owns, `${path}.owns`, errors);
  if (!id || !title || !dependsOn || !requirements || !owns) return null;
  return { id, title, depends_on: dependsOn, requirements, owns };
}

function readSeam(value: unknown, path: string, errors: string[]) {
  const record = expectRecord(value, path, errors);
  if (!record) return null;
  exactKeys(record, ["id", "from", "to", "contract_id"], path, errors);
  const id = readId(record.id, `${path}.id`, errors);
  const from = readId(record.from, `${path}.from`, errors);
  const to = readId(record.to, `${path}.to`, errors);
  const contractId = readId(record.contract_id, `${path}.contract_id`, errors);
  if (!id || !from || !to || !contractId) return null;
  return { id, from, to, contract_id: contractId };
}

function readDiagram(value: unknown, path: string, errors: string[]) {
  const record = expectRecord(value, path, errors);
  if (!record) return null;
  exactKeys(record, ["id", "kind", "source"], path, errors);
  const id = readId(record.id, `${path}.id`, errors);
  const kind = readEnum(record.kind, `${path}.kind`, ["context", "data_flow", "sequence", "state"], errors);
  const source = readText(record.source, `${path}.source`, errors);
  if (!id || !kind || !source) return null;
  return { id, kind, source };
}

function readAdr(value: unknown, path: string, errors: string[]) {
  const record = expectRecord(value, path, errors);
  if (!record) return null;
  exactKeys(record, ["id", "title", "choice", "justified_by"], path, errors);
  const id = readId(record.id, `${path}.id`, errors);
  const title = readText(record.title, `${path}.title`, errors);
  const choice = readText(record.choice, `${path}.choice`, errors);
  const justifiedBy = readIdList(record.justified_by, `${path}.justified_by`, errors);
  if (!id || !title || !choice || !justifiedBy) return null;
  if (justifiedBy.length === 0) errors.push(`${path}.justified_by must cite a decision or research fact`);
  return { id, title, choice, justified_by: justifiedBy };
}

function readEvent(value: unknown, path: string, errors: string[]) {
  const record = expectRecord(value, path, errors);
  if (!record) return null;
  exactKeys(record, ["id", "name", "owner"], path, errors);
  const id = readId(record.id, `${path}.id`, errors);
  const name = readId(record.name, `${path}.name`, errors);
  const owner = readId(record.owner, `${path}.owner`, errors);
  if (!id || !name || !owner) return null;
  return { id, name, owner };
}

function readRoute(value: unknown, path: string, errors: string[]) {
  const record = expectRecord(value, path, errors);
  if (!record) return null;
  exactKeys(record, ["kind", "value", "owner"], path, errors);
  const kind = readEnum(record.kind, `${path}.kind`, ["http_route", "page_route"], errors);
  const routeValue = readText(record.value, `${path}.value`, errors);
  const owner = readId(record.owner, `${path}.owner`, errors);
  if (!kind || !routeValue || !owner) return null;
  return { kind, value: routeValue, owner };
}

function readScope(value: unknown, path: string, errors: string[]) {
  const record = expectRecord(value, path, errors);
  if (!record) return null;
  exactKeys(record, ["any", "all"], path, errors);
  const any = record.any === undefined ? [] : readTagList(record.any, `${path}.any`, errors);
  const all = record.all === undefined ? [] : readTagList(record.all, `${path}.all`, errors);
  if (!any || !all) return null;
  if (any.length + all.length === 0) errors.push(`${path} must list at least one tag in any or all`);
  return { any, all };
}

function readArray<T>(
  value: unknown,
  path: string,
  errors: string[],
  readItem: (item: unknown, itemPath: string, errors: string[]) => T | null,
): T[] | null {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return null;
  }
  const items: T[] = [];
  value.forEach((item, index) => {
    const parsed = readItem(item, `${path}[${index}]`, errors);
    if (parsed) items.push(parsed);
  });
  return items;
}

function readIdList(value: unknown, path: string, errors: string[]): string[] | null {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return null;
  }
  const ids: string[] = [];
  value.forEach((item, index) => {
    const id = readId(item, `${path}[${index}]`, errors);
    if (id) ids.push(id);
  });
  return ids;
}

function readTextList(value: unknown, path: string, errors: string[]): string[] | null {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return null;
  }
  const texts: string[] = [];
  value.forEach((item, index) => {
    const text = readText(item, `${path}[${index}]`, errors);
    if (text) texts.push(text);
  });
  return texts;
}

function readTagList(value: unknown, path: string, errors: string[]): string[] | null {
  const tags = readTextList(value, path, errors);
  if (!tags) return null;
  tags.forEach((tag, index) => {
    if (!TOUCHES.has(tag)) errors.push(`${path}[${index}] is not a touches tag`);
  });
  return tags;
}

function readId(value: unknown, path: string, errors: string[]): string | null {
  const text = readText(value, path, errors);
  if (!text) return null;
  if (/\s/.test(text)) {
    errors.push(`${path} must not contain whitespace`);
    return null;
  }
  return text;
}

function readText(value: unknown, path: string, errors: string[]): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be non-blank text`);
    return null;
  }
  return value.trim();
}

function readBoolean(value: unknown, path: string, errors: string[]): boolean | null {
  if (typeof value !== "boolean") {
    errors.push(`${path} must be a boolean`);
    return null;
  }
  return value;
}

function readEnum<T extends string>(value: unknown, path: string, allowed: readonly T[], errors: string[]): T | null {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    errors.push(`${path} must be one of ${allowed.join(", ")}`);
    return null;
  }
  return value as T;
}

function expectRecord(value: unknown, path: string, errors: string[]): Record<string, unknown> | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  return value;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, errors: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${path}.${key} is not allowed`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectStrings(value: unknown, chunks: string[]): void {
  if (typeof value === "string") {
    chunks.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, chunks);
    return;
  }
  if (isRecord(value)) {
    for (const inner of Object.values(value)) collectStrings(inner, chunks);
  }
}
