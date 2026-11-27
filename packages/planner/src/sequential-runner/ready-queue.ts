import { BASIS_ORDER, type ReadyTask, type TaskFields } from "./types.js";
import { StateDb } from "./state-db.js";

/**
 * Ready compiled tasks whose dependencies are done, with no holds, on an
 * active feature, and (for wave work) a PASSED gate0. Explicit requirements
 * sort ahead of delegated and defaulted work at the same dependency depth,
 * and critical-path blockers sort ahead of non-blocking leaves.
 */
export class ExplicitFirstReadyQueue {
  constructor(private readonly db: StateDb) {}

  describe(taskId: string): ReadyTask | null {
    const row = this.db.readyTaskById(taskId);
    if (!row) return null;
    return this.toReady(row, this.db.dependencyEdges(), new Map<string, number>());
  }

  list(): ReadyTask[] {
    const edges = this.db.dependencyEdges();
    const depths = new Map<string, number>();
    const gatePassed = this.db.gatePassed();
    const ready: ReadyTask[] = [];
    for (const row of this.db.readyRows()) {
      const fields = parseFields(String(row.fields));
      const snapshot = fields.compiled_plan_snapshot;
      if (!snapshot || typeof snapshot.snapshotId !== "string" || snapshot.snapshotId.length === 0) continue;
      const wave = numberValue(row.wave);
      const phase = fields.phase ?? "";
      if (!gatePassed && phase !== "phase0" && wave !== 0) continue;
      const task = this.toReady(row, edges, depths);
      if (task.wave !== wave) continue;
      ready.push(task);
    }
    ready.sort(compareReady);
    return ready;
  }

  private toReady(
    row: Record<string, unknown>,
    edges: ReadonlyArray<{ src: string; dst: string }>,
    depths: Map<string, number>,
  ): ReadyTask {
    const fields = parseFields(String(row.fields ?? "{}"));
    const id = String(row.task);
    const bases = this.db.requirementBases(id);
    const basis = strongestBasis(bases.length > 0 ? bases : [fields.basis ?? ""]);
    return {
      id,
      feature: String(row.feature),
      title: String(row.title),
      text: String(row.text ?? ""),
      level: String(row.level),
      version: numberValue(row.version),
      contentHash: String(row.content_hash),
      fields,
      wave: numberValue(row.wave),
      branch: String(row.branch),
      basis,
      basisRank: basisRank(basis),
      depth: depthOf(id, edges, depths),
      blocker: fields.critical_path === true || this.db.openBlockers(id),
    };
  }
}

function compareReady(left: ReadyTask, right: ReadyTask): number {
  if (left.depth !== right.depth) return left.depth - right.depth;
  if (left.basisRank !== right.basisRank) return left.basisRank - right.basisRank;
  if (left.blocker !== right.blocker) return left.blocker ? -1 : 1;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function strongestBasis(bases: readonly string[]): string {
  let best = "";
  let bestRank = BASIS_ORDER.length + 1;
  for (const basis of bases) {
    const rank = basisRank(basis);
    if (basis && rank < bestRank) {
      best = basis;
      bestRank = rank;
    }
  }
  return best || "defaulted";
}

function basisRank(basis: string): number {
  const index = BASIS_ORDER.indexOf(basis as (typeof BASIS_ORDER)[number]);
  return index >= 0 ? index : BASIS_ORDER.length;
}

function depthOf(taskId: string, edges: ReadonlyArray<{ src: string; dst: string }>, memo: Map<string, number>): number {
  const seen = memo.get(taskId);
  if (seen !== undefined) return seen;
  memo.set(taskId, 0);
  let depth = 0;
  for (const edge of edges) {
    if (edge.src !== taskId) continue;
    depth = Math.max(depth, 1 + depthOf(edge.dst, edges, memo));
  }
  memo.set(taskId, depth);
  return depth;
}

function parseFields(raw: string): TaskFields {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as TaskFields;
  } catch {
    return {};
  }
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return 0;
}
