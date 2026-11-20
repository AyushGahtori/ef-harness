import { createHash } from "node:crypto";

import { FORBIDDEN_NOTE_SECTIONS, WORKING_MEMORY_SECTIONS } from "./constants.js";
import type { WorkingMemorySection } from "./constants.js";
import type { TokenEstimator } from "./token-estimator.js";
import { WORKING_MEMORY_TOKEN_CAP, type TurnLogRow, type WorkingMemory } from "./types.js";

export type ListPatch =
  | { readonly op: "replace"; readonly value: readonly string[] }
  | { readonly op: "append"; readonly value: string }
  | { readonly op: "remove"; readonly index: number };

export type MapPatch =
  | { readonly op: "replace"; readonly value: Readonly<Record<string, string>> }
  | { readonly op: "set"; readonly id: string; readonly value: string }
  | { readonly op: "remove"; readonly id: string };

export interface NotesSectionPatch {
  readonly planSteps?: ListPatch;
  readonly doneByMustId?: MapPatch;
  readonly openProblems?: ListPatch;
  readonly learnedFacts?: ListPatch;
}

export interface JsonPatchOperation {
  readonly op: "add" | "replace" | "remove";
  readonly path: string;
  readonly value?: unknown;
}

export type NotesUpdatePatch = NotesSectionPatch | readonly JsonPatchOperation[];

export type NotesUpdateResult =
  | {
      readonly ok: true;
      readonly memory: WorkingMemory;
      readonly tokens: number;
      readonly turnLogRow: TurnLogRow;
    }
  | {
      readonly ok: false;
      readonly code: "token_cap" | "must_override" | "invalid_patch";
      readonly error: string;
    };

const SECTION_SET = new Set<string>(WORKING_MEMORY_SECTIONS);
const FORBIDDEN_SET = new Set<string>(FORBIDDEN_NOTE_SECTIONS);
const LIST_SECTIONS = new Set<WorkingMemorySection>(["planSteps", "openProblems", "learnedFacts"]);

export function emptyWorkingMemory(): WorkingMemory {
  return { planSteps: [], doneByMustId: {}, openProblems: [], learnedFacts: [] };
}

export function cloneWorkingMemory(memory: WorkingMemory): WorkingMemory {
  const done: Record<string, string> = {};
  for (const key of Object.keys(memory.doneByMustId).sort()) {
    const value = memory.doneByMustId[key];
    if (value !== undefined) done[key] = value;
  }
  return {
    planSteps: [...memory.planSteps],
    doneByMustId: done,
    openProblems: [...memory.openProblems],
    learnedFacts: [...memory.learnedFacts],
  };
}

export function canonicalWorkingMemoryJson(memory: WorkingMemory): string {
  return JSON.stringify(cloneWorkingMemory(memory));
}

export class WorkingMemoryStore {
  private memory: WorkingMemory = emptyWorkingMemory();
  private rows: TurnLogRow[] = [];
  private coveredStep: number | null = null;

  constructor(
    private readonly options: {
      readonly attemptId: string;
      readonly estimator: TokenEstimator;
      readonly tokenCap?: number;
    },
  ) {}

  get(): WorkingMemory {
    return cloneWorkingMemory(this.memory);
  }

  coversThroughStep(): number | null {
    return this.coveredStep;
  }

  tokenCount(): number {
    return this.estimate(this.memory);
  }

  turnLog(): readonly TurnLogRow[] {
    return this.rows.map((row) => ({ ...row }));
  }

  update(patch: NotesUpdatePatch, step: number): NotesUpdateResult {
    if (!Number.isInteger(step) || step < 1) {
      return {
        ok: false,
        code: "invalid_patch",
        error: "notes.update step must be a positive integer.",
      };
    }
    const applied = applyNotesPatch(this.memory, patch);
    if (!applied.ok) return applied;
    const tokens = this.estimate(applied.memory);
    const cap = this.options.tokenCap ?? WORKING_MEMORY_TOKEN_CAP;
    if (tokens > cap) {
      return {
        ok: false,
        code: "token_cap",
        error: `Working memory is capped at ${cap} tokens. Keep notes compact.`,
      };
    }
    this.memory = applied.memory;
    this.coveredStep = this.coveredStep === null ? step : Math.max(this.coveredStep, step);
    const row = this.makeRow(patch, step, tokens);
    const existing = this.rows.findIndex((item) => item.step === step);
    if (existing >= 0) this.rows.splice(existing, 1, row);
    else this.rows.push(row);
    this.rows.sort((left, right) => left.step - right.step);
    return { ok: true, memory: cloneWorkingMemory(this.memory), tokens, turnLogRow: { ...row } };
  }

