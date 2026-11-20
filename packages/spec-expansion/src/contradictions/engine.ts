import { CatalogRuleChecker } from "./catalog-checker.js";
import { CrossMatrixInvariantChecker } from "./cross-matrix.js";
import { IntervalConflictDetector } from "./intervals.js";
import { claimsFromFields, readRecord, readString, readStringList } from "./ports.js";
import type {
  CatalogRuleSource,
  CheckRequest,
  ConflictInboxItem,
  ConflictInboxPort,
  ContradictionCheckModel,
  ContradictionLogger,
  ContradictionObserver,
  ContradictionWarning,
  EdgeMutation,
  KnowledgeGraphPort,
  MatrixCellPersistenceRepo,
  NodeRecord,
  OrderedCellFillerPipeline,
} from "./ports.js";
import { SemanticPairConflictSweeper } from "./semantic-sweeper.js";
import {
  CONTRADICTION_EDGE_TYPE,
  buildResolutionOptions,
  constraintNodeIds,
  isSettledBasis,
  type ArchitecturalConstraint,
  type CatalogRuleEntry,
  type ConflictDraft,
  type ContradictionLayer,
  type IntervalSource,
  type MaterializedRequirement,
  type MatrixCellRecord,
  type SettledDecisionRef,
} from "./types.js";
import {
  Z3UnsatCoreSolver,
  assertionClause,
  conflictClause,
  exactlyOneClauses,
  implicationClause,
  nandClause,
  type Z3ClauseInput,
  type Z3Problem,
  type Z3SolveResult,
  type Z3SolveStatus,
} from "./z3-solver.js";

export interface FiveLayerContradictionEngineOptions {
  readonly graph: KnowledgeGraphPort;
  readonly inbox: ConflictInboxPort;
  readonly catalog: CatalogRuleSource;
  readonly matrices: MatrixCellPersistenceRepo;
  readonly filler: OrderedCellFillerPipeline;
  readonly model: ContradictionCheckModel;
  readonly solver?: Z3UnsatCoreSolver;
  readonly logger?: ContradictionLogger;
  readonly observer?: ContradictionObserver;
  readonly seed?: number;
  readonly now?: () => number;
}

export interface ContradictionReport {
  readonly detected: readonly ConflictDraft[];
  readonly active: readonly ConflictDraft[];
  readonly layer2Status: Z3SolveStatus;
  readonly deterministicMs: number;
  readonly elapsedMs: number;
  readonly llmBatchCount: number;
  readonly blocksReadiness: boolean;
  readonly blocksGraphCompilation: boolean;
  readonly warnings: readonly ContradictionWarning[];
}

const NOOP_LOGGER: ContradictionLogger = {
  warn(warning) {
    void warning;
  },
};

/**
 * Runs catalog rules, the bounded UNSAT-core solver, cross-matrix invariants,
 * interval checks, then grounded semantic pairs. Confirmed conflicts become
 * `contradicts` edges and conflict inbox items. Any current contradicts edge
 * blocks readiness and graph compilation.
 */
export class FiveLayerContradictionEngine {
  private readonly graph: KnowledgeGraphPort;
  private readonly inbox: ConflictInboxPort;
  private readonly catalog: CatalogRuleSource;
  private readonly matrixRepo: MatrixCellPersistenceRepo;
  private readonly filler: OrderedCellFillerPipeline;
  private readonly solver: Z3UnsatCoreSolver;
  private readonly logger: ContradictionLogger;
  private readonly observer: ContradictionObserver | undefined;
  private readonly now: () => number;
  private readonly catalogChecker = new CatalogRuleChecker();
  private readonly crossMatrix = new CrossMatrixInvariantChecker();
  private readonly intervals = new IntervalConflictDetector();
  private readonly semantic: SemanticPairConflictSweeper;

  constructor(options: FiveLayerContradictionEngineOptions) {
    this.graph = options.graph;
    this.inbox = options.inbox;
    this.catalog = options.catalog;
    this.matrixRepo = options.matrices;
    this.filler = options.filler;
    this.solver =
      options.solver ??
      new Z3UnsatCoreSolver({
        ...(options.seed === undefined ? {} : { seed: options.seed }),
        ...(options.now === undefined ? {} : { now: options.now }),
      });
    this.logger = options.logger ?? NOOP_LOGGER;
    this.observer = options.observer;
    this.now = options.now ?? Date.now;
    this.semantic = new SemanticPairConflictSweeper(options.model);
  }

