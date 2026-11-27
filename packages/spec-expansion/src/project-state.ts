import {
  bindKnowledgeGraph,
  type EdgeCreate,
  type KnowledgeGraphRepo,
  type NodeCreate,
  type NodeRecord,
  type ProjectStateDb,
} from "@ef-harness/db";
import { parseDecisionFields, toDecisionNodeFields } from "@ef-harness/discovery";

import { FiveLayerContradictionEngine, type ContradictionReport } from "./contradictions/engine.js";
import type {
  ConflictInboxItem,
  ConflictInboxPort,
  ContradictionCheckModel,
  KnowledgeGraphPort,
} from "./contradictions/ports.js";
import type { CatalogRuleEntry, MaterializedRequirement, MatrixCellRecord } from "./contradictions/types.js";
import type { ScheduleClaim, ScheduleSolveResult } from "./contradictions/z3-wasm.js";
import { solveSchedule } from "./contradictions/z3-wasm.js";
import { ScopedRuleCollapser, type UniversalRule } from "./generators/collapse.js";
import { MatrixGeneratorRegistry } from "./generators/registry.js";
import type { MatrixId, RawMatrixCell, SettledProjectGraph } from "./generators/types.js";
import { MATRIX_IDS } from "./generators/types.js";

export interface MatrixGenerationStats {
  readonly cellCount: number;
  readonly ruleCount: number;
  readonly expands: number;
}

export interface MaterializeStats {
  readonly requirementIds: readonly string[];
  readonly expandedDecisionIds: readonly string[];
}

export interface SpecExpansionCheck {
  readonly layer4: ScheduleSolveResult;
  readonly contradicts: readonly { readonly src: string; readonly dst: string }[];
  readonly report: ContradictionReport;
}

const REQUIREMENT_KINDS = new Set(["spec_item", "rule", "edge_case", "journey"]);
const SETTLED_REQUIREMENT_BASES = new Set(["explicit", "derived", "delegated", "defaulted", "observed"]);

export class SpecMatrixGenerator {
  private readonly registry = new MatrixGeneratorRegistry();
  private readonly collapser = new ScopedRuleCollapser();

  constructor(private readonly stateDb: ProjectStateDb) {}

  generateMatrices(workItemId: string, graph: SettledProjectGraph): MatrixGenerationStats {
    const run = this.registry.generate(graph);
    const collapsed = this.collapser.collapse(run);
    const repo = bindKnowledgeGraph(this.stateDb);
    const known = new Set(listNodes(repo).map((node) => node.id));
    const nodes: NodeCreate[] = [];
    const edges: EdgeCreate[] = [];
    const seenEdges = new Set(listCurrentEdges(repo).filter((edge) => edge.type === "expands").map((edge) => edgeKey(edge.src, edge.dst)));
    for (const axis of graph.nodes) {
      if (known.has(axis.nodeId)) continue;
      nodes.push(axisNode(workItemId, axis.nodeId, axis.kind === "feature" ? "feature" : "decision", axis.title, axis.featureId, axis.kind));
      known.add(axis.nodeId);
    }
    for (const rule of collapsed.rules) {
      if (!known.has(rule.id)) {
        nodes.push(ruleNode(workItemId, rule));
        known.add(rule.id);
      }
      linkExpands(rule.id, rule.domainNodeIds, graph, known, seenEdges, edges);
    }
    for (const cell of collapsed.exceptions) {
      if (!known.has(cell.id)) {
        nodes.push(cellNode(workItemId, cell));
        known.add(cell.id);
      }
      linkExpands(cell.id, cell.domainNodeIds, graph, known, seenEdges, edges);
    }
    commit(repo, nodes, edges, "persist spec matrices");
    return { cellCount: collapsed.exceptions.length, ruleCount: collapsed.rules.length, expands: edges.length };
  }