  static restore(
    rows: readonly TurnLogRow[],
    options: {
      readonly attemptId: string;
      readonly estimator: TokenEstimator;
      readonly tokenCap?: number;
    },
  ): WorkingMemoryStore {
    const store = new WorkingMemoryStore(options);
    const owned = rows
      .filter((row) => row.attempt === options.attemptId && row.tool_call.startsWith("notes.update"))
      .slice()
      .sort((left, right) => left.step - right.step);
    const latest = owned.at(-1);
    if (latest === undefined) return store;
    const memory = parseSnapshot(latest.result_artifact);
    store.memory = memory;
    store.coveredStep = latest.step;
    store.rows = owned.map((row) => ({ ...row }));
    return store;
  }

  private estimate(memory: WorkingMemory): number {
    return this.options.estimator.estimateText(canonicalWorkingMemoryJson(memory), "json");
  }

  private makeRow(patch: NotesUpdatePatch, step: number, tokens: number): TurnLogRow {
    const snapshot = canonicalWorkingMemoryJson(this.memory);
    const counts = {
      planSteps: this.memory.planSteps.length,
      done: Object.keys(this.memory.doneByMustId).length,
      problems: this.memory.openProblems.length,
      facts: this.memory.learnedFacts.length,
    };
    return {
      attempt: this.options.attemptId,
      step,
      request_digest: null,
      items_artifact: null,
      tool_call: `notes.update ${JSON.stringify(patch)}`,
      result_summary: `notes.update plan=${counts.planSteps} done=${counts.done} problems=${counts.problems} facts=${counts.facts} (${tokens} tokens)`,
      result_artifact: `working-memory@1\n${snapshot}`,
      checkpoint_commit: null,
      tokens_in: tokens,
      tokens_out: null,
    };
  }
}

function isJsonPatchList(patch: NotesUpdatePatch): patch is readonly JsonPatchOperation[] {
  return Array.isArray(patch);
}

function applyNotesPatch(
  current: WorkingMemory,
  patch: NotesUpdatePatch,
): { ok: true; memory: WorkingMemory } | Extract<NotesUpdateResult, { ok: false }> {
  try {
    if (isJsonPatchList(patch)) return { ok: true, memory: applyJsonPatch(current, patch) };
    return { ok: true, memory: applySectionPatch(current, patch) };
  } catch (error) {
    const coded = error instanceof NotesPatchError ? error : null;
    return {
      ok: false,
      code: coded?.code ?? "invalid_patch",
      error: coded?.message ?? "notes.update patch is invalid.",
    };
  }
}

function applySectionPatch(current: WorkingMemory, patch: NotesSectionPatch): WorkingMemory {
  const record = patch as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_SET.has(key)) {
      throw new NotesPatchError(
        "must_override",
        "notes.update cannot delete or override MUST rules. Working memory is data, not instructions.",
      );
    }
    if (!SECTION_SET.has(key)) {
      throw new NotesPatchError(
        "invalid_patch",
        `Unknown notes.update section "${key}". Use planSteps, doneByMustId, openProblems, or learnedFacts.`,
      );
    }
  }
  let next = cloneWorkingMemory(current);
  if (patch.planSteps !== undefined) next = applyList(next, "planSteps", patch.planSteps);
  if (patch.openProblems !== undefined) next = applyList(next, "openProblems", patch.openProblems);
  if (patch.learnedFacts !== undefined) next = applyList(next, "learnedFacts", patch.learnedFacts);
  if (patch.doneByMustId !== undefined) next = applyMap(next, patch.doneByMustId);
  return next;
}