  check(request: CheckRequest = {}): ContradictionReport {
    const started = this.now();
    const warnings: ContradictionWarning[] = [];
    const log = (warning: ContradictionWarning): void => {
      warnings.push(warning);
      this.logger.warn(warning);
    };
    const rules = this.catalog.listRules();
    const decisions = this.settledDecisions();
    const constraints = this.gatherConstraints(request.constraints ?? []);
    const cells = this.matrixRepo.listCells();
    const requirements = this.activeRequirements();
    const sources = this.intervalSources(requirements);
    const edited = request.editedNodeId;
    const impact = edited === undefined ? null : this.impactOf(edited, decisions, rules, constraints, sources);

    this.observer?.phase("layer1");
    const layer1Decisions = impact === null ? decisions : decisions.filter((decision) => impact.has(decision.id));
    const layer1 = this.catalogChecker.check(layer1Decisions, rules);

    this.observer?.phase("layer2");
    const layer2Constraints =
      impact === null ? constraints : constraints.filter((constraint) => constraintNodeIds(constraint).some((id) => impact.has(id)));
    const layer2 = this.solveLayer2(layer2Constraints, log);

    this.observer?.phase("layer3");
    const layer3 = this.layer3Conflicts(edited, cells);

    this.observer?.phase("layer4");
    const layer4Sources = edited === undefined ? sources : this.intervals.relatedSources(sources, edited);
    const layer4 = this.intervals.detect(layer4Sources);

    const deterministicMs = this.now() - started;
    this.observer?.phase("layer5");
    const layer5 = this.semantic.sweep(requirements, edited === undefined ? {} : { onlyTouching: edited });

    const detected = [...layer1, ...this.layer2Conflicts(layer2, layer2Constraints), ...layer3, ...layer4, ...layer5.conflicts];
    this.persist(detected, impact, layer2.status === "incomplete_timeout");
    const active = this.inbox.listOpenConflicts().map((item) => draftFromInbox(item));
    const blocking = this.hasActiveContradicts();
    return {
      detected,
      active,
      layer2Status: layer2.status,
      deterministicMs,
      elapsedMs: this.now() - started,
      llmBatchCount: layer5.batchSizes.length,
      blocksReadiness: blocking,
      blocksGraphCompilation: blocking,
      warnings,
    };
  }

  recheck(editedNodeId: string): ContradictionReport {
    return this.check({ editedNodeId });
  }

  blocksReadiness(): boolean {
    return this.hasActiveContradicts();
  }

  blocksGraphCompilation(): boolean {
    return this.hasActiveContradicts();
  }

