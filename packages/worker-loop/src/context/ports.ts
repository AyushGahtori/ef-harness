/**
 * Local ports for sibling contracts that are not on this branch.
 *
 * Swap map (recorded in the Task 054 handoff):
 * - `TaskPacketV1` / `parseTaskPacketV1` -> Task 008 `TaskPacketV1Schema`
 * - `buildPromptEnvelope` / `escapeProvenanceText` -> Task 009 `buildPromptEnvelope`
 * - `validateTurnSummarizerV1` -> Task 009 `TurnSummarizerV1Schema`
 * - `ModelProfile` / `parseModelProfile` -> Task 053 `ModelProfile`
 */

import { ContextBuildError } from "./types.js";

export type ModelFamily = "openai" | "anthropic" | "gemini" | "openai_compatible" | "local";

export type EditFormat = "apply_patch" | "str_replace" | "search_replace";

export interface ModelProfile {
  readonly id: string;
  readonly family: ModelFamily;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly editFormat: EditFormat;
  readonly supportsParallelToolCalls: boolean;
  readonly supportsReasoningReplay: boolean;
  readonly supportsStreamingToolArgs: boolean;
  readonly toolCallReliabilityTier: number;
  readonly supportsPromptCaching: boolean;
  readonly routeConstraints: readonly string[];
}

export interface TaskPacketBase {
  readonly branch: string;
  readonly commit: string;
}

export interface TaskMustItem {
  readonly id: string;
  readonly v: number;
  readonly text: string;
}

export interface TaskContractRef {
  readonly id: string;
  readonly v: number;
  readonly role: "consume" | "produce";
  readonly text?: string;
}

export type ShouldKind = "convention" | "research" | "dependency" | "design_token" | "module_card";

export type ShouldEntry =
  | string
  | {
      readonly id?: string;
      readonly kind?: ShouldKind;
      readonly text: string;
    };

export interface TaskSkillPin {
  readonly id: string;
  readonly digest: string;
}

export interface TaskPacketBudget {
  readonly usd_micro: number;
  readonly allowance_ppm: Readonly<Record<string, number>>;
  readonly local_slots: number;
}

export interface TaskPacketLimits {
  readonly wall_min: number;
  readonly max_steps: number;
}

export interface TaskPacketV1 {
  readonly schema: "task-packet@1";
  readonly task: string;
  readonly attempt: number;
  readonly epoch: number;
  readonly brief_version: number;
  readonly base: TaskPacketBase;
  readonly goal: string;
  readonly write_scope: readonly string[];
  readonly must: readonly TaskMustItem[];
  readonly contracts: readonly TaskContractRef[];
  readonly checks_visible: readonly string[];
  readonly checks_hidden_count: number;
  readonly should: readonly ShouldEntry[];
  readonly skills: readonly TaskSkillPin[];
  readonly tools: readonly string[];
  readonly budget: TaskPacketBudget;
  readonly limits: TaskPacketLimits;
}

export type EnvelopeBlock =
  | { readonly kind: "instruction"; readonly source: string; readonly text: string }
  | { readonly kind: "user"; readonly text: string }
  | {
      readonly kind: "data";
      readonly source: string;
      readonly trust: "untrusted" | "kernel";
      readonly text: string;
    };

export interface TurnSummarizerTurn {
  readonly step: number;
  readonly assistantText: string;
  readonly tools: readonly {
    readonly name: string;
    readonly resultSummary: string;
    readonly artifactIds: readonly string[];
  }[];
}

export interface TurnSummarizerRequest {
  readonly contractId: "turn-summarizer@1";
  readonly tokenBudget: number;
  readonly mustIds: readonly string[];
  readonly workingMemoryJson: string;
  readonly oldTurns: readonly TurnSummarizerTurn[];
}

export type TurnSummarizer = (input: TurnSummarizerRequest) => unknown;

export type TurnSummarizerValidation =
  | { readonly ok: true; readonly progressNote: string }
  | { readonly ok: false; readonly reason: string };

const FAMILIES = new Set<ModelFamily>([
  "openai",
  "anthropic",
  "gemini",
  "openai_compatible",
  "local",
]);

const EDIT_FORMATS = new Set<EditFormat>(["apply_patch", "str_replace", "search_replace"]);

