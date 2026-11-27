import {
  DeterministicGraphCompiler,
  normalizeWritePattern,
  patternsOverlap,
  type CompilationDiagnostic,
  type CompilationInput,
  type PlanTask,
} from "../graph-compiler/index.js";
import type { ScheduleGraph } from "./types.js";

export { patternsOverlap };

const defaultCompiler = new DeterministicGraphCompiler();
const DEFAULT_COMPILED_AT = "1970-01-01T00:00:00Z";

function stubPlanTask(
  id: string,
  featureId: string,
  writeScope: readonly string[],
  dependsOn: readonly string[] = [],
): PlanTask {
  return {
    id,
    featureId,
    title: id,
    taskKind: "integration",
    level: "junior",
    writeScope,
    primaryFiles: [],
    responsibilities: [],
    touches: [],
    mustBandTokens: 0,
    mustTokenAttribution: [],
    mustBandRuleIds: [],
    implements: [],
    obeys: [],
    handlesEdgeCases: [],
    dependsOn,
    names: [],
    mutatesSharedContract: false,
    createsMigration: false,
    migrationIntentSlot: null,
    estimatedMinCostMicroUsd: 0,
    generatedScaffold: false,
  };
}

function pairCompilationInput(
  left: readonly string[],
  right: readonly string[],
): CompilationInput {
  return {
    tasks: [
      stubPlanTask("left", "feature-left", left),
      stubPlanTask("right", "feature-right", right),
    ],
    features: [
      { id: "feature-left", title: "left", dependsOn: [], active: true },
      { id: "feature-right", title: "right", dependsOn: [], active: true },
    ],
    requirements: [],
    checks: [],
    contradictions: [],
    brownfieldNames: [],
    mustAsk: [],
    budget: { remainingProjectMicroUsd: 0, remainingWaveMicroUsd: 0 },
    waivers: [],
    sharedContractOwnerTaskIds: [],
    platform: "windows",
    planEpoch: 0,
    compiledAt: DEFAULT_COMPILED_AT,
  };
}

export function normalizePattern(pattern: string): readonly string[] {
  return normalizeWritePattern(pattern, "windows").segments;
}

export function writeScopesOverlap(
  left: readonly string[],
  right: readonly string[],
  compiler: DeterministicGraphCompiler = defaultCompiler,
): boolean {
  if (left.length === 0 || right.length === 0) return true;
  const nonEmptyLeft = left.filter((pattern) => normalizeWritePattern(pattern, "windows").posix !== "");
  const nonEmptyRight = right.filter((pattern) => normalizeWritePattern(pattern, "windows").posix !== "");
  if (nonEmptyLeft.length === 0 || nonEmptyRight.length === 0) return false;
  const diagnostics = compiler.validateDisjointWriteScopes(
    pairCompilationInput(nonEmptyLeft, nonEmptyRight),
  );
  return diagnostics.some(
    (item) =>
      item.code === "parallel_write_overlap" ||
      item.code === "windows_case_collision",
  );
}

export function validateDisjointScheduleWriteScopes(
  graph: ScheduleGraph,
  compiler: DeterministicGraphCompiler = defaultCompiler,
): readonly CompilationDiagnostic[] {
  const predecessors = new Map<string, string[]>();
  for (const task of graph.tasks) predecessors.set(task.id, []);
  for (const task of graph.tasks) {
    for (const edge of task.successors) {
      const list = predecessors.get(edge.to);
      if (list) list.push(task.id);
    }
  }
  const featureIds = [...new Set(graph.tasks.map((task) => task.featureId))];
  const input: CompilationInput = {
    tasks: graph.tasks.map((task) =>
      stubPlanTask(task.id, task.featureId, task.writeScope, predecessors.get(task.id) ?? []),
    ),
    features: featureIds.map((id) => ({
      id,
      title: id,
      dependsOn: [],
      active: true,
    })),
    requirements: [],
    checks: [],
    contradictions: [],
    brownfieldNames: [],
    mustAsk: [],
    budget: { remainingProjectMicroUsd: 0, remainingWaveMicroUsd: 0 },
    waivers: [],
    sharedContractOwnerTaskIds: [],
    platform: "windows",
    planEpoch: 0,
    compiledAt: DEFAULT_COMPILED_AT,
  };
  return compiler.validateDisjointWriteScopes(input);
}

export function scopeHitsLease(writeScope: readonly string[], prefixes: readonly string[]): boolean {
  for (const prefix of prefixes) {
    const normalized = prefix.replaceAll("\\", "/").trim();
    const asGlob = normalized.endsWith("/") ? `${normalized}**` : `${normalized}/**`;
    if (writeScopesOverlap(writeScope, [asGlob, normalized])) return true;
  }
  return false;
}