  private solveLayer2(constraints: readonly ArchitecturalConstraint[], log: (warning: ContradictionWarning) => void): Z3SolveResult {
    const problem = problemFromConstraints(constraints, (id) => this.graph.getNode(id)?.title ?? id);
    try {
      const result = this.solver.solve(problem);
      if (result.status === "incomplete_timeout") {
        log({
          level: "warning",
          event: "z3_incomplete_timeout",
          timeoutMs: result.timeoutMs,
          layer: 2,
          message: "Z3 solve hit the 2000 ms cap. Layers 1, 3, 4, and 5 are preserved.",
        });
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Z3 solver failed";
      log({ level: "warning", event: "z3_solver_error", layer: 2, message });
      log({
        level: "warning",
        event: "z3_incomplete_timeout",
        timeoutMs: this.solver.timeoutMs,
        layer: 2,
        message: "Z3 solve failed closed as incomplete_timeout so the daemon keeps running.",
      });
      return {
        status: "incomplete_timeout",
        unsatCore: [],
        timeoutMs: this.solver.timeoutMs,
        seed: this.solver.seed,
        model: {},
      };
    }
  }

  private layer2Conflicts(result: Z3SolveResult, constraints: readonly ArchitecturalConstraint[]): ConflictDraft[] {
    if (result.status !== "unsat" || result.unsatCore.length === 0) return [];
    const titles = result.unsatCore.map((id) => this.graph.getNode(id)?.title ?? id);
    const bases = result.unsatCore.map((id) => this.graph.getNode(id)?.basis ?? "");
    return [
      {
        id: `L2:unsat_core:${[...result.unsatCore].sort().join("+")}`,
        layer: 2,
        nodeIds: [...result.unsatCore],
        ruleId: "unsat_core",
        plainEnglishConflict: `These decisions cannot all hold: ${titles.join(" + ")}.`,
        concreteCounterexample: explainCore(constraints, result.unsatCore),
        resolutionOptions: buildResolutionOptions(titles, bases),
      },
    ];
  }

  private layer3Conflicts(editedId: string | undefined, cells: readonly MatrixCellRecord[]): ConflictDraft[] {
    if (editedId !== undefined && !cellTouches(cells, editedId)) return [];
    const found = this.crossMatrix.check(cells).conflicts;
    if (editedId === undefined) return [...found];
    return found.filter((conflict) => conflict.nodeIds.includes(editedId));
  }

  private persist(detected: readonly ConflictDraft[], impact: ReadonlySet<string> | null, layer2Incomplete: boolean): void {
    const previous = this.inbox.listOpenConflicts();
    const merged = new Map<string, ConflictDraft>();
    for (const item of previous) {
      const draft = draftFromInbox(item);
      const inImpact = impact === null || draft.nodeIds.some((id) => impact.has(id));
      if (layer2Incomplete && draft.layer === 2) {
        merged.set(draft.id, draft);
        continue;
      }
      if (!inImpact) merged.set(draft.id, draft);
    }
    for (const conflict of detected) {
      if (impact !== null && !conflict.nodeIds.some((id) => impact.has(id))) continue;
      merged.set(conflict.id, conflict);
    }
    const desired = [...merged.values()];
    const desiredIds = new Set(desired.map((conflict) => conflict.id));
    const stamp = this.now();
    for (const conflict of desired) {
      const item: ConflictInboxItem = {
        id: conflict.id,
        kind: "conflict",
        status: "open",
        priority: 100,
        subject: conflict.plainEnglishConflict,
        createdAt: stamp,
        resolvedAt: null,
        payload: {
          layer: conflict.layer,
          minimalCoreNodeIds: conflict.nodeIds,
          plainEnglishConflict: conflict.plainEnglishConflict,
          concreteCounterexample: conflict.concreteCounterexample,
          resolutionOptions: conflict.resolutionOptions,
          ruleId: conflict.ruleId,
        },
      };
      this.inbox.upsertConflict(item);
    }
    for (const item of previous) {
      if (!desiredIds.has(item.id)) this.inbox.resolveConflict(item.id, stamp);
    }
    this.syncEdges(desired);
  }

  private syncEdges(conflicts: readonly ConflictDraft[]): void {
    const desired = new Set<string>();
    for (const conflict of conflicts) {
      const ids = [...new Set(conflict.nodeIds)].filter((id) => id.length > 0).sort();
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const src = ids[i];
          const dst = ids[j];
          if (src === undefined || dst === undefined || src === dst) continue;
          desired.add(`${src}\0${dst}`);
        }
      }
    }
    const current = this.graph.getEdgesAsOf(this.graph.currentRevision()).filter((edge) => edge.type === CONTRADICTION_EDGE_TYPE);
    const currentKeys = new Set(current.map((edge) => `${edge.src}\0${edge.dst}`));
    const edges: EdgeMutation[] = [];
    for (const key of desired) {
      if (currentKeys.has(key)) continue;
      const [src, dst] = key.split("\0");
      if (src === undefined || dst === undefined) continue;
      edges.push({ op: "create", src, type: CONTRADICTION_EDGE_TYPE, dst });
    }
    for (const edge of current) {
      if (desired.has(`${edge.src}\0${edge.dst}`)) continue;
      edges.push({ op: "retire", src: edge.src, type: edge.type, dst: edge.dst });
    }
    if (edges.length === 0) return;
    this.graph.commitChangeSet({
      origin: "kernel",
      author: "five-layer-contradiction-engine",
      summary: "sync contradicts edges",
      edges,
    });
  }

  private hasActiveContradicts(): boolean {
    return this.graph
      .getEdgesAsOf(this.graph.currentRevision())
      .some((edge) => edge.type === CONTRADICTION_EDGE_TYPE);
  }

  private settledDecisions(): SettledDecisionRef[] {
    const decisions: SettledDecisionRef[] = [];
    for (const node of this.graph.listNodes()) {
      const decision = asDecision(node);
      if (decision !== null) decisions.push(decision);
    }
    return decisions;
  }

  private gatherConstraints(extra: readonly ArchitecturalConstraint[]): ArchitecturalConstraint[] {
    const constraints: ArchitecturalConstraint[] = [...extra];
    for (const node of this.graph.listNodes()) {
      if (node.status === "retired") continue;
      constraints.push(...constraintsFromFields(node.fields));
    }
    return constraints;
  }

  private activeRequirements(): MaterializedRequirement[] {
    return this.filler
      .listMaterializedRequirements()
      .filter((requirement) => requirement.status !== "superseded" && requirement.status !== "retired");
  }

  private intervalSources(requirements: readonly MaterializedRequirement[]): IntervalSource[] {
    const sources = new Map<string, IntervalSource>();
    for (const requirement of requirements) {
      const text = `${requirement.text}\n${requirement.earsText}`;
      sources.set(
        requirement.id,
        requirement.claims === undefined ? { nodeId: requirement.id, text } : { nodeId: requirement.id, text, claims: requirement.claims },
      );
    }
    for (const node of this.graph.listNodes()) {
      if (node.status !== "active") continue;
      if (node.kind !== "decision" && node.kind !== "spec_item" && node.kind !== "rule") continue;
      const claims = claimsFromFields(node.fields);
      sources.set(node.id, claims.length > 0 ? { nodeId: node.id, text: node.text, claims } : { nodeId: node.id, text: node.text });
    }
    return [...sources.values()];
  }

  private impactOf(
    editedId: string,
    decisions: readonly SettledDecisionRef[],
    rules: readonly CatalogRuleEntry[],
    constraints: readonly ArchitecturalConstraint[],
    sources: readonly IntervalSource[],
  ): Set<string> {
    const impact = new Set<string>([editedId]);
    const rulesByOption = new Map(rules.map((rule) => [rule.optionId, rule]));
    const edited = this.graph.getNode(editedId);
    const editedOption = readString(readRecord(edited?.fields), "selectedOptionId");
    if (editedOption !== null) {
      const editedRule = rulesByOption.get(editedOption);
      for (const decision of decisions) {
        const otherRule = rulesByOption.get(decision.optionId);
        const conflicts =
          editedRule?.conflictsWith.includes(decision.optionId) === true ||
          otherRule?.conflictsWith.includes(editedOption) === true;
        const requires =
          editedRule?.requires.some((requirement) => requirement.optionId === decision.optionId || requirement.groupId === decision.groupId) ===
            true || otherRule?.requires.some((requirement) => requirement.optionId === editedOption) === true;
        if (conflicts || requires) impact.add(decision.id);
      }
    }
    const adjacency = new Map<string, Set<string>>();
    const link = (left: string, right: string): void => {
      const from = adjacency.get(left) ?? new Set<string>();
      from.add(right);
      adjacency.set(left, from);
      const back = adjacency.get(right) ?? new Set<string>();
      back.add(left);
      adjacency.set(right, back);
    };
    for (const constraint of constraints) {
      const ids = constraintNodeIds(constraint);
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const left = ids[i];
          const right = ids[j];
          if (left !== undefined && right !== undefined) link(left, right);
        }
      }
    }
    for (const id of impact) {
      for (const next of adjacency.get(id) ?? []) impact.add(next);
    }
    const queue = [...impact];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      for (const next of adjacency.get(current) ?? []) {
        if (impact.has(next)) continue;
        impact.add(next);
        queue.push(next);
      }
    }
    for (const source of this.intervals.relatedSources(sources, editedId)) impact.add(source.nodeId);
    return impact;
  }
}