  listCells(workItemId: string): readonly MatrixCellRecord[] {
    const cells: MatrixCellRecord[] = [];
    for (const node of listNodes(bindKnowledgeGraph(this.stateDb))) {
      if (workItemOf(node.fields) !== workItemId) continue;
      const fields = record(node.fields);
      if (fields?.record_type !== "matrix_cell") continue;
      const matrixId = fields.matrixId;
      const axisA = fields.axisA;
      const axisB = fields.axisB;
      if (!isMatrixId(matrixId) || typeof axisA !== "string" || typeof axisB !== "string") continue;
      const notApplicable = fields.notApplicable === true;
      cells.push({
        id: node.id,
        matrixId,
        axisA,
        axisB,
        status: notApplicable ? "not_applicable" : node.status === "active" ? "filled" : "open",
        text: node.text,
      });
    }
    return cells;
  }

  listMaterializedRequirements(workItemId: string): readonly MaterializedRequirement[] {
    const requirements: MaterializedRequirement[] = [];
    for (const node of listNodes(bindKnowledgeGraph(this.stateDb))) {
      const requirement = requirementFromNode(node, workItemId);
      if (requirement !== null) requirements.push(requirement);
    }
    requirements.sort((left, right) => compareText(left.id, right.id));
    return requirements;
  }
}

/**
 * Materializes settled discovery decisions into spec items.
 * A `proposed` basis stays draft and is not rewritten as a confirmed basis.
 */
export class SpecCellFiller {
  constructor(private readonly stateDb: ProjectStateDb) {}

  materialize(workItemId: string): MaterializeStats {
    const repo = bindKnowledgeGraph(this.stateDb);
    const nodes: NodeCreate[] = [];
    const edges: EdgeCreate[] = [];
    const requirementIds: string[] = [];
    const expandedDecisionIds: string[] = [];
    const seenEdges = new Set(listCurrentEdges(repo).filter((edge) => edge.type === "expands").map((edge) => edgeKey(edge.src, edge.dst)));
    for (const node of listNodes(repo)) {
      if (node.kind !== "decision") continue;
      const shaped = readSettledDecision(node);
      if (shaped === null || shaped.workItemId !== workItemId) continue;
      const specId = `spec:${workItemId}:${shaped.criterionId}`;
      if (repo.getNode(specId) === null) {
        nodes.push({
          op: "create",
          id: specId,
          kind: "spec_item",
          title: node.title,
          text: shaped.text,
          status: shaped.basis === "proposed" ? "draft" : "active",
          fields: {
            basis: shaped.basis,
            work_item: workItemId,
            criterionId: shaped.criterionId,
            ...(shaped.groupId === undefined ? {} : { groupId: shaped.groupId }),
            ...(shaped.selectedOptionId === undefined ? {} : { selectedOptionId: shaped.selectedOptionId }),
            record_type: "materialized_requirement",
            ears_text: shaped.text,
          },
        });
      }
      requirementIds.push(specId);
      if (shaped.basis === "proposed") continue;
      const key = edgeKey(specId, node.id);
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      edges.push({ op: "create", src: specId, type: "expands", dst: node.id });
      expandedDecisionIds.push(node.id);
    }
    commit(repo, nodes, edges, "materialize spec requirements");
    return { requirementIds, expandedDecisionIds };
  }
}

export class FiveLayerContradictionChecker {
  constructor(private readonly stateDb: ProjectStateDb) {}

  async check(workItemId: string): Promise<SpecExpansionCheck> {
    const repo = bindKnowledgeGraph(this.stateDb);
    const matrices = new SpecMatrixGenerator(this.stateDb);
    const requirements = matrices.listMaterializedRequirements(workItemId);
    const layer4 = await solveSchedule(scheduleClaims(requirements));
    if (layer4.status === "unsat") writeContradicts(repo, layer4.unsatCore);
    const inbox = new MemoryInbox();
    const engine = new FiveLayerContradictionEngine({
      graph: new RepoGraphPort(repo),
      inbox,
      catalog: emptyCatalog,
      matrices: { listCells: () => matrices.listCells(workItemId) },
      filler: { listMaterializedRequirements: () => requirements },
      model: quietModel,
    });
    const report = engine.check();
    const contradicts = listCurrentEdges(repo)
      .filter((edge) => edge.type === "contradicts")
      .map((edge) => ({ src: edge.src, dst: edge.dst }))
      .sort((left, right) => compareText(left.src, right.src) || compareText(left.dst, right.dst));
    return { layer4, contradicts, report };
  }
}

