import { CcrError } from "./errors.js";
import type { CcrV1, CcrV1Change, DiffOp } from "./types.js";

const STATUSES = new Set(["open", "approved", "rejected", "applied"]);
const CLASSES = new Set(["additive", "breaking"]);
const CHANGE_KEYS = [
  "add_column",
  "add_field",
  "add_endpoint",
  "add_enum_value",
  "add_ui_variant",
  "breaking",
  "semantic",
] as const;

const ID_MAX = 128;
const TARGET_MAX = 256;
const REASON_MAX = 4_096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string, max: number): string {
  const value = record[key];
  if (typeof value !== "string" || value.length < 1 || value.length > max) {
    throw new CcrError("ccr_v1_invalid", `${key} must be a non-empty string within ${max} characters`);
  }
  return value;
}

function rejectExtra(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new CcrError("ccr_v1_invalid", `${label} rejects unknown field ${key}`);
    }
  }
}

function parseAddColumn(value: unknown): CcrV1Change {
  if (!isRecord(value)) throw new CcrError("ccr_v1_invalid", "add_column must be an object");
  rejectExtra(value, ["name", "type", "nullable"], "add_column");
  const name = readString(value, "name", ID_MAX);
  const type = readString(value, "type", 64);
  if (typeof value.nullable !== "boolean") {
    throw new CcrError("ccr_v1_invalid", "add_column.nullable must be a boolean");
  }
  return { add_column: { name, type, nullable: value.nullable } };
}

function parseLabeled(key: string, value: unknown): CcrV1Change {
  if (!isRecord(value)) throw new CcrError("ccr_v1_invalid", `${key} must be an object`);
  if (key === "add_field") {
    rejectExtra(value, ["name", "optional"], key);
    if (value.optional !== true) throw new CcrError("ccr_v1_invalid", "add_field.optional must be true");
    return { add_field: { name: readString(value, "name", ID_MAX), optional: true } };
  }
  if (key === "add_endpoint" || key === "add_enum_value" || key === "add_ui_variant") {
    rejectExtra(value, ["name"], key);
    const name = readString(value, "name", TARGET_MAX);
    if (key === "add_endpoint") return { add_endpoint: { name } };
    if (key === "add_enum_value") return { add_enum_value: { name } };
    return { add_ui_variant: { name } };
  }
  rejectExtra(value, ["summary"], key);
  const summary = readString(value, "summary", REASON_MAX);
  if (key === "breaking") return { breaking: { summary } };
  return { semantic: { summary } };
}

export function parseCcrV1(value: unknown): CcrV1 {
  if (!isRecord(value)) throw new CcrError("ccr_v1_invalid", "ccr@1 must be an object");
  rejectExtra(value, ["schema", "id", "from_feature", "target", "change", "reason", "class", "status"], "ccr@1");
  if (value.schema !== "ccr@1") throw new CcrError("ccr_v1_invalid", "schema must be ccr@1");
  const id = readString(value, "id", ID_MAX);
  const fromFeature = readString(value, "from_feature", ID_MAX);
  const target = readString(value, "target", TARGET_MAX);
  const reason = readString(value, "reason", REASON_MAX);
  if (typeof value.class !== "string" || !CLASSES.has(value.class)) {
    throw new CcrError("ccr_v1_invalid", "class must be additive or breaking");
  }
  if (typeof value.status !== "string" || !STATUSES.has(value.status)) {
    throw new CcrError("ccr_v1_invalid", "status is not a ccr@1 status");
  }
  if (!isRecord(value.change)) throw new CcrError("ccr_v1_invalid", "change must be an object");
  const changeKeys = Object.keys(value.change);
  if (changeKeys.length !== 1 || !CHANGE_KEYS.includes(changeKeys[0] as (typeof CHANGE_KEYS)[number])) {
    throw new CcrError("ccr_v1_invalid", "change must set exactly one known key");
  }
  const key = changeKeys[0] as (typeof CHANGE_KEYS)[number];
  const change = key === "add_column" ? parseAddColumn(value.change.add_column) : parseLabeled(key, value.change[key]);
  return {
    schema: "ccr@1",
    id,
    from_feature: fromFeature,
    target,
    change,
    reason,
    class: value.class as CcrV1["class"],
    status: value.status as CcrV1["status"],
  };
}

export function changeFromOps(ops: readonly DiffOp[], semanticSummary: string | null): CcrV1Change {
  const breaking = ops.filter((op) => op.breaking);
  if (semanticSummary && breaking.length === 0 && ops.length === 0) {
    return { semantic: { summary: semanticSummary } };
  }
  if (breaking.length > 0 || semanticSummary) {
    const summary = [...breaking.map((op) => op.detail), semanticSummary ?? ""].filter((part) => part.length > 0).join("; ");
    return { breaking: { summary } };
  }
  if (ops.length === 1) {
    const op = ops[0];
    if (!op) return { breaking: { summary: "empty diff" } };
    if (op.kind === "add_nullable_column" || op.kind === "add_defaulted_column") {
      return {
        add_column: {
          name: op.payload.column ?? "column",
          type: (op.payload.type ?? "text").toLowerCase(),
          nullable: op.payload.nullable === "true",
        },
      };
    }
    if (op.kind === "add_optional_field") return { add_field: { name: op.payload.name ?? "field", optional: true } };
    if (op.kind === "add_endpoint") return { add_endpoint: { name: op.payload.name ?? "endpoint" } };
    if (op.kind === "add_output_enum_value") return { add_enum_value: { name: op.payload.name ?? "enum" } };
    if (op.kind === "add_optional_ui_variant") return { add_ui_variant: { name: op.payload.name ?? "variant" } };
  }
  const column = ops.find((op) => op.kind === "add_nullable_column" || op.kind === "add_defaulted_column");
  if (column && ops.every((op) => !op.breaking)) {
    return {
      add_column: {
        name: column.payload.column ?? "column",
        type: (column.payload.type ?? "text").toLowerCase(),
        nullable: column.payload.nullable === "true",
      },
    };
  }
  const named = ops.find((op) => op.payload.name);
  return { add_field: { name: named?.payload.name ?? "contract", optional: true } };
}

export function buildCcrV1(input: {
  readonly id: string;
  readonly fromFeature: string;
  readonly target: string;
  readonly reason: string;
  readonly classification: "ADDITIVE" | "BREAKING";
  readonly status: CcrV1["status"];
  readonly ops: readonly DiffOp[];
  readonly semanticSummary: string | null;
}): CcrV1 {
  const document = {
    schema: "ccr@1" as const,
    id: input.id,
    from_feature: input.fromFeature,
    target: input.target,
    change: changeFromOps(input.ops, input.semanticSummary),
    reason: input.reason,
    class: input.classification === "ADDITIVE" ? ("additive" as const) : ("breaking" as const),
    status: input.status,
  };
  return parseCcrV1(document);
}