function asDecision(node: NodeRecord): SettledDecisionRef | null {
  if (node.kind !== "decision" || node.status !== "active" || !isSettledBasis(node.basis)) return null;
  const fields = readRecord(node.fields);
  const optionId = readString(fields, "selectedOptionId");
  const groupId = readString(fields, "groupId");
  if (optionId === null || groupId === null) return null;
  return { id: node.id, title: node.title, optionId, groupId, basis: node.basis };
}

function constraintsFromFields(fields: unknown): ArchitecturalConstraint[] {
  const record = readRecord(fields);
  if (record === null || !Array.isArray(record.constraints)) return [];
  const constraints: ArchitecturalConstraint[] = [];
  for (const item of record.constraints) {
    const parsed = parseConstraint(item);
    if (parsed !== null) constraints.push(parsed);
  }
  return constraints;
}

function parseConstraint(value: unknown): ArchitecturalConstraint | null {
  const record = readRecord(value);
  if (record === null || typeof record.kind !== "string") return null;
  if (record.kind === "assert" && typeof record.nodeId === "string" && typeof record.value === "boolean") {
    return { kind: "assert", nodeId: record.nodeId, value: record.value };
  }
  if (record.kind === "implies" && typeof record.from === "string" && typeof record.to === "string") {
    return { kind: "implies", from: record.from, to: record.to };
  }
  if (record.kind === "conflicts" && typeof record.left === "string" && typeof record.right === "string") {
    return { kind: "conflicts", left: record.left, right: record.right };
  }
  if (record.kind === "exactly_one" || record.kind === "nand") {
    const nodeIds = readStringList(record, "nodeIds");
    if (nodeIds.length === 0) return null;
    return record.kind === "exactly_one" ? { kind: "exactly_one", nodeIds } : { kind: "nand", nodeIds };
  }
  return null;
}