class RepoGraphPort implements KnowledgeGraphPort {
  constructor(private readonly repo: KnowledgeGraphRepo) {}

  currentRevision(): number {
    return this.repo.currentRevision();
  }

  getNode(id: string): KnowledgeGraphPort["getNode"] extends (nodeId: string) => infer R ? R : never {
    const node = this.repo.getNode(id);
    return node === null ? null : toPortNode(node);
  }

  listNodes(): ReturnType<KnowledgeGraphPort["listNodes"]> {
    return listNodes(this.repo).map((node) => toPortNode(node));
  }

  getEdgesAsOf(rev: number): ReturnType<KnowledgeGraphPort["getEdgesAsOf"]> {
    return listEdgesAt(this.repo, rev);
  }

  commitChangeSet(proposal: Parameters<KnowledgeGraphPort["commitChangeSet"]>[0]): ReturnType<KnowledgeGraphPort["commitChangeSet"]> {
    const result = this.repo.commitChangeSet({
      origin: proposal.origin,
      author: proposal.author,
      ...(proposal.id === undefined ? {} : { id: proposal.id }),
      ...(proposal.summary === undefined || proposal.summary === null ? {} : { summary: proposal.summary }),
      edges: (proposal.edges ?? []).map((edge) =>
        edge.op === "create"
          ? { op: "create" as const, src: edge.src, type: edge.type, dst: edge.dst }
          : { op: "retire" as const, src: edge.src, type: edge.type, dst: edge.dst },
      ),
    });
    return {
      rev: result.rev,
      changeSetId: result.changeSetId ?? "",
      noop: result.noop,
      idempotent: result.idempotent,
    };
  }
}

class MemoryInbox implements ConflictInboxPort {
  private readonly items = new Map<string, ConflictInboxItem>();

  upsertConflict(item: ConflictInboxItem): void {
    const previous = this.items.get(item.id);
    this.items.set(item.id, {
      ...item,
      status: "open",
      resolvedAt: null,
      createdAt: previous?.createdAt ?? item.createdAt,
    });
  }

  resolveConflict(id: string, resolvedAt: number): void {
    const current = this.items.get(id);
    if (current === undefined) return;
    this.items.set(id, { ...current, status: "answered", resolvedAt });
  }

  listOpenConflicts(): readonly ConflictInboxItem[] {
    return [...this.items.values()].filter((item) => item.status === "open");
  }
}

const emptyCatalog: { listRules(): readonly CatalogRuleEntry[] } = {
  listRules: () => [],
};

const quietModel: ContradictionCheckModel = {
  checkBatch: () => [],
};

function writeContradicts(repo: KnowledgeGraphRepo, nodeIds: readonly string[]): void {
  const present = new Set(listNodes(repo).map((node) => node.id));
  const ids = [...new Set(nodeIds)].filter((id) => present.has(id)).sort();
  const existing = new Set(listCurrentEdges(repo).filter((edge) => edge.type === "contradicts").map((edge) => edgeKey(edge.src, edge.dst)));
  const edges: EdgeCreate[] = [];
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) {
      const src = ids[left];
      const dst = ids[right];
      if (src === undefined || dst === undefined) continue;
      const key = edgeKey(src, dst);
      if (existing.has(key)) continue;
      existing.add(key);
      edges.push({ op: "create", src, type: "contradicts", dst });
    }
  }
  commit(repo, [], edges, "layer-4 z3 contradicts");
}

function scheduleClaims(requirements: readonly MaterializedRequirement[]): ScheduleClaim[] {
  const claims: ScheduleClaim[] = [];
  for (const requirement of requirements) {
    if (requirement.status !== "active") continue;
    const text = `${requirement.text}\n${requirement.earsText}`;
    const cutoff = firstClock(text, /\border[_ ]cutoff\s*=\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/gi);
    const print = firstClock(text, /\bprints at\s+(\d{1,2}:\d{2}\s*(?:am|pm)?)/gi);
    if (cutoff !== null) claims.push({ id: `c${String(claims.length)}`, nodeId: requirement.id, key: "order_cutoff", minutes: cutoff });
    if (print !== null) claims.push({ id: `c${String(claims.length)}`, nodeId: requirement.id, key: "kitchen_print", minutes: print });
  }
  return claims;
}