const SHOULD_KINDS = new Set<ShouldKind>([
  "convention",
  "research",
  "dependency",
  "design_token",
  "module_card",
]);

export function escapeProvenanceText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function buildPromptEnvelope(blocks: readonly EnvelopeBlock[]): string {
  return blocks.map(renderEnvelopeBlock).join("\n");
}

function renderEnvelopeBlock(block: EnvelopeBlock): string {
  if (block.kind === "instruction") {
    return `<instruction source="${escapeAttribute(block.source)}">\n${escapeProvenanceText(block.text)}\n</instruction>`;
  }
  if (block.kind === "user") {
    return `<user>\n${escapeProvenanceText(block.text)}\n</user>`;
  }
  return `<data source="${escapeAttribute(block.source)}" trust="${block.trust}">\n${escapeProvenanceText(block.text)}\n</data>`;
}

function escapeAttribute(value: string): string {
  return escapeProvenanceText(value).replaceAll('"', "&quot;");
}

export function validateTurnSummarizerV1(
  value: unknown,
  tokenBudget: number,
  estimate: (text: string) => number,
): TurnSummarizerValidation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "turn-summarizer@1 output must be an object" };
  }
  const record = value as Record<string, unknown>;
  if (record.blocked === true) {
    return { ok: false, reason: "turn-summarizer@1 returned blocked" };
  }
  const allowed = new Set(["schema", "progress_note"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      return { ok: false, reason: `turn-summarizer@1 rejected unknown field ${key}` };
    }
  }
  if (record.schema !== undefined && record.schema !== "turn-summarizer@1") {
    return { ok: false, reason: "turn-summarizer@1 schema tag mismatch" };
  }
  if (typeof record.progress_note !== "string" || record.progress_note.trim().length === 0) {
    return { ok: false, reason: "turn-summarizer@1 progress_note must be a non-empty string" };
  }
  const tokens = estimate(record.progress_note);
  if (tokens > tokenBudget) {
    return {
      ok: false,
      reason: `turn-summarizer@1 progress_note is ${tokens} tokens, over the ${tokenBudget} token cap`,
    };
  }
  return { ok: true, progressNote: record.progress_note };
}

export function parseModelProfile(value: unknown): ModelProfile {
  const record = expectRecord(value, "model profile");
  const family = expectString(record, "family");
  if (!FAMILIES.has(family as ModelFamily)) {
    throw new ContextBuildError(`unsupported model family ${family}`);
  }
  const editFormat = expectString(record, "editFormat");
  if (!EDIT_FORMATS.has(editFormat as EditFormat)) {
    throw new ContextBuildError(`unsupported edit format ${editFormat}`);
  }
  const routeConstraints = expectStringArray(record, "routeConstraints");
  return {
    id: expectString(record, "id"),
    family: family as ModelFamily,
    contextWindow: expectPositiveInt(record, "contextWindow"),
    maxOutputTokens: expectNonnegativeInt(record, "maxOutputTokens"),
    editFormat: editFormat as EditFormat,
    supportsParallelToolCalls: expectBoolean(record, "supportsParallelToolCalls"),
    supportsReasoningReplay: expectBoolean(record, "supportsReasoningReplay"),
    supportsStreamingToolArgs: expectBoolean(record, "supportsStreamingToolArgs"),
    toolCallReliabilityTier: expectNonnegativeInt(record, "toolCallReliabilityTier"),
    supportsPromptCaching: expectBoolean(record, "supportsPromptCaching"),
    routeConstraints,
  };
}

export function parseTaskPacketV1(value: unknown): TaskPacketV1 {
  const record = expectRecord(value, "task packet");
  if (record.schema !== "task-packet@1") {
    throw new ContextBuildError("packet schema must be task-packet@1");
  }
  const base = expectRecord(record.base, "task packet base");
  return {
    schema: "task-packet@1",
    task: expectString(record, "task"),
    attempt: expectNonnegativeInt(record, "attempt"),
    epoch: expectNonnegativeInt(record, "epoch"),
    brief_version: expectNonnegativeInt(record, "brief_version"),
    base: {
      branch: expectString(base, "branch"),
      commit: expectString(base, "commit"),
    },
    goal: expectString(record, "goal"),
    write_scope: expectStringArray(record, "write_scope"),
    must: expectMust(record.must),
    contracts: expectContracts(record.contracts),
    checks_visible: expectStringArray(record, "checks_visible"),
    checks_hidden_count: expectNonnegativeInt(record, "checks_hidden_count"),
    should: expectShould(record.should),
    skills: expectSkills(record.skills),
    tools: expectStringArray(record, "tools"),
    budget: expectBudget(record.budget),
    limits: expectLimits(record.limits),
  };
}

