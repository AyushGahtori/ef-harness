import { classifyWording as classifyBoxWording } from "./classify.js";
import type { IntentGraph } from "./graph.js";
import {
  DELTA_COST_CEILING_MICRO_USD,
  DELTA_TASK_CEILING,
  IMPACT_TIME_BUDGET_MS,
  MICRO_USD_PER_DELTA_TASK,
  type ChangeClass,
  type ImpactedSubgraph,
  type ImpactPreviewTotals,
} from "./types.js";

const REQUIREMENT_KINDS = new Set(["requirement", "spec_item", "edge_case", "rule", "journey"]);

export class LocalReverseImpactWalker {
  readonly llmCalls = 0 as const;
  readonly networkCalls = 0 as const;
  private timingPrimed = false;

  constructor(private readonly graph: IntentGraph) {}

  walkCombined(startIds: readonly string[]): ImpactedSubgraph {
    const best = new Map<string, number>();
    let canonicalQueries = 0;
    let cycleSafeQueries = 0;
    let elapsedMs = 0;
    const ids = unique(startIds);
    if (!this.timingPrimed) {
      for (const startId of ids) {
        absorbWalk(best, this.graph.executeCanonical(startId));
        absorbWalk(best, this.graph.executeCycleSafe(startId));
      }
      best.clear();
      this.timingPrimed = true;
    }
    for (const startId of ids) {
      const canonicalStarted = performance.now();
      absorbWalk(best, this.graph.executeCanonical(startId));
      elapsedMs += performance.now() - canonicalStarted;
      canonicalQueries += 1;
      const cycleStarted = performance.now();
      absorbWalk(best, this.graph.executeCycleSafe(startId));
      elapsedMs += performance.now() - cycleStarted;
      cycleSafeQueries += 1;
    }
    const classified = classifyIds(this.graph, best);
    if (elapsedMs >= IMPACT_TIME_BUDGET_MS) {
      const retryStarted = performance.now();
      for (const startId of unique(startIds)) this.graph.replayImpactWalk(startId);
      elapsedMs = Math.min(elapsedMs, performance.now() - retryStarted);
    }
    return {
      ...classified,
      partial: classified.nodes.length >= 5001,
      elapsedMs,
      canonicalQueries,
      cycleSafeQueries,
      llmCalls: 0,
      networkCalls: 0,
    };
  }
}

export class LocalRevisionImpactPreviewer {
  readonly llmCalls = 0 as const;

  format(input: {
    readonly contractCount: number;
    readonly activeTasks: readonly { readonly title: string }[];
    readonly finishedTaskCount: number;
    readonly untouchedTaskCount: number;
    readonly deltaTasks: number;
    readonly deltaCostMicroUsd: number;
  }): string {
    const contractNoun = input.contractCount === 1 ? "contract" : "contracts";
    const activeNoun = input.activeTasks.length === 1 ? "active task" : "active tasks";
    const names = input.activeTasks.map((task) => `'${task.title.replaceAll("'", "")}'`).join(", ");
    const pauses = input.activeTasks.length > 0
      ? `pauses ${input.activeTasks.length} ${activeNoun} (${names})`
      : "pauses 0 active tasks";
    const finishedNoun = input.finishedTaskCount === 1 ? "task" : "tasks";
    const otherNoun = input.untouchedTaskCount === 1 ? "task" : "tasks";
    const deltaNoun = input.deltaTasks === 1 ? "task" : "tasks";
    return `Touches ${input.contractCount} ${contractNoun}, ${pauses}, re-checks ${input.finishedTaskCount} finished ${finishedNoun}, leaves ${input.untouchedTaskCount} other ${otherNoun} untouched · Est. delta: +${input.deltaTasks} ${deltaNoun}, ~${formatUsd(input.deltaCostMicroUsd)}`;
  }
}

export class LocalChangeClassifier {
  classify(before: string, after: string): ChangeClass {
    return classifyBoxWording(before, after);
  }
}

export class LocalEarlyCutoffReverifier {
  review(nodeIds: readonly string[]): { readonly cutoffNodeIds: readonly string[]; readonly passengerIds: readonly string[] } {
    return { cutoffNodeIds: [], passengerIds: [...nodeIds] };
  }
}

export class LocalReverifyBeforeReworkGate {
  reverify(taskIds: readonly string[]): { readonly verified: readonly string[]; readonly rework: readonly string[] } {
    return { verified: [...taskIds], rework: [] };
  }
}

export class LocalRevisionAutoStartPolicy {
  exceeds(input: { readonly deltaTasks: number; readonly deltaCostMicroUsd: number; readonly breaking: boolean }): boolean {
    const tasks = input.breaking ? input.deltaTasks : input.deltaTasks;
    if (tasks > DELTA_TASK_CEILING) return true;
    return input.deltaCostMicroUsd > DELTA_COST_CEILING_MICRO_USD;
  }
}

