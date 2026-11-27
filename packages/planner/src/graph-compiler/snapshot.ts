import { createHash } from "node:crypto";
import type { CompiledPlanSnapshot, CompiledTaskStamp, CompilationInput, PlanTask } from "./types.js";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort((a, b) => a.localeCompare(b))) {
      const item = record[key];
      if (item !== undefined) sorted[key] = canonicalize(item);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function compiledSliceSha256(task: PlanTask, planEpoch: number): string {
  return sha256Hex(
    canonicalJson({
      featureId: task.featureId,
      handlesEdgeCases: [...task.handlesEdgeCases].sort((a, b) => a.localeCompare(b)),
      implements: [...task.implements].sort((a, b) => a.localeCompare(b)),
      level: task.level,
      mustBandRuleIds: [...task.mustBandRuleIds].sort((a, b) => a.localeCompare(b)),
      mustBandTokens: task.mustBandTokens,
      names: [...task.names]
        .map((name) => ({ kind: name.kind, method: name.method, value: name.value }))
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value)),
      obeys: [...task.obeys].sort((a, b) => a.localeCompare(b)),
      planEpoch,
      primaryFiles: [...task.primaryFiles].sort((a, b) => a.localeCompare(b)),
      taskId: task.id,
      taskKind: task.taskKind,
      touches: [...task.touches].sort((a, b) => a.localeCompare(b)),
      writeScope: [...task.writeScope].sort((a, b) => a.localeCompare(b)),
    }),
  );
}

export function buildSnapshot(
  input: CompilationInput,
  appliedWaivers: readonly string[],
): CompiledPlanSnapshot {
  const tasks: CompiledTaskStamp[] = [...input.tasks]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((task) => ({
      taskId: task.id,
      compiledSliceSha256: compiledSliceSha256(task, input.planEpoch),
      compiledAt: input.compiledAt,
      planEpoch: input.planEpoch,
      passedAllNinePasses: true as const,
      state: "READY" as const,
    }));
  const fingerprint = sha256Hex(
    canonicalJson({
      compiledAt: input.compiledAt,
      passCount: 9,
      planEpoch: input.planEpoch,
      tasks: tasks.map((task) => ({
        compiledSliceSha256: task.compiledSliceSha256,
        taskId: task.taskId,
      })),
    }),
  );
  return {
    fingerprint,
    planEpoch: input.planEpoch,
    compiledAt: input.compiledAt,
    passCount: 9,
    tasks,
    appliedWaivers: [...appliedWaivers].sort((a, b) => a.localeCompare(b)),
  };
}