function expectMust(value: unknown): readonly TaskMustItem[] {
  if (!Array.isArray(value)) throw new ContextBuildError("task packet must must be an array");
  return value.map((item) => {
    const record = expectRecord(item, "must item");
    return {
      id: expectString(record, "id"),
      v: expectNonnegativeInt(record, "v"),
      text: expectString(record, "text"),
    };
  });
}

function expectContracts(value: unknown): readonly TaskContractRef[] {
  if (!Array.isArray(value)) throw new ContextBuildError("task packet contracts must be an array");
  return value.map((item) => {
    const record = expectRecord(item, "contract");
    const role = expectString(record, "role");
    if (role !== "consume" && role !== "produce") {
      throw new ContextBuildError("contract role must be consume or produce");
    }
    const text = record.text;
    if (text !== undefined && typeof text !== "string") {
      throw new ContextBuildError("contract text must be a string");
    }
    return text === undefined
      ? { id: expectString(record, "id"), v: expectNonnegativeInt(record, "v"), role }
      : { id: expectString(record, "id"), v: expectNonnegativeInt(record, "v"), role, text };
  });
}

function expectShould(value: unknown): readonly ShouldEntry[] {
  if (!Array.isArray(value)) throw new ContextBuildError("task packet should must be an array");
  return value.map((item) => {
    if (typeof item === "string") return item;
    const record = expectRecord(item, "should item");
    const kind = record.kind;
    if (kind !== undefined && (typeof kind !== "string" || !SHOULD_KINDS.has(kind as ShouldKind))) {
      throw new ContextBuildError("should kind is not a known band");
    }
    const id = record.id;
    if (id !== undefined && typeof id !== "string") {
      throw new ContextBuildError("should id must be a string");
    }
    const text = expectString(record, "text");
    return {
      ...(typeof id === "string" ? { id } : {}),
      ...(typeof kind === "string" ? { kind: kind as ShouldKind } : {}),
      text,
    };
  });
}

function expectSkills(value: unknown): readonly TaskSkillPin[] {
  if (!Array.isArray(value)) throw new ContextBuildError("task packet skills must be an array");
  return value.map((item) => {
    const record = expectRecord(item, "skill");
    return { id: expectString(record, "id"), digest: expectString(record, "digest") };
  });
}

function expectBudget(value: unknown): TaskPacketBudget {
  const record = expectRecord(value, "budget");
  const allowance = expectRecord(record.allowance_ppm, "allowance_ppm");
  const allowancePpm: Record<string, number> = {};
  for (const key of Object.keys(allowance)) {
    const raw = allowance[key];
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
      throw new ContextBuildError("allowance ppm values must be nonnegative integers");
    }
    allowancePpm[key] = raw;
  }
  return {
    usd_micro: expectNonnegativeInt(record, "usd_micro"),
    allowance_ppm: allowancePpm,
    local_slots: expectNonnegativeInt(record, "local_slots"),
  };
}

function expectLimits(value: unknown): TaskPacketLimits {
  const record = expectRecord(value, "limits");
  return {
    wall_min: expectNonnegativeInt(record, "wall_min"),
    max_steps: expectNonnegativeInt(record, "max_steps"),
  };
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContextBuildError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ContextBuildError(`${key} must be a non-empty string`);
  }
  return value;
}

function expectBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw new ContextBuildError(`${key} must be a boolean`);
  return value;
}

function expectNonnegativeInt(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ContextBuildError(`${key} must be a nonnegative integer`);
  }
  return value;
}

function expectPositiveInt(record: Record<string, unknown>, key: string): number {
  const value = expectNonnegativeInt(record, key);
  if (value <= 0) throw new ContextBuildError(`${key} must be a positive integer`);
  return value;
}

function expectStringArray(record: Record<string, unknown>, key: string): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ContextBuildError(`${key} must be an array of strings`);
  }
  return value;
}