function firstClock(text: string, pattern: RegExp): number | null {
  for (const match of text.matchAll(pattern)) {
    const token = match[1];
    if (token === undefined) continue;
    const minutes = parseClock(token);
    if (minutes !== null) return minutes;
  }
  return null;
}

function parseClock(token: string): number | null {
  const match = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(token.trim());
  if (match === null) return null;
  const hourText = match[1];
  const minuteText = match[2];
  if (hourText === undefined || minuteText === undefined) return null;
  let hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59 || hour > 23) return null;
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "am") {
    if (hour > 12) return null;
    if (hour === 12) hour = 0;
  } else if (meridiem === "pm") {
    if (hour > 12) return null;
    if (hour < 12) hour += 12;
  }
  return hour * 60 + minute;
}

interface ShapedDecision {
  readonly workItemId: string;
  readonly criterionId: string;
  readonly groupId?: string;
  readonly selectedOptionId?: string;
  readonly basis: string;
  readonly text: string;
}

function readSettledDecision(node: NodeRecord): ShapedDecision | null {
  let parsed: ReturnType<typeof parseDecisionFields>;
  try {
    parsed = parseDecisionFields(node.fields);
  } catch {
    return null;
  }
  if (parsed.status !== "settled" || parsed.work_item === undefined) return null;
  const shaped = toDecisionNodeFields(parsed);
  if (shaped.basis === undefined) return null;
  if (shaped.basis !== "proposed" && !SETTLED_REQUIREMENT_BASES.has(shaped.basis)) return null;
  const value = typeof shaped.value === "string" && shaped.value.length > 0 ? shaped.value : shaped.selectedOptionId;
  if (value === undefined || value.length === 0) return null;
  const decision: ShapedDecision = {
    workItemId: parsed.work_item,
    criterionId: shaped.criterionId,
    basis: shaped.basis,
    text: scheduleText(shaped.criterionId, value),
  };
  if (shaped.groupId !== undefined) return { ...decision, groupId: shaped.groupId, ...(shaped.selectedOptionId === undefined ? {} : { selectedOptionId: shaped.selectedOptionId }) };
  if (shaped.selectedOptionId !== undefined) return { ...decision, selectedOptionId: shaped.selectedOptionId };
  return decision;
}

function scheduleText(criterionId: string, value: string): string {
  const key = criterionId.toLowerCase();
  if (key.includes("cutoff")) return `order_cutoff = ${value}`;
  if (key.includes("print")) return `Kitchen prints at ${value}`;
  return `${criterionId} is ${value}`;
}

function requirementFromNode(node: NodeRecord, workItemId: string): MaterializedRequirement | null {
  if (node.status === "retired" || node.status === "superseded") return null;
  if (!REQUIREMENT_KINDS.has(node.kind)) return null;
  if (workItemOf(node.fields) !== workItemId) return null;
  const fields = record(node.fields);
  const earsText = typeof fields?.ears_text === "string" ? fields.ears_text : node.text;
  const pass = fields?.pass === 1 || fields?.pass === 2 || fields?.pass === 3 ? fields.pass : 1;
  return {
    id: node.id,
    text: node.text,
    earsText,
    entities: stringList(fields?.entities),
    touches: stringList(fields?.touches),
    featureId: typeof fields?.feature === "string" ? fields.feature : workItemId,
    pass,
    basis: node.basis ?? "derived",
    status: node.status,
  };
}

function axisNode(workItemId: string, id: string, kind: string, title: string, featureId: string, axisKind: string): NodeCreate {
  return {
    op: "create",
    id,
    kind,
    title,
    text: title,
    status: "active",
    fields: {
      basis: "explicit",
      work_item: workItemId,
      feature: featureId,
      axis_kind: axisKind,
    },
  };
}

