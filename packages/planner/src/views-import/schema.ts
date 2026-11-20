import { isFieldMap, isFieldValue } from "./hash.js";
import {
  NODE_KINDS,
  RELATION_KEYS,
  SETTLED_BASES,
  TOUCHES_TAGS,
  WORKFLOW_STATUSES,
  type DocImportBlocked,
  type DocImportProposal,
  type DocImportSuccess,
  type DocImportV1,
  type FieldMap,
  type FieldValue,
  type SchemaBanner,
} from "./types.js";

export interface SchemaIssue {
  readonly path: string;
  readonly message: string;
  readonly line: number | null;
}

const TOUCHES = new Set<string>(TOUCHES_TAGS);
const BASES = new Set<string>(SETTLED_BASES);
const WORKFLOW = new Set<string>(WORKFLOW_STATUSES);
const KINDS = new Set<string>(NODE_KINDS);
const RELATIONS = new Set<string>(RELATION_KEYS);

export function validateEfFields(
  fields: FieldMap,
  knownIds: ReadonlySet<string>,
  keyLines: ReadonlyMap<string, number>,
): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const line = keyLines.get(key) ?? null;
    checkValue(key, value, knownIds, line, issues);
  }
  return issues;
}

export function schemaBanners(filePath: string, nodeId: string | null, issues: readonly SchemaIssue[]): SchemaBanner[] {
  return issues.map((issue) => ({
    filePath,
    nodeId,
    line: issue.line,
    message: issue.message,
  }));
}

function checkValue(
  key: string,
  value: FieldValue,
  knownIds: ReadonlySet<string>,
  line: number | null,
  issues: SchemaIssue[],
): void {
  if (key === "basis") {
    if (typeof value !== "string" || !BASES.has(value)) {
      issues.push({ path: key, line, message: `invalid basis ${show(value)}` });
    }
    return;
  }
  if (key === "status") {
    if (typeof value !== "string" || !WORKFLOW.has(value)) {
      issues.push({ path: key, line, message: `invalid status ${show(value)}` });
    }
    return;
  }
  if (key === "touches") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      issues.push({ path: key, line, message: "touches must be a list of closed tags" });
      return;
    }
    for (const tag of value) {
      if (typeof tag === "string" && !TOUCHES.has(tag)) {
        issues.push({ path: key, line, message: `unknown touches tag "${tag}"` });
      }
    }
    return;
  }
  if (key === "bounds" || key === "numeric_bounds") {
    if (!isFieldMap(value)) {
      issues.push({ path: key, line, message: `${key} must be a map of numbers` });
      return;
    }
    for (const [boundKey, boundValue] of Object.entries(value)) {
      if (typeof boundValue !== "number") {
        issues.push({ path: `${key}.${boundKey}`, line, message: `${key}.${boundKey} must be a number` });
      }
    }
    return;
  }
  if (key === "names") {
    if (!Array.isArray(value)) {
      issues.push({ path: key, line, message: "names must be a list" });
      return;
    }
    for (const entry of value) {
      if (!isFieldMap(entry) || typeof entry.kind !== "string" || typeof entry.value !== "string") {
        issues.push({ path: key, line, message: "each name needs a string kind and value" });
      }
    }
    return;
  }
  if (RELATIONS.has(key)) {
    const ids = scalarIds(value);
    if (ids === null) {
      issues.push({ path: key, line, message: `${key} must be a node id or a list of node ids` });
      return;
    }
    for (const id of ids) {
      if (!knownIds.has(id)) issues.push({ path: key, line, message: `unknown node id "${id}"` });
    }
    return;
  }
  if (!isFieldValue(value)) {
    issues.push({ path: key, line, message: `unsupported value for ${key}` });
  }
}

function scalarIds(value: FieldValue): string[] | null {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value.filter((item): item is string => typeof item === "string");
}

function show(value: FieldValue): string {
  if (typeof value === "string") return `"${value}"`;
  if (value === null) return "null";
  return JSON.stringify(value);
}

export type DocImportParse = { ok: true; value: DocImportV1 } | { ok: false; message: string };

/** Local stand-in for Task 009 `DocImportV1Schema`, plus the changeClass Task 086 requires. */
export function parseDocImportPayload(value: unknown): DocImportParse {
  if (!isRecord(value)) return { ok: false, message: "doc-import@1 output must be an object" };
  if (value.blocked === true) {
    if (typeof value.reason !== "string" || value.reason.trim() === "") {
      return { ok: false, message: "blocked doc-import@1 output needs a reason" };
    }
    const blocked: DocImportBlocked = { blocked: true, reason: value.reason };
    return { ok: true, value: blocked };
  }
  if (value.changeClass !== "cosmetic" && value.changeClass !== "semantic") {
    return { ok: false, message: "doc-import@1 changeClass must be cosmetic or semantic" };
  }
  if (!Array.isArray(value.proposals)) return { ok: false, message: "doc-import@1 proposals must be a list" };
  const proposals: DocImportProposal[] = [];
  for (const item of value.proposals) {
    const parsed = parseProposal(item);
    if (typeof parsed === "string") return { ok: false, message: parsed };
    proposals.push(parsed);
  }
  const success: DocImportSuccess = {
    blocked: false,
    changeClass: value.changeClass,
    proposals,
  };
  return { ok: true, value: success };
}

function parseProposal(value: unknown): DocImportProposal | string {
  if (!isRecord(value)) return "each proposal must be an object";
  const kind = value.kind;
  if (kind !== "new_node" && kind !== "update" && kind !== "new_edge" && kind !== "note") {
    return "proposal kind is not one of new_node, update, new_edge, note";
  }
  const target = value.target_id;
  if (target !== null && typeof target !== "string") return "target_id must be a string or null";
  const nodeType = value.node_type;
  if (nodeType !== null && typeof nodeType !== "string") return "node_type must be a string or null";
  if (typeof value.text !== "string" || value.text.trim() === "") return "proposal text must be verbatim and non-empty";
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) {
    return "confidence must be between 0 and 1";
  }
  if (!Array.isArray(value.fields)) return "proposal fields must be a list of pairs";
  const fields: { key: string; value: string | number | boolean | null }[] = [];
  for (const pair of value.fields) {
    if (!isRecord(pair) || typeof pair.key !== "string" || !pair.key.trim()) return "field pair key must be a string";
    const pairValue = pair.value;
    if (
      pairValue !== null &&
      typeof pairValue !== "string" &&
      typeof pairValue !== "boolean" &&
      typeof pairValue !== "number"
    ) {
      return "field pair value must be a scalar";
    }
    if (typeof pairValue === "number" && !Number.isFinite(pairValue)) return "field pair number must be finite";
    fields.push({ key: pair.key, value: pairValue });
  }
  if (kind === "new_node") {
    if (target !== null) return "a new node has no target yet";
    if (typeof nodeType !== "string" || !KINDS.has(nodeType)) return "a new node needs a known node type";
  }
  if ((kind === "update" || kind === "new_edge") && typeof target !== "string") {
    return "update and new_edge proposals name a target";
  }
  if (kind === "note" && nodeType !== null) return "a note does not invent a node type";
  return {
    kind,
    target_id: target,
    node_type: nodeType,
    fields,
    text: value.text,
    confidence: value.confidence,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function structuredFieldCount(proposals: readonly DocImportProposal[]): number {
  return proposals.reduce((sum, proposal) => sum + proposal.fields.length, 0);
}

export function isKnownNodeKind(value: string): boolean {
  return KINDS.has(value);
}
