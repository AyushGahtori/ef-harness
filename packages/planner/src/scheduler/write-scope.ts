import {
  DeterministicGraphCompiler,
  firstPatternIntersection,
  normalizeWritePattern,
  patternsOverlap,
  type CompilationDiagnostic,
  type CompilationInput,
  type NormalizedPattern,
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

const normalizedCache = new Map<string, NormalizedPattern>();

function cachedNormalize(pattern: string): NormalizedPattern {
  let cached = normalizedCache.get(pattern);
  if (cached === undefined) {
    cached = normalizeWritePattern(pattern, "windows");
    if (normalizedCache.size < 4096) normalizedCache.set(pattern, cached);
  }
  return cached;
}

export function normalizePattern(pattern: string): readonly string[] {
  return cachedNormalize(pattern).segments;
}

export function writeScopesOverlap(
  left: readonly string[],
  right: readonly string[],
  compiler: DeterministicGraphCompiler = defaultCompiler,
): boolean {
  if (left.length === 0 || right.length === 0) return true;
  const nonEmptyLeft = left.filter((pattern) => cachedNormalize(pattern).posix !== "");
  const nonEmptyRight = right.filter((pattern) => cachedNormalize(pattern).posix !== "");
  if (nonEmptyLeft.length === 0 || nonEmptyRight.length === 0) return false;
  if (compiler === defaultCompiler) {
    return (
      firstPatternIntersection(
        nonEmptyLeft.map(cachedNormalize),
        nonEmptyRight.map(cachedNormalize),
      ) !== null
    );
  }
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
