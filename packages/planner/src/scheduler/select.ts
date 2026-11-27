import { at } from "./errors.js";
import type { IndexedGraph } from "./graph.js";
import { scopeHitsLease, writeScopesOverlap } from "./write-scope.js";
import { compareCandidates, priorityScore, type ReadyCandidate } from "./presets.js";
import type { PathLeaseView, ScheduleTask } from "./types.js";

export interface OccupiedWork {
  readonly featureId: string;
  readonly writeScope: readonly string[];
}

export function orderReadyTasks(input: {
  readonly indexed: IndexedGraph;
  readonly readyIndexes: readonly number[];
  readonly critical: ReadonlySet<string>;
  readonly ranks: ReadonlyMap<string, number>;
  readonly skippedRounds: Readonly<Record<string, number>>;
  readonly readySinceMs: Readonly<Record<string, number>>;
  readonly nowMs: number;
  readonly policy: "heft" | "fifo";
  readonly batchSameFeature: boolean;
  readonly lastFeatureId: string | null;
}): readonly ReadyCandidate[] {
  const candidates = input.readyIndexes.map((index) => {
    const task = at(input.indexed.tasks, index, "task");
    const priority = priorityScore({
      rankUMs: input.ranks.get(task.id) ?? 0,
      onCriticalPath: input.critical.has(task.id),
      explicit: task.explicit,
      optionalPolish: task.optionalPolish,
      skippedRounds: input.skippedRounds[task.id] ?? 0,
      sameFeatureBonus: input.batchSameFeature && input.lastFeatureId === task.featureId,
    });
    return {
      index,
      id: task.id,
      featureId: task.featureId,
      band: priority.band,
      score: priority.score,
      featureAffinity: input.batchSameFeature && input.lastFeatureId === task.featureId ? 1 : 0,
      readySinceMs: input.readySinceMs[task.id] ?? input.nowMs,
    } satisfies ReadyCandidate;
  });
  candidates.sort((left, right) => compareCandidates(left, right, input.policy));
  return candidates;
}

export function conflictsWithOccupied(task: ScheduleTask, occupied: readonly OccupiedWork[]): boolean {
  for (const slot of occupied) {
    if (slot.featureId === task.featureId) return true;
    if (writeScopesOverlap(task.writeScope, slot.writeScope)) return true;
  }
  return false;
}

export function blockedByLease(task: ScheduleTask, leases: readonly PathLeaseView[]): boolean {
  for (const lease of leases) {
    if (scopeHitsLease(task.writeScope, lease.prefixes)) return true;
  }
  return false;
}

export function takeCandidates(input: {
  readonly ordered: readonly ReadyCandidate[];
  readonly indexed: IndexedGraph;
  readonly slots: number;
  readonly occupied: readonly OccupiedWork[];
  readonly leases: readonly PathLeaseView[];
}): { readonly chosen: readonly ReadyCandidate[]; readonly skippedIds: readonly string[] } {
  if (input.slots <= 0) {
    return { chosen: [], skippedIds: input.ordered.map((candidate) => candidate.id) };
  }
  const occupied = [...input.occupied];
  const chosen: ReadyCandidate[] = [];
  const skipped: string[] = [];
  for (const candidate of input.ordered) {
    const task = at(input.indexed.tasks, candidate.index, "task");
    if (chosen.length >= input.slots || conflictsWithOccupied(task, occupied) || blockedByLease(task, input.leases)) {
      skipped.push(candidate.id);
      continue;
    }
    chosen.push(candidate);
    occupied.push({ featureId: task.featureId, writeScope: task.writeScope });
  }
  return { chosen, skippedIds: skipped };
}
