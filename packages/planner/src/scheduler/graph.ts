import { at, SchedulerError } from "./errors.js";
import type { RankTable, ScheduleGraph, ScheduleTask } from "./types.js";

export interface IndexedEdge {
  readonly index: number;
  readonly commDelayMs: number;
}

export interface IndexedGraph {
  readonly tasks: readonly ScheduleTask[];
  readonly successors: readonly (readonly IndexedEdge[])[];
  readonly predecessors: readonly (readonly IndexedEdge[])[];
  readonly execMs: readonly number[];
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function indexGraph(
  graph: ScheduleGraph,
  execOverride: Readonly<Record<string, number>> = {},
): IndexedGraph {
  const tasks = graph.tasks;
  if (tasks.length === 0) {
    throw new SchedulerError("invalid_graph", "Schedule graph has no tasks");
  }
  const byId = new Map<string, number>();
  for (let index = 0; index < tasks.length; index += 1) {
    const task = at(tasks, index, "task");
    if (!task.id || byId.has(task.id)) {
      throw new SchedulerError("invalid_graph", `Duplicate or empty task id "${task.id}"`);
    }
    if (!SLUG.test(task.featureSlug)) {
      throw new SchedulerError("invalid_graph", `Feature slug "${task.featureSlug}" is not a branch slug`);
    }
    if (!Number.isInteger(task.avgExecTimeMs) || task.avgExecTimeMs < 1) {
      throw new SchedulerError("invalid_graph", `Task ${task.id} needs a positive integer exec time`);
    }
    if (!Number.isInteger(task.waveIndex) || task.waveIndex < 0) {
      throw new SchedulerError("invalid_graph", `Task ${task.id} has a negative wave index`);
    }
    byId.set(task.id, index);
  }

  const successors: IndexedEdge[][] = tasks.map(() => []);
  const predecessors: IndexedEdge[][] = tasks.map(() => []);
  const execMs: number[] = [];

  for (let index = 0; index < tasks.length; index += 1) {
    const task = at(tasks, index, "task");
    const override = execOverride[task.id];
    if (override !== undefined && (!Number.isInteger(override) || override < 1)) {
      throw new SchedulerError("invalid_graph", `Exec override for ${task.id} is not a positive integer`);
    }
    execMs.push(override ?? task.avgExecTimeMs);
    const seen = new Set<string>();
    for (const edge of task.successors) {
      if (edge.to === task.id) {
        throw new SchedulerError("cycle", `Task ${task.id} depends on itself`);
      }
      if (seen.has(edge.to)) {
        throw new SchedulerError("invalid_graph", `Duplicate edge ${task.id} -> ${edge.to}`);
      }
      seen.add(edge.to);
      if (!Number.isInteger(edge.commDelayMs) || edge.commDelayMs < 0) {
        throw new SchedulerError("invalid_graph", `Negative comm delay on ${task.id} -> ${edge.to}`);
      }
      const target = byId.get(edge.to);
      if (target === undefined) {
        throw new SchedulerError("invalid_graph", `Task ${task.id} points at unknown successor ${edge.to}`);
      }
      const successor = at(successors, index, "successor list");
      const predecessor = at(predecessors, target, "predecessor list");
      successor.push({ index: target, commDelayMs: edge.commDelayMs });
      predecessor.push({ index, commDelayMs: edge.commDelayMs });
    }
  }

  assertAcyclic(successors);
  return { tasks, successors, predecessors, execMs };
}

function assertAcyclic(successors: readonly (readonly IndexedEdge[])[]): void {
  const n = successors.length;
  const indegree = successors.map(() => 0);
  for (const edges of successors) {
    for (const edge of edges) {
      const slot = indegree[edge.index];
      if (slot === undefined) {
        throw new SchedulerError("invalid_graph", "Edge left the graph");
      }
      indegree[edge.index] = slot + 1;
    }
  }
  const queue: number[] = [];
  for (let index = 0; index < n; index += 1) {
    if (indegree[index] === 0) queue.push(index);
  }
  let seen = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    if (index === undefined) break;
    seen += 1;
    for (const edge of at(successors, index, "successor")) {
      const next = indegree[edge.index];
      if (next === undefined) continue;
      indegree[edge.index] = next - 1;
      if (next - 1 === 0) queue.push(edge.index);
    }
  }
  if (seen !== n) {
    throw new SchedulerError("cycle", "Task graph contains a dependency cycle");
  }
}

export function isPureChain(indexed: IndexedGraph): boolean {
  if (indexed.tasks.length < 2) return false;
  let sources = 0;
  let sinks = 0;
  for (let index = 0; index < indexed.tasks.length; index += 1) {
    const preds = at(indexed.predecessors, index, "predecessors").length;
    const succs = at(indexed.successors, index, "successors").length;
    if (preds > 1 || succs > 1) return false;
    if (preds === 0) sources += 1;
    if (succs === 0) sinks += 1;
  }
  return sources === 1 && sinks === 1;
}