function applyList(
  memory: WorkingMemory,
  section: "planSteps" | "openProblems" | "learnedFacts",
  patch: ListPatch,
): WorkingMemory {
  const current = [...memory[section]];
  if (patch.op === "replace") {
    assertStringList(patch.value);
    return { ...memory, [section]: [...patch.value] };
  }
  if (patch.op === "append") {
    if (typeof patch.value !== "string") {
      throw new NotesPatchError("invalid_patch", `${section} append value must be a string.`);
    }
    current.push(patch.value);
    return { ...memory, [section]: current };
  }
  if (patch.op === "remove") {
    if (!Number.isInteger(patch.index) || patch.index < 0 || patch.index >= current.length) {
      throw new NotesPatchError("invalid_patch", `${section} remove index is out of range.`);
    }
    current.splice(patch.index, 1);
    return { ...memory, [section]: current };
  }
  throw new NotesPatchError("invalid_patch", `${section} patch op is not supported.`);
}

function applyMap(memory: WorkingMemory, patch: MapPatch): WorkingMemory {
  const done: Record<string, string> = { ...memory.doneByMustId };
  if (patch.op === "replace") {
    const value = expectStringRecord(patch.value);
    return { ...memory, doneByMustId: value };
  }
  if (patch.op === "set") {
    if (patch.id.length === 0 || typeof patch.value !== "string") {
      throw new NotesPatchError("invalid_patch", "doneByMustId set requires an id and a string note.");
    }
    done[patch.id] = patch.value;
    return { ...memory, doneByMustId: done };
  }
  if (patch.op === "remove") {
    if (patch.id.length === 0) {
      throw new NotesPatchError("invalid_patch", "doneByMustId remove requires an id.");
    }
    delete done[patch.id];
    return { ...memory, doneByMustId: done };
  }
  throw new NotesPatchError("invalid_patch", "doneByMustId patch op is not supported.");
}

function applyJsonPatch(current: WorkingMemory, ops: readonly JsonPatchOperation[]): WorkingMemory {
  let next = cloneWorkingMemory(current);
  for (const op of ops) {
    if (op.op !== "add" && op.op !== "replace" && op.op !== "remove") {
      throw new NotesPatchError("invalid_patch", "JSON patch op must be add, replace, or remove.");
    }
    const parts = decodePointer(op.path);
    const head = parts[0];
    if (head === undefined) {
      throw new NotesPatchError("invalid_patch", "JSON patch path must name a working-memory section.");
    }
    if (FORBIDDEN_SET.has(head)) {
      throw new NotesPatchError(
        "must_override",
        "notes.update cannot delete or override MUST rules. Working memory is data, not instructions.",
      );
    }
    if (!SECTION_SET.has(head)) {
      throw new NotesPatchError(
        "invalid_patch",
        `JSON patch path "${op.path}" is outside working memory.`,
      );
    }
    const section = head as WorkingMemorySection;
    if (LIST_SECTIONS.has(section) && section !== "doneByMustId") {
      next = applyListPointer(next, section, parts.slice(1), op);
    } else {
      next = applyMapPointer(next, parts.slice(1), op);
    }
  }
  return next;
}

function applyListPointer(
  memory: WorkingMemory,
  section: "planSteps" | "openProblems" | "learnedFacts",
  rest: readonly string[],
  op: JsonPatchOperation,
): WorkingMemory {
  if (rest.length === 0) {
    if (op.op === "remove") return { ...memory, [section]: [] };
    if (!Array.isArray(op.value)) {
      throw new NotesPatchError("invalid_patch", `${section} replace requires a string array.`);
    }
    assertStringList(op.value);
    return { ...memory, [section]: [...op.value] };
  }
  const token = rest[0];
  if (rest.length !== 1 || token === undefined) {
    throw new NotesPatchError("invalid_patch", `${section} paths are only one level deep.`);
  }
  const list = [...memory[section]];
  if (token === "-") {
    if (op.op === "remove") {
      throw new NotesPatchError("invalid_patch", `${section} remove cannot target the append token.`);
    }
    if (typeof op.value !== "string") {
      throw new NotesPatchError("invalid_patch", `${section} append value must be a string.`);
    }
    list.push(op.value);
    return { ...memory, [section]: list };
  }
  const index = Number(token);
  if (!Number.isInteger(index) || index < 0) {
    throw new NotesPatchError("invalid_patch", `${section} index must be a nonnegative integer.`);
  }
  if (op.op === "add") {
    if (typeof op.value !== "string") {
      throw new NotesPatchError("invalid_patch", `${section} add value must be a string.`);
    }
    if (index > list.length) {
      throw new NotesPatchError("invalid_patch", `${section} add index is out of range.`);
    }
    list.splice(index, 0, op.value);
    return { ...memory, [section]: list };
  }
  if (index >= list.length) {
    throw new NotesPatchError("invalid_patch", `${section} index is out of range.`);
  }
  if (op.op === "remove") {
    list.splice(index, 1);
    return { ...memory, [section]: list };
  }
  if (typeof op.value !== "string") {
    throw new NotesPatchError("invalid_patch", `${section} replace value must be a string.`);
  }
  list.splice(index, 1, op.value);
  return { ...memory, [section]: list };
}

