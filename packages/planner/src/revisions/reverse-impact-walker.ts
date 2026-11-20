import type { DatabaseSync } from "node:sqlite";

import { RevisionGraph, sqlInt, sqlText } from "./graph.js";
import { CANONICAL_IMPACT_WALK_SQL, CYCLE_SAFE_IMPACT_WALK_SQL } from "./schema.js";
import {
  DEFAULT_IMPACT_MAX_DEPTH,
  IMPACT_ROW_CAP,
  isActiveWorkingState,
  isMergedDoneState,
  isRequirementKind,
  type ImpactedSubgraph,
  type ImpactNode,
} from "./types.js";

export class ReverseImpactWalker {
  readonly graph: RevisionGraph;
  combinedCalls = 0;
  canonicalQueries = 0;
  cycleSafeQueries = 0;
  private readonly statements = new Map<string, ReturnType<DatabaseSync["prepare"]>>();

  constructor(
    readonly db: DatabaseSync,
    private readonly defaultMaxDepth = DEFAULT_IMPACT_MAX_DEPTH,
  ) {
    this.graph = new RevisionGraph(db);
    this.statement(CANONICAL_IMPACT_WALK_SQL);
    this.statement(CYCLE_SAFE_IMPACT_WALK_SQL);
  }

  /**
   * One combined reverse walk. The statement is the canonical `impact_walk`
   * plus a visited-path guard and `belongs_to` / `consumes`.
   * `executeCanonical` still runs the exact `schema/queries.sql` text.
   */
  walkCombined(startIds: readonly string[], maxDepth = this.defaultMaxDepth): ImpactedSubgraph {
    this.combinedCalls += 1;
    const started = performance.now();
    const best = new Map<string, number>();
    let cycleSafeQueries = 0;
    for (const startId of unique(startIds)) {
      for (const node of this.executeCycleSafe(startId, maxDepth).nodes) absorb(best, node);
      cycleSafeQueries += 1;
    }
    const classified = this.classify(best, 0, cycleSafeQueries);
    return { ...classified, elapsedMs: performance.now() - started };
  }

  executeCanonical(startId: string, maxDepth = this.defaultMaxDepth): { nodes: ImpactNode[]; partial: boolean } {
    this.canonicalQueries += 1;
    return this.query(CANONICAL_IMPACT_WALK_SQL, startId, maxDepth);
  }

  executeCycleSafe(startId: string, maxDepth = this.defaultMaxDepth): { nodes: ImpactNode[]; partial: boolean } {
    this.cycleSafeQueries += 1;
    return this.query(CYCLE_SAFE_IMPACT_WALK_SQL, startId, maxDepth);
  }

  private statement(sql: string): ReturnType<DatabaseSync["prepare"]> {
    const cached = this.statements.get(sql);
    if (cached) return cached;
    const prepared = this.db.prepare(sql);
    this.statements.set(sql, prepared);
    return prepared;
  }

  private query(sql: string, startId: string, maxDepth: number): { nodes: ImpactNode[]; partial: boolean } {
    const depth = normalizeDepth(maxDepth);
    const rows = this.statement(sql).all({ start: startId, max_depth: depth });
    const nodes: ImpactNode[] = [];
    for (const row of rows) {
      const id = sqlText(row.id);
      if (id.length === 0) continue;
      nodes.push({ id, depth: sqlInt(row.depth) });
    }
    return { nodes, partial: nodes.length >= IMPACT_ROW_CAP };
  }

  private classify(
    best: ReadonlyMap<string, number>,
    canonicalQueries: number,
    cycleSafeQueries: number,
  ): Omit<ImpactedSubgraph, "elapsedMs"> {
    const nodes = [...best.entries()]
      .map(([id, depth]) => ({ id, depth }))
      .sort(compareNodes);
    const records = this.graph.loadImpactRows(nodes.map((node) => node.id));
    const decisions: string[] = [];
    const requirements: string[] = [];
    const contracts: string[] = [];
    const screens: string[] = [];
    const activeTasks: string[] = [];
    const mergedTasks: string[] = [];
    const checks: string[] = [];
    for (const node of nodes) {
      const record = records.get(node.id);
      if (!record) continue;
      if (record.kind === "decision") decisions.push(record.id);
      else if (isRequirementKind(record.kind)) requirements.push(record.id);
      else if (record.kind === "contract") contracts.push(record.id);
      else if (isScreen(record.kind, record.role, record.surface)) screens.push(record.id);
      else if (record.kind === "check") checks.push(record.id);
      else if (record.kind === "task") {
        if (record.state && isActiveWorkingState(record.state)) activeTasks.push(record.id);
        else if (record.state && isMergedDoneState(record.state)) mergedTasks.push(record.id);
      }
    }
    return {
      nodes,
      affectedDecisions: decisions.sort(),
      affectedRequirements: requirements.sort(),
      affectedContracts: contracts.sort(),
      affectedScreens: screens.sort(),
      affectedActiveTasks: activeTasks.sort(),
      affectedMergedTasks: mergedTasks.sort(),
      affectedChecks: checks.sort(),
      partial: nodes.length >= IMPACT_ROW_CAP,
      canonicalQueries,
      cycleSafeQueries,
    };
  }
}

function absorb(best: Map<string, number>, node: ImpactNode): void {
  const previous = best.get(node.id);
  if (previous === undefined || node.depth < previous) best.set(node.id, node.depth);
}

function compareNodes(left: ImpactNode, right: ImpactNode): number {
  if (left.depth !== right.depth) return left.depth - right.depth;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function normalizeDepth(maxDepth: number): number {
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) {
    throw new Error("impact depth must be a non-negative integer");
  }
  return maxDepth;
}

function isScreen(kind: string, role: string, surface: string): boolean {
  return kind === "screen" || role === "screen" || surface === "screen";
}
