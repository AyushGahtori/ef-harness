import {
  EDIT_TOOL_NAMES,
  NATIVE_TOOL_CATALOG,
  SUBAGENT_TOOL_NAMES,
  type EditFormat,
  type ModelFailureKind,
  type TurnFailureView,
} from "./types.js";

const FAILURE_KINDS = new Set<string>([
  "auth",
  "rate_limit",
  "usage_limit",
  "billing",
  "overloaded",
  "context_overflow",
  "stream_stall",
  "unknown_timeout",
  "malformed_request",
  "unknown",
]);

const TOOL_ALIASES: Record<string, string> = {
  read: "read_file",
  read_file: "read_file",
  list: "list",
  list_files: "list",
  grep: "grep",
  grep_files: "grep",
  run: "harness.run",
  "harness.run": "harness.run",
  read_log: "harness.read_log",
  "harness.read_log": "harness.read_log",
  "notes.update": "notes.update",
  ask_owner: "harness.ask_owner",
  "harness.ask_owner": "harness.ask_owner",
  flag_blocked: "harness.flag_blocked",
  "harness.flag_blocked": "harness.flag_blocked",
  dispute_test: "harness.dispute_test",
  "harness.dispute_test": "harness.dispute_test",
  submit_candidate: "harness.submit_candidate",
  "harness.submit_candidate": "harness.submit_candidate",
  apply_patch: "apply_patch",
  str_replace: "str_replace",
  search_replace: "search_replace",
  write_new_file: "write_new_file",
  replace_lines: "replace_lines",
  "kb.search": "kb.search",
  "kb.get": "kb.get",
  "kb.neighbors": "kb.neighbors",
  "kb.contract": "kb.contract",
  "kb.why": "kb.why",
  "kb.code": "kb.code",
};

const EDIT_TOOL_SET = new Set<string>(EDIT_TOOL_NAMES);
const CATALOG_SET = new Set<string>(NATIVE_TOOL_CATALOG);
const SUBAGENT_SET = new Set<string>(SUBAGENT_TOOL_NAMES);

const DONE_PATTERN =
  /\b(i'm done|i am done|im done|i’m done|task is complete|all done)\b/i;
const CODE_FENCE = /```/;

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function canonicalJson(value: unknown): string {
  return stableStringify(value);
}

export function canonicalToolName(name: string, editFormat: EditFormat): string {
  if (name === "edit") return editFormat;
  return TOOL_ALIASES[name] ?? name;
}

export function isSubagentTool(name: string): boolean {
  return SUBAGENT_SET.has(name);
}

export function isEditTool(name: string): boolean {
  return EDIT_TOOL_SET.has(name);
}

export function isCatalogTool(name: string): boolean {
  return CATALOG_SET.has(name);
}

export function allowedTools(packetTools: readonly string[], editFormat: EditFormat): string[] {
  const allowed = new Set<string>();
  for (const tool of packetTools) {
    if (isSubagentTool(tool)) continue;
    const canonical = canonicalToolName(tool, editFormat);
    if (isSubagentTool(canonical) || !isCatalogTool(canonical)) continue;
    allowed.add(canonical);
  }
  return [...allowed].sort();
}

export function toolCallRecord(name: string, args: Record<string, unknown>): string {
  return `${name} ${stableStringify(args)}`;
}

export function repeatSignature(toolCall: string, resultSummary: string): string {
  return `${toolCall}\n${resultSummary}`;
}

export function pathInScope(file: string, globs: readonly string[]): boolean {
  const target = file.replaceAll("\\", "/");
  return globs.some((pattern) => matchGlob(pattern.replaceAll("\\", "/"), target));
}

export function containsCodeFence(text: string): boolean {
  return CODE_FENCE.test(text);
}

export function isPrematureDoneClaim(text: string): boolean {
  return DONE_PATTERN.test(text);
}

export function repairMessage(error: string, allowed: readonly string[]): string {
  return `Tool call rejected: ${error}. Available tools: ${allowed.join(", ")}.`;
}

export function readTurnFailure(error: unknown): TurnFailureView | null {
  if (typeof error !== "object" || error === null || !("kind" in error)) return null;
  const kind = (error as { kind?: unknown }).kind;
  if (typeof kind !== "string" || !FAILURE_KINDS.has(kind)) return null;
  const record = error as {
    retryAfterMs?: unknown;
    isProviderSchedulingError?: unknown;
    clientRequestId?: unknown;
    partialUsage?: { inputTokens?: unknown; outputTokens?: unknown } | null;
  };
  const partial = record.partialUsage;
  return {
    kind: kind as ModelFailureKind,
    retryAfterMs: typeof record.retryAfterMs === "number" ? record.retryAfterMs : null,
    isProviderSchedulingError: record.isProviderSchedulingError === true,
    clientRequestId: typeof record.clientRequestId === "string" ? record.clientRequestId : "",
    partialTokensIn: typeof partial?.inputTokens === "number" ? partial.inputTokens : 0,
    partialTokensOut: typeof partial?.outputTokens === "number" ? partial.outputTokens : 0,
  };
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function isEditStuckError(error: unknown): error is Error {
  return error instanceof Error && error.name === "EditStuckEscalation";
}

export function stringField(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" ? value : null;
}

export function acknowledgesSteer(text: string, steerId: string): boolean {
  if (text.includes(`ack:${steerId}`)) return true;
  return /\backnowledg(?:e|ed|ing|ement)\b/i.test(text);
}

function matchGlob(pattern: string, file: string): boolean {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return file === prefix || file.startsWith(`${prefix}/`);
  }
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*");
  return new RegExp(`^${escaped}$`).test(file);
}