/**
 * HEFT upward rank:
 * rank_u(t) = avg_exec_time(t) + max_{s in succ(t)} (comm_delay(t, s) + rank_u(s))
 * Exit tasks use max(empty) = 0. Integer milliseconds, so the rank is deterministic.
 */
export function computeRanks(indexed: IndexedGraph): RankTable {
  const n = indexed.tasks.length;
  const rankU = new Array<number>(n).fill(0);
  const indegree = indexed.successors.map((edges) => edges.length);
  const queue: number[] = [];
  for (let index = 0; index < n; index += 1) {
    if (indegree[index] === 0) queue.push(index);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    if (index === undefined) break;
    let best = 0;
    for (const edge of at(indexed.successors, index, "successor")) {
      const successorRank = rankU[edge.index] ?? 0;
      const candidate = edge.commDelayMs + successorRank;
      if (candidate > best) best = candidate;
    }
    rankU[index] = (indexed.execMs[index] ?? 0) + best;
    for (const edge of at(indexed.predecessors, index, "predecessor")) {
      const next = indegree[edge.index];
      if (next === undefined) continue;
      indegree[edge.index] = next - 1;
      if (next - 1 === 0) queue.push(edge.index);
    }
  }

  const earliest = new Array<number>(n).fill(0);
  const forward = indexed.predecessors.map((edges) => edges.length);
  const sources: number[] = [];
  for (let index = 0; index < n; index += 1) {
    if (forward[index] === 0) sources.push(index);
  }
  for (let cursor = 0; cursor < sources.length; cursor += 1) {
    const index = sources[cursor];
    if (index === undefined) break;
    for (const edge of at(indexed.successors, index, "successor")) {
      const arrival = (earliest[index] ?? 0) + (indexed.execMs[index] ?? 0) + edge.commDelayMs;
      if (arrival > (earliest[edge.index] ?? 0)) earliest[edge.index] = arrival;
      const next = forward[edge.index];
      if (next === undefined) continue;
      forward[edge.index] = next - 1;
      if (next - 1 === 0) sources.push(edge.index);
    }
  }

  let criticalPathMs = 0;
  for (let index = 0; index < n; index += 1) {
    const length = (earliest[index] ?? 0) + (rankU[index] ?? 0);
    if (length > criticalPathMs) criticalPathMs = length;
  }

  const rankUMs = new Map<string, number>();
  const earliestStartMs = new Map<string, number>();
  const critical: string[] = [];
  const onCriticalPath = new Set<string>();
  for (let index = 0; index < n; index += 1) {
    const task = at(indexed.tasks, index, "task");
    const rank = rankU[index] ?? 0;
    rankUMs.set(task.id, rank);
    earliestStartMs.set(task.id, earliest[index] ?? 0);
    if ((earliest[index] ?? 0) + rank === criticalPathMs) {
      critical.push(task.id);
      onCriticalPath.add(task.id);
    }
  }
  critical.sort((a, b) => a.localeCompare(b));
  const order = indexed.tasks.map((task) => task.id);
  return { order, rankUMs, earliestStartMs, criticalPathMs, criticalTaskIds: critical, onCriticalPath };
}

export function descendantBits(indexed: IndexedGraph): Uint32Array[] {
  const n = indexed.tasks.length;
  const words = Math.ceil(n / 32);
  const indegree = indexed.successors.map((edges) => edges.length);
  const queue: number[] = [];
  for (let index = 0; index < n; index += 1) {
    if (indegree[index] === 0) queue.push(index);
  }
  const reverse: number[] = [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    if (index === undefined) break;
    reverse.push(index);
    for (const edge of at(indexed.predecessors, index, "predecessor")) {
      const next = indegree[edge.index];
      if (next === undefined) continue;
      indegree[edge.index] = next - 1;
      if (next - 1 === 0) queue.push(edge.index);
    }
  }
  const bits = Array.from({ length: n }, () => new Uint32Array(words));
  for (const index of reverse) {
    const row = at(bits, index, "bitset");
    for (const edge of at(indexed.successors, index, "successor")) {
      const child = at(bits, edge.index, "bitset");
      for (let word = 0; word < words; word += 1) {
        row[word] = (row[word] ?? 0) | (child[word] ?? 0);
      }
      row[edge.index >> 5] = (row[edge.index >> 5] ?? 0) | (1 << (edge.index & 31));
    }
  }
  return bits;
}

export function reaches(bits: readonly Uint32Array[], from: number, to: number): boolean {
  const row = bits[from];
  if (!row) return false;
  return ((row[to >> 5] ?? 0) & (1 << (to & 31))) !== 0;
}