function problemFromConstraints(constraints: readonly ArchitecturalConstraint[], titleOf: (id: string) => string): Z3Problem {
  const clauses: Z3ClauseInput[] = [];
  const ids = new Set<string>();
  for (const constraint of constraints) {
    for (const id of constraintNodeIds(constraint)) ids.add(id);
    clauses.push(...clausesFor(constraint));
  }
  return {
    nodes: [...ids].sort().map((id) => ({ id, title: titleOf(id) })),
    clauses,
  };
}

function clausesFor(constraint: ArchitecturalConstraint): Z3ClauseInput[] {
  switch (constraint.kind) {
    case "assert":
      return [assertionClause(constraint.nodeId, constraint.value)];
    case "implies":
      return [implicationClause(constraint.from, constraint.to)];
    case "conflicts":
      return [conflictClause(constraint.left, constraint.right)];
    case "exactly_one":
      return exactlyOneClauses(constraint.nodeIds);
    case "nand":
      return [nandClause(constraint.nodeIds)];
    default: {
      const neverConstraint: never = constraint;
      return neverConstraint;
    }
  }
}

function explainCore(constraints: readonly ArchitecturalConstraint[], core: readonly string[]): string {
  const set = new Set(core);
  const parts: string[] = [];
  for (const constraint of constraints) {
    if (!constraintNodeIds(constraint).some((id) => set.has(id))) continue;
    switch (constraint.kind) {
      case "assert":
        parts.push(`${constraint.nodeId} is ${constraint.value ? "true" : "false"}`);
        break;
      case "implies":
        parts.push(`${constraint.from} implies ${constraint.to}`);
        break;
      case "conflicts":
        parts.push(`${constraint.left} conflicts with ${constraint.right}`);
        break;
      case "exactly_one":
        parts.push(`exactly one of ${constraint.nodeIds.join(", ")} holds`);
        break;
      case "nand":
        parts.push(`not all of ${constraint.nodeIds.join(", ")} can hold`);
        break;
      default: {
        const neverConstraint: never = constraint;
        parts.push(String(neverConstraint));
      }
    }
  }
  if (parts.length === 0) return `No assignment satisfies ${core.join(", ")} together.`;
  return `${parts.join("; ")}. Removing any one of ${core.join(", ")} leaves a satisfiable set.`;
}

function cellTouches(cells: readonly MatrixCellRecord[], editedId: string): boolean {
  return cells.some(
    (cell) =>
      cell.id === editedId ||
      cell.actionId === editedId ||
      cell.entityId === editedId ||
      cell.screenActionId === editedId ||
      cell.stateId === editedId ||
      cell.fromState === editedId ||
      cell.toState === editedId,
  );
}

function draftFromInbox(item: ConflictInboxItem): ConflictDraft {
  const layer: ContradictionLayer = item.payload.layer;
  return {
    id: item.id,
    layer,
    nodeIds: item.payload.minimalCoreNodeIds,
    ruleId: item.payload.ruleId,
    plainEnglishConflict: item.payload.plainEnglishConflict,
    concreteCounterexample: item.payload.concreteCounterexample,
    resolutionOptions: item.payload.resolutionOptions,
  };
}
