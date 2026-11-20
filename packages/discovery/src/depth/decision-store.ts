import type { CatalogIndex } from "./catalog.js";
import { canonicalJson } from "./canonical-json.js";
import {
  decisionNodeId,
  decisionToJson,
  parseDecision,
  parseStage,
  projectStageNodeId,
  stageToJson,
} from "./decision-fields.js";
import { DepthError, UnknownCriterionError } from "./errors.js";
import type { ChangeOrigin, KnowledgeGraphRepo, NodeVersionRow } from "./knowledge-graph.js";
import type { MustAskPolicyFloor } from "./must-ask-floor.js";
import { stageProfile } from "./weights.js";
import type { DepthCatalogEntry, DepthClock, DepthDecision, ProjectStage } from "./types.js";

export type { NodeVersionRow };

interface PendingChange {
  readonly id: string;
  readonly rev: number;
}

/**
 * Reads and writes decision nodes through the local `KnowledgeGraphRepo` port.
 * Automatic settlements and explicit answers are separate methods so a delegated
 * click cannot stamp `basis = explicit`.
 */
export class DecisionStore {
  private pending: PendingChange | null = null;

  constructor(
    readonly graph: KnowledgeGraphRepo,
    private readonly clock: DepthClock,
    readonly workItemId: string,
  ) {}

  run<T>(origin: ChangeOrigin, summary: string, work: () => T): T {
    if (this.pending) return work();
    return this.graph.transaction(() => {
      this.pending = this.graph.insertChangeSet({
        origin,
        summary,
        createdAt: this.clock.now(),
      });
      try {
        return work();
      } finally {
        this.pending = null;
      }
    });
  }

  bootstrap(input: {
    readonly title: string;
    readonly stage: ProjectStage;
    readonly catalog: CatalogIndex;
    readonly floor: MustAskPolicyFloor;
  }): void {
    this.run("kernel", "seed discovery depth", () => {
      const createdAt = this.clock.now();
      this.graph.insertWorkItem({ id: this.workItemId, title: input.title, createdAt });
      this.writeStage(input.stage);
      for (const entry of input.catalog.entries()) {
        this.insertOpen(entry, input.floor);
      }
      this.appendScope("Initial discovery scope", input.catalog, input.floor, input.stage);
    });
  }

  list(): DepthDecision[] {
    return this.graph
      .listNodesByKind("decision")
      .map((node) => parseDecision(node.id, node.version, JSON.parse(node.fieldsJson)))
      .filter((decision) => decision.workItemId === this.workItemId);
  }

  require(criterionId: string): DepthDecision {
    const found = this.list().find((decision) => decision.criterionId === criterionId);
    if (!found) throw new UnknownCriterionError(`unknown criterion ${criterionId}`);
    return found;
  }

  persistedStage(): ProjectStage {
    const node = this.graph.getNode(projectStageNodeId(this.workItemId));
    if (!node) throw new DepthError("project stage node is missing");
    return parseStage(JSON.parse(node.fieldsJson)).stage;
  }

  writeStage(stage: ProjectStage): void {
    const profile = stageProfile(stage);
    const fields = stageToJson({
      role: "project_stage",
      workItemId: this.workItemId,
      stage,
      askThreshold: profile.askThreshold,
      importanceThreshold: profile.importanceThreshold,
      visibleQuestionCap: profile.visibleQuestionCap,
      verificationLevel: profile.verification.level,
    });
    const id = projectStageNodeId(this.workItemId);
    const current = this.graph.getNode(id);
    const change = this.change();
    if (!current) {
      this.graph.insertNode({
        id,
        kind: "arch_node",
        title: "Project stage",
        text: `${profile.label} stage`,
        fields,
        changeSetId: change.id,
        rev: change.rev,
      });
      return;
    }
    this.graph.updateNode({
      id,
      title: "Project stage",
      text: `${profile.label} stage`,
      fields,
      changeSetId: change.id,
      rev: change.rev,
      expectedVersion: current.version,
    });
  }

  save(decision: DepthDecision): DepthDecision {
    const current = this.require(decision.criterionId);
    const fields = decisionToJson({ ...decision, version: current.version, nodeId: current.nodeId });
    if (canonicalJson(fields) === canonicalJson(decisionToJson(current))) return current;
    const change = this.change();
    this.graph.updateNode({
      id: current.nodeId,
      title: decision.label,
      text: decisionText(decision),
      fields,
      changeSetId: change.id,
      rev: change.rev,
      expectedVersion: current.version,
    });
    return this.require(decision.criterionId);
  }

  appendScope(
    reason: string,
    catalog: CatalogIndex,
    floor: MustAskPolicyFloor,
    stage: ProjectStage,
  ): void {
    const change = this.change();
    const latest = this.graph.latestScope(this.workItemId);
    const scopeRev = (latest?.scopeRev ?? 0) + 1;
    this.graph.insertScope({
      workItemId: this.workItemId,
      scopeRev,
      createdRev: change.rev,
      reason,
    });
    for (const entry of catalog.entries()) {
      const assessment = floor.assess(entry);
      this.graph.insertScopeCriterion({
        workItemId: this.workItemId,
        scopeRev,
        decisionId: decisionNodeId(this.workItemId, entry.criterionId),
        neededForPlanning: entry.stageApplicability[stage],
        critical: assessment.mustAsk || assessment.reason !== null,
      });
    }
  }

  listVersions(criterionId: string): NodeVersionRow[] {
    return this.graph.listVersions(decisionNodeId(this.workItemId, criterionId));
  }

  linkDerived(dependentNodeId: string, premiseNodeId: string): void {
    const change = this.change();
    this.graph.insertEdge({
      src: dependentNodeId,
      type: "derived_from",
      dst: premiseNodeId,
      changeSetId: change.id,
      rev: change.rev,
    });
  }

  private insertOpen(entry: DepthCatalogEntry, floor: MustAskPolicyFloor): void {
    const assessment = floor.assess(entry);
    const status = entry.conflict ? "conflict" : (entry.initialStatus ?? "open");
    const decision: DepthDecision = {
      nodeId: decisionNodeId(this.workItemId, entry.criterionId),
      version: 1,
      criterionId: entry.criterionId,
      label: entry.label,
      status,
      value: null,
      workItemId: this.workItemId,
      impactLevel: entry.riskTier,
      downstreamTaskCount: entry.downstreamTaskCount,
      mustAsk: assessment.mustAsk,
      domain: entry.domain,
    };
    let stamped = decision;
    if (assessment.mustAskClass) stamped = { ...stamped, mustAskClass: assessment.mustAskClass };
    if (assessment.badge && (assessment.mustAsk || assessment.reason)) {
      stamped = { ...stamped, decisionBadge: assessment.badge };
    }
    if (entry.conflict) stamped = { ...stamped, conflict: true };
    if (entry.highRiskSpecExpander) stamped = { ...stamped, highRiskSpecExpander: true };
    if (entry.ambiguousBrownfield) stamped = { ...stamped, ambiguousBrownfield: true };
    const change = this.change();
    this.graph.insertNode({
      id: stamped.nodeId,
      kind: "decision",
      title: entry.label,
      text: decisionText(stamped),
      fields: decisionToJson(stamped),
      changeSetId: change.id,
      rev: change.rev,
    });
  }

  private change(): PendingChange {
    if (!this.pending) throw new DepthError("decision writes must run inside DecisionStore.run");
    return this.pending;
  }
}

function decisionText(decision: DepthDecision): string {
  if (decision.decisionBadge) return decision.decisionBadge;
  if (decision.rationale) return decision.rationale;
  return decision.label;
}
