import type { HistoryStep, RenderStep, RenderToolCall } from "./types.js";
import { ContextBuildError } from "./types.js";

const READ_TOOLS = new Set(["read_file", "read"]);
const EDIT_TOOLS = new Set([
  "edit",
  "str_replace",
  "apply_patch",
  "search_replace",
  "replace_lines",
  "write_new_file",
]);

export function isReadTool(name: string): boolean {
  return READ_TOOLS.has(name);
}

export function isEditTool(name: string): boolean {
  return EDIT_TOOLS.has(name);
}

export function normalizeRepoPath(path: string): string {
  let value = path.replaceAll("\\", "/");
  while (value.startsWith("./")) value = value.slice(2);
  return value;
}

export function toolPaths(input: unknown): readonly string[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return [];
  const record = input as Record<string, unknown>;
  const found: string[] = [];
  pushPath(found, record.path);
  pushPath(found, record.file);
  pushPathList(found, record.paths);
  pushPathList(found, record.files);
  return found;
}

export function primaryToolPath(input: unknown): string | null {
  return toolPaths(input)[0] ?? null;
}

export function supersededMarker(path: string, step: number): string {
  return `[read of ${path} @ step ${step}, superseded]`;
}

export function supersededToolKeys(steps: readonly HistoryStep[]): ReadonlySet<string> {
  const events: { step: number; path: string; kind: "read" | "edit"; id: string }[] = [];
  for (const step of steps) {
    for (const call of step.toolCalls) {
      const kind = isReadTool(call.name) ? "read" : isEditTool(call.name) ? "edit" : null;
      if (kind === null) continue;
      for (const path of toolPaths(call.input)) {
        events.push({ step: step.step, path: normalizeRepoPath(path), kind, id: call.id });
      }
    }
  }
  const superseded = new Set<string>();
  for (const event of events) {
    if (event.kind !== "read") continue;
    const later = events.some(
      (other) => other.path === event.path && other.step > event.step && (other.kind === "read" || other.kind === "edit"),
    );
    if (later) superseded.add(toolKey(event.step, event.id));
  }
  return superseded;
}

export function toolKey(step: number, id: string): string {
  return `${step}:${id}`;
}

export function assertHistory(steps: readonly HistoryStep[]): void {
  const seenSteps = new Set<number>();
  const seenTools = new Set<string>();
  for (const step of steps) {
    if (!Number.isInteger(step.step) || step.step < 1) {
      throw new ContextBuildError("history step numbers must be positive integers");
    }
    if (seenSteps.has(step.step)) {
      throw new ContextBuildError(`duplicate history step ${step.step}`);
    }
    seenSteps.add(step.step);
    for (const item of step.reasoning) {
      if (item.kind !== "reasoning" || typeof item.opaque !== "string") {
        throw new ContextBuildError(`history step ${step.step} has a malformed reasoning item`);
      }
    }
    for (const call of step.toolCalls) {
      if (call.id.length === 0) throw new ContextBuildError(`history step ${step.step} has an empty tool id`);
      if (seenTools.has(call.id)) throw new ContextBuildError(`duplicate tool id ${call.id}`);
      seenTools.add(call.id);
    }
  }
}

export function orderedSteps(steps: readonly HistoryStep[]): readonly HistoryStep[] {
  return steps.slice().sort((left, right) => left.step - right.step);
}

export function verbatimStepSet(steps: readonly { readonly step: number }[], keep: number): ReadonlySet<number> {
  const numbers = steps.map((step) => step.step);
  const unique = [...new Set(numbers)].sort((left, right) => left - right);
  const tail = unique.slice(Math.max(0, unique.length - Math.max(0, keep)));
  return new Set(tail);
}

export function toRenderSteps(
  steps: readonly HistoryStep[],
  superseded: ReadonlySet<string>,
  modeFor: (step: number) => RenderStep["mode"],
): RenderStep[] {
  return steps.map((step) => ({
    step: step.step,
    assistantText: step.assistantText,
    reasoning: step.reasoning.map((item) => ({ kind: "reasoning" as const, opaque: item.opaque })),
    mode: modeFor(step.step),
    toolCalls: step.toolCalls.map((call) => toRenderCall(step.step, call, superseded)),
  }));
}

function toRenderCall(
  step: number,
  call: HistoryStep["toolCalls"][number],
  superseded: ReadonlySet<string>,
): RenderToolCall {
  const base = {
    id: call.id,
    name: call.name,
    input: call.input,
    resultSummary: call.resultSummary,
    content: call.content,
    artifactIds: [...call.artifactIds],
    superseded: superseded.has(toolKey(step, call.id)),
  };
  return {
    ...base,
    ...(call.symbolOutline !== undefined ? { symbolOutline: call.symbolOutline } : {}),
    ...(call.testFailures !== undefined ? { testFailures: [...call.testFailures] } : {}),
  };
}

export function collapsedToolText(call: RenderToolCall): string {
  const summary = call.resultSummary.trim();
  const missing = call.artifactIds.filter((id) => id.length > 0 && !summary.includes(id));
  if (missing.length === 0) return summary;
  return `${summary} [${missing.join(", ")}]`;
}

function pushPath(found: string[], value: unknown): void {
  if (typeof value === "string" && value.length > 0) found.push(value);
}

function pushPathList(found: string[], value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (typeof item === "string") {
      pushPath(found, item);
      continue;
    }
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      pushPath(found, (item as Record<string, unknown>).path);
    }
  }
}