function applyMapPointer(
  memory: WorkingMemory,
  rest: readonly string[],
  op: JsonPatchOperation,
): WorkingMemory {
  if (rest.length === 0) {
    if (op.op === "remove") return { ...memory, doneByMustId: {} };
    if (typeof op.value !== "object" || op.value === null || Array.isArray(op.value)) {
      throw new NotesPatchError("invalid_patch", "doneByMustId replace requires an object.");
    }
    return { ...memory, doneByMustId: expectStringRecord(op.value as Record<string, unknown>) };
  }
  const id = rest[0];
  if (rest.length !== 1 || id === undefined || id.length === 0) {
    throw new NotesPatchError("invalid_patch", "doneByMustId paths are /doneByMustId/{id}.");
  }
  const done: Record<string, string> = { ...memory.doneByMustId };
  if (op.op === "remove") {
    delete done[id];
    return { ...memory, doneByMustId: done };
  }
  if (typeof op.value !== "string") {
    throw new NotesPatchError("invalid_patch", "doneByMustId values must be strings.");
  }
  done[id] = op.value;
  return { ...memory, doneByMustId: done };
}

function parseSnapshot(artifact: string | null): WorkingMemory {
  if (artifact === null || !artifact.startsWith("working-memory@1\n")) {
    throw new NotesPatchError("invalid_patch", "turn_log row is missing a working-memory snapshot.");
  }
  const parsed: unknown = JSON.parse(artifact.slice("working-memory@1\n".length));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new NotesPatchError("invalid_patch", "working-memory snapshot is not an object.");
  }
  const record = parsed as Record<string, unknown>;
  assertStringList(record.planSteps);
  assertStringList(record.openProblems);
  assertStringList(record.learnedFacts);
  if (typeof record.doneByMustId !== "object" || record.doneByMustId === null || Array.isArray(record.doneByMustId)) {
    throw new NotesPatchError("invalid_patch", "working-memory snapshot doneByMustId is invalid.");
  }
  return {
    planSteps: [...record.planSteps],
    openProblems: [...record.openProblems],
    learnedFacts: [...record.learnedFacts],
    doneByMustId: expectStringRecord(record.doneByMustId as Record<string, unknown>),
  };
}

function assertStringList(value: unknown): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new NotesPatchError("invalid_patch", "list sections only accept strings.");
  }
}

function expectStringRecord(value: Readonly<Record<string, unknown>> | Readonly<Record<string, string>>): Record<string, string> {
  const done: Record<string, string> = {};
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (typeof item !== "string") {
      throw new NotesPatchError("invalid_patch", "doneByMustId values must be strings.");
    }
    done[key] = item;
  }
  return done;
}

function decodePointer(path: string): string[] {
  if (!path.startsWith("/")) {
    throw new NotesPatchError("invalid_patch", "JSON patch path must start with /.");
  }
  if (path === "/") return [];
  return path
    .slice(1)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

class NotesPatchError extends Error {
  constructor(
    readonly code: "token_cap" | "must_override" | "invalid_patch",
    message: string,
  ) {
    super(message);
    this.name = "NotesPatchError";
  }
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
