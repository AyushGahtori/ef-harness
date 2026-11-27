import { DuplicateLogicalNameError, DuplicateNodeIdError, bindKnowledgeGraph, type ProjectStateDb } from "@ef-harness/db";
import { JitFeatureArchitectureSynthesizer } from "./synthesizer.js";
import type { GraphEdge, GraphNode, SchemaDelta, SynthesisRequest, SynthesisResult } from "./types.js";
import {
  SkeletonLockEnforcer,
  type LockDecision,
  type SkeletonLockReader,
  type SkeletonMutation,
} from "../system-arch/skeleton-lock.js";
import type { GraphNode as SystemNode } from "../system-arch/state-db.js";

const EDGE_TYPES = new Set<string>([
  "implements",
  "verifies",
  "consumes_contract",
  "produces_contract",
  "obeys",
  "handles_edge_case",
  "derived_from",
  "depends_on",
  "waives",
  "belongs_to",
  "documents",
  "cites",
  "comments_on",
  "supersedes",
]);

export interface FeatureArchitecturePersistResult {
  readonly persisted: boolean;
  readonly nameCount: number;
  readonly blocked: readonly LockDecision[];
  readonly drafted: SynthesisResult;
}

/**
 * Async feature architecture writer. Lock decisions go through the system
 * `SkeletonLockEnforcer`. Accepted graphs are stored with `fields.names`
 * so `state.db.names` rejects a second owner of the same name.
 */
export class FeatureArchitectureSynthesizer {
  private readonly jit = new JitFeatureArchitectureSynthesizer();
  private readonly locks = new SkeletonLockEnforcer();

  constructor(private readonly stateDb: ProjectStateDb) {}

  async synthesize(request: SynthesisRequest): Promise<FeatureArchitecturePersistResult> {
    const drafted = this.jit.synthesize(request);
    const blocked = this.blockingMutations(request);
    if (drafted.status !== "accepted" || blocked.length > 0) {
      return { persisted: false, nameCount: countNames(this.stateDb), blocked, drafted };
    }
    const repo = bindKnowledgeGraph(this.stateDb);
    const nodes = drafted.nodes.map((node) => ({
      op: "create" as const,
      id: node.id,
      kind: node.kind,
      title: node.title,
      text: node.text,
      status: "active" as const,
      fields: persistedFields(node.fields),
    }));
    const ids = new Set(nodes.map((node) => node.id));
    const edges = drafted.edges.filter((edge) => keepEdge(edge, ids));
    try {
      repo.commitChangeSet({
        origin: "planner",
        author: "feature-architect@1",
        summary: `feature architecture wave ${String(request.targetWave)}`,
        nodes,
        edges: edges.map((edge) => ({ op: "create" as const, src: edge.src, type: edge.type, dst: edge.dst })),
      });
    } catch (error) {
      if (error instanceof DuplicateLogicalNameError || error instanceof DuplicateNodeIdError) {
        return { persisted: false, nameCount: countNames(this.stateDb), blocked, drafted };
      }
      throw error;
    }
    return { persisted: true, nameCount: countNames(this.stateDb), blocked, drafted };
  }

  private blockingMutations(request: SynthesisRequest): LockDecision[] {
    const reader = lockReader(request.skeleton);
    const blocked: LockDecision[] = [];
    for (const feature of request.features) {
      for (const delta of feature.schemaDeltas) {
        const mutation = toMutation(delta, feature.id, request.targetWave);
        if (!mutation) continue;
        const decision = this.locks.evaluate(reader, mutation);
        if (!decision.allowed) blocked.push(decision);
      }
    }
    return blocked;
  }
}

function lockReader(skeleton: SynthesisRequest["skeleton"]): SkeletonLockReader {
  const nodes: SystemNode[] = skeleton.tables
    .filter((table) => table.locked)
    .map((table) => ({
      id: `table:${table.name}`,
      kind: "arch_node",
      version: 1,
      title: table.name,
      text: table.name,
      status: "active",
      feature: null,
      basis: "derived",
      fields: {
        skeleton_locked: true,
        arch_role: "entity",
        table: table.name,
        canonical_name: table.name,
      },
    }));
  return {
    getMeta(key) {
      if (key === "skeleton_locked") return skeleton.locked ? "true" : "false";
      return null;
    },
    listNodes() {
      return nodes;
    },
    getNode(id) {
      return nodes.find((node) => node.id === id || node.fields.table === id);
    },
  };
}

function toMutation(delta: SchemaDelta, owner: string, wave: number): SkeletonMutation | null {
  switch (delta.op) {
    case "add_table":
      return { kind: "add_table", table: delta.table, owner, wave };
    case "add_column":
      return {
        kind: "add_column",
        table: delta.table,
        column: delta.column.name,
        columnType: delta.column.type,
        nullable: delta.column.nullable,
        hasDefault: false,
        wave,
      };
    case "change_type":
      return {
        kind: "change_type",
        table: delta.table,
        column: delta.column,
        fromType: "TEXT",
        toType: delta.toType,
        wave,
      };
    case "rename_column":
      return { kind: "rename", target: delta.table, fromName: delta.from, toName: delta.to, wave };
    case "drop_column":
      return { kind: "delete", target: delta.table, wave };
    case "drop_table":
      return { kind: "delete", target: delta.table, wave };
    default: {
      const unreachable: never = delta;
      return unreachable;
    }
  }
}

function persistedFields(fields: GraphNode["fields"]): Record<string, unknown> {
  const names = nameEntries(fields);
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || key === "registeredNames" || key === "names") continue;
    next[key] = value;
  }
  if (names.length > 0) next.names = names;
  return next;
}

function nameEntries(fields: Record<string, unknown>): { kind: string; value: string }[] {
  const found: { kind: string; value: string }[] = [];
  const seen = new Set<string>();
  const push = (kind: string, value: string): void => {
    if (kind.length === 0 || value.length === 0) return;
    const key = `${kind}\u0000${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ kind, value });
  };
  if (Array.isArray(fields.names)) {
    for (const entry of fields.names) {
      if (!isRecord(entry) || typeof entry.kind !== "string" || typeof entry.value !== "string") continue;
      push(entry.kind, entry.value);
    }
  }
  if (Array.isArray(fields.registeredNames)) {
    for (const entry of fields.registeredNames) {
      if (!isRecord(entry) || typeof entry.kind !== "string") continue;
      const value = typeof entry.value === "string" ? entry.value : typeof entry.name === "string" ? entry.name : "";
      push(entry.kind, value);
    }
  }
  return found;
}

function keepEdge(edge: GraphEdge, ids: ReadonlySet<string>): boolean {
  return ids.has(edge.src) && ids.has(edge.dst) && EDGE_TYPES.has(edge.type);
}

function countNames(stateDb: ProjectStateDb): number {
  const row = stateDb.writer.prepare("SELECT count(*) AS c FROM names").get();
  if (!isRecord(row)) return 0;
  if (typeof row.c === "number" && Number.isSafeInteger(row.c)) return row.c;
  if (typeof row.c === "bigint") return Number(row.c);
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