function ruleNode(workItemId: string, rule: UniversalRule): NodeCreate {
  return {
    op: "create",
    id: rule.id,
    kind: "rule",
    title: rule.text,
    text: rule.text,
    status: "active",
    fields: {
      basis: "derived",
      work_item: workItemId,
      record_type: "universal_rule",
      matrixId: rule.matrixId,
      scopeKey: rule.scopeKey,
      signature: rule.signature,
      outcome: rule.outcome,
      reason: rule.reason,
    },
  };
}

function cellNode(workItemId: string, cell: RawMatrixCell): NodeCreate {
  return {
    op: "create",
    id: cell.id,
    kind: "spec_item",
    title: `${cell.matrixId} ${cell.outcome}`,
    text: cell.reason ?? cell.outcome,
    status: "draft",
    fields: {
      basis: "derived",
      work_item: workItemId,
      record_type: "matrix_cell",
      matrixId: cell.matrixId,
      axisA: cell.axisA,
      axisB: cell.axisB,
      outcome: cell.outcome,
      reason: cell.reason,
      notApplicable: cell.notApplicable,
      signature: cell.signature,
    },
  };
}

function linkExpands(
  src: string,
  domainNodeIds: readonly string[],
  graph: SettledProjectGraph,
  known: ReadonlySet<string>,
  seenEdges: Set<string>,
  edges: EdgeCreate[],
): void {
  const targets = new Set<string>(domainNodeIds);
  for (const node of graph.nodes) {
    if (node.kind === "feature") targets.add(node.nodeId);
  }
  for (const dst of targets) {
    if (!known.has(dst) || dst === src) continue;
    const key = edgeKey(src, dst);
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({ op: "create", src, type: "expands", dst });
  }
}

function commit(repo: KnowledgeGraphRepo, nodes: readonly NodeCreate[], edges: readonly EdgeCreate[], summary: string): void {
  if (nodes.length === 0 && edges.length === 0) return;
  repo.commitChangeSet({
    origin: "kernel",
    author: "spec-expansion",
    summary,
    nodes,
    edges,
  });
}

function listNodes(repo: KnowledgeGraphRepo): NodeRecord[] {
  const rev = repo.currentRevision();
  const nodes: NodeRecord[] = [];
  let after: string | undefined;
  for (;;) {
    const page = repo.getSnapshotAsOf(rev, after === undefined ? { limit: 200 } : { limit: 200, nodeAfter: after });
    for (const row of page.nodes) {
      const full = repo.getNode(row.id);
      if (full) nodes.push(full);
    }
    if (!page.hasMoreNodes || page.nodesNextCursor === null) break;
    after = page.nodesNextCursor;
  }
  return nodes;
}

function listCurrentEdges(repo: KnowledgeGraphRepo): { src: string; type: string; dst: string }[] {
  return listEdgesAt(repo, repo.currentRevision());
}

function listEdgesAt(repo: KnowledgeGraphRepo, rev: number): { src: string; type: string; dst: string }[] {
  const edges: { src: string; type: string; dst: string }[] = [];
  let after: string | undefined;
  for (;;) {
    const page = repo.getEdgesAsOf(rev, after === undefined ? { limit: 400 } : { limit: 400, after });
    edges.push(...page.edges);
    if (!page.hasMore || page.nextCursor === null) break;
    after = page.nextCursor;
  }
  return edges;
}

function toPortNode(node: NodeRecord): ReturnType<KnowledgeGraphPort["listNodes"]>[number] {
  return node;
}

function workItemOf(fields: unknown): string | null {
  const value = record(fields);
  if (value === null) return null;
  if (typeof value.work_item === "string") return value.work_item;
  if (typeof value.workItemId === "string") return value.workItemId;
  return null;
}

function record(fields: unknown): Record<string, unknown> | null {
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) return null;
  return fields as Record<string, unknown>;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function isMatrixId(value: unknown): value is MatrixId {
  return typeof value === "string" && (MATRIX_IDS as readonly string[]).includes(value);
}

function edgeKey(src: string, dst: string): string {
  return `${src}\0${dst}`;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