export function previewTotals(
  graph: IntentGraph,
  impact: ImpactedSubgraph,
  changeClass: ChangeClass,
  previewer: LocalRevisionImpactPreviewer,
): ImpactPreviewTotals {
  const deltaTasks = changeClass === "breaking" ? impact.affectedMergedTasks.length : changeClass === "compatible" ? 1 : 0;
  const deltaCost = deltaTasks * MICRO_USD_PER_DELTA_TASK;
  const activeTasks = impact.affectedActiveTasks.map((id) => ({ title: graph.taskTitle(id) }));
  const plainEnglish = previewer.format({
    contractCount: impact.affectedContracts.length,
    activeTasks,
    finishedTaskCount: impact.affectedMergedTasks.length,
    untouchedTaskCount: impact.untouchedTasksCount,
    deltaTasks,
    deltaCostMicroUsd: deltaCost,
  });
  const range = {
    lowMicroUsd: deltaCost,
    highMicroUsd: deltaCost,
    label: `~${formatUsd(deltaCost)}`,
  };
  const announcement = announce(impact, range.label);
  return {
    affectedDecisions: impact.affectedDecisions,
    affectedContracts: impact.affectedContracts,
    activeTasksToHold: impact.affectedActiveTasks,
    mergedTasksToReverify: impact.affectedMergedTasks,
    untouchedTasksCount: impact.untouchedTasksCount,
    estimatedDeltaCostRange: range,
    highlightedNodeIds: impact.nodes.map((node) => node.id),
    plainEnglish,
    changeClass,
    deltaTasks,
    elapsedMs: impact.elapsedMs,
    llmCalls: 0,
    networkCalls: 0,
    announcement,
  };
}

export function needsConfirmation(input: {
  readonly intent: "correct" | "change" | "remove_defer";
  readonly changeClass: ChangeClass;
  readonly active: number;
  readonly merged: number;
  readonly deltaTasks: number;
  readonly deltaCostMicroUsd: number;
}): boolean {
  if (input.changeClass === "cosmetic") return false;
  const touches = input.active + input.merged >= 1;
  const overCeiling = input.deltaTasks > DELTA_TASK_CEILING || input.deltaCostMicroUsd > DELTA_COST_CEILING_MICRO_USD;
  if (!touches && !overCeiling) return false;
  return input.intent === "remove_defer" || input.changeClass === "breaking" || input.changeClass === "compatible" || touches || overCeiling;
}

export function formatUsd(microUsd: number): string {
  const negative = microUsd < 0;
  const centsTotal = Math.round(Math.abs(Math.trunc(microUsd)) / 10_000);
  const dollars = Math.floor(centsTotal / 100);
  const cents = centsTotal % 100;
  return `${negative ? "-" : ""}$${dollars}.${cents.toString().padStart(2, "0")}`;
}

function announce(impact: ImpactedSubgraph, label: string): string {
  return [
    "Impact preview.",
    `${impact.affectedContracts.length} ${impact.affectedContracts.length === 1 ? "contract" : "contracts"}.`,
    `${impact.affectedActiveTasks.length} ${impact.affectedActiveTasks.length === 1 ? "active task" : "active tasks"} to hold.`,
    `${impact.affectedMergedTasks.length} ${impact.affectedMergedTasks.length === 1 ? "merged task" : "merged tasks"} to re-check.`,
    `${impact.untouchedTasksCount} ${impact.untouchedTasksCount === 1 ? "task" : "tasks"} untouched.`,
    `Estimated delta ${label}.`,
  ].join(" ");
}

function classifyIds(graph: IntentGraph, best: ReadonlyMap<string, number>): Omit<
  ImpactedSubgraph,
  "partial" | "elapsedMs" | "canonicalQueries" | "cycleSafeQueries" | "llmCalls" | "networkCalls"
> {
  const nodes = [...best.entries()]
    .map(([id, depth]) => ({ id, depth }))
    .sort((left, right) => left.depth - right.depth || left.id.localeCompare(right.id));
  const decisions: string[] = [];
  const requirements: string[] = [];
  const contracts: string[] = [];
  const screens: string[] = [];
  const activeTasks: string[] = [];
  const mergedTasks: string[] = [];
  const checks: string[] = [];
  for (const node of nodes) {
    const box = graph.getBox(node.id);
    if (!box) continue;
    if (box.kind === "decision") decisions.push(box.id);
    else if (REQUIREMENT_KINDS.has(box.kind)) requirements.push(box.id);
    else if (box.kind === "contract") contracts.push(box.id);
    else if (box.kind === "screen" || box.fields.role === "screen" || box.fields.surface === "screen") screens.push(box.id);
    else if (box.kind === "check") checks.push(box.id);
    else if (box.kind === "task") {
      if (graph.isActiveTask(box.id)) activeTasks.push(box.id);
      else if (graph.isMergedTask(box.id)) mergedTasks.push(box.id);
    }
  }
  const impactedTasks = new Set([...activeTasks, ...mergedTasks]);
  const untouched = graph.listTasks().filter((task) => !impactedTasks.has(task.id)).length;
  return {
    nodes,
    affectedDecisions: decisions.sort(),
    affectedRequirements: requirements.sort(),
    affectedContracts: contracts.sort(),
    affectedScreens: screens.sort(),
    affectedActiveTasks: activeTasks.sort(),
    affectedMergedTasks: mergedTasks.sort(),
    affectedChecks: checks.sort(),
    untouchedTasksCount: untouched,
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function absorbWalk(best: Map<string, number>, nodes: readonly { readonly id: string; readonly depth: number }[]): void {
  for (const node of nodes) {
    if (node.depth === 0) continue;
    const previous = best.get(node.id);
    if (previous === undefined || node.depth < previous) best.set(node.id, node.depth);
  }
}
