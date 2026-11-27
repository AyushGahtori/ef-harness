import type { DatabaseSync } from "node:sqlite";

import { additiveUnits, batchClass, ChangeClassifier } from "./change-classifier.js";
import { EarlyCutoffReverifier } from "./early-cutoff.js";
import { canonicalFingerprint } from "./fingerprint.js";
import { RevisionGraph } from "./graph.js";
import { estimateDelta, RevisionImpactPreviewer } from "./impact-previewer.js";
import {
  AcceptingContradictionEngine,
  LocalPremiseSupersessionReopener,
  type FiveLayerContradictionPort,
  type KnowledgeGraphImpactPort,
  type PremiseSupersessionPort,
  type TaskHoldsPort,
} from "./ports.js";
import { ReverifyBeforeReworkGate } from "./reverify-before-rework.js";
import { ReverseImpactWalker } from "./reverse-impact-walker.js";
import { RevisionHistoryStore } from "./revision-history.js";
import {
  isActiveWorkingState,
  isMergedDoneState,
  isRequirementKind,
  DEFAULT_IMPACT_MAX_DEPTH,
  MICRO_USD_PER_DELTA_TASK,
  type ClassifiedChange,
  type ConflictCard,
  type ContradictionFinding,
  type RevisionBatchRecord,
  type RevisionCommitInput,
  type RevisionCommitter,
} from "./types.js";

export interface HybridRevisionEngineOptions {
  readonly db: DatabaseSync;
  readonly contradictionEngine?: FiveLayerContradictionPort;
  readonly premiseReopener?: PremiseSupersessionPort;
  readonly holds?: TaskHoldsPort;
  /** When set, the blast radius comes from `KnowledgeGraphRepo.impactWalk`. */
  readonly impact?: KnowledgeGraphImpactPort;
  readonly now?: () => number;
  readonly maxDepth?: number;
  readonly microUsdPerDeltaTask?: number;
}

export class HybridRevisionEngine implements RevisionCommitter {
  readonly graph: RevisionGraph;
  readonly walker: ReverseImpactWalker;
  readonly classifier = new ChangeClassifier();
  readonly previewer = new RevisionImpactPreviewer();
  readonly reverify = new ReverifyBeforeReworkGate();
  readonly cutoff: EarlyCutoffReverifier;
  readonly history: RevisionHistoryStore;
  readonly contradictionEngine: FiveLayerContradictionPort;
  readonly premiseReopener: PremiseSupersessionPort;
  readonly holds: TaskHoldsPort;
  private readonly impact: KnowledgeGraphImpactPort | null;
  private readonly now: () => number;
  private readonly maxDepth: number;
  private readonly microUsdPerDeltaTask: number;

  constructor(options: HybridRevisionEngineOptions) {
    this.graph = new RevisionGraph(options.db);
    this.walker = new ReverseImpactWalker(options.db, options.maxDepth);
    this.cutoff = new EarlyCutoffReverifier(this.graph);
    this.history = new RevisionHistoryStore(options.db);
    this.contradictionEngine = options.contradictionEngine ?? new AcceptingContradictionEngine();
    this.premiseReopener = options.premiseReopener ?? new LocalPremiseSupersessionReopener();
    this.holds = options.holds ?? new GraphTaskHolds(this.graph);
    this.impact = options.impact ?? null;
    this.now = options.now ?? (() => Date.now());
    this.maxDepth = options.maxDepth ?? DEFAULT_IMPACT_MAX_DEPTH;
    this.microUsdPerDeltaTask = options.microUsdPerDeltaTask ?? MICRO_USD_PER_DELTA_TASK;
  }

  commitBatch(input: RevisionCommitInput): RevisionBatchRecord {
    if (input.edits.length === 0) throw new Error("revision batch requires at least one edit");
    this.graph.db.exec("BEGIN IMMEDIATE");
    try {
      const record = this.commitInside(input);
      this.graph.db.exec("COMMIT");
      return record;
    } catch (error) {
      this.graph.db.exec("ROLLBACK");
      throw error;
    }
  }

  private commitInside(input: RevisionCommitInput): RevisionBatchRecord {
    const changes = input.edits.map((edit) => this.classifier.classify(edit));
    const changeClass = batchClass(changes);
    const contradiction = this.contradictionEngine.checkCombinedState({ edits: input.edits });
    const conflictCard = contradiction.contradictions.length > 0 ? toConflictCard(contradiction.contradictions) : null;
    const propagating = changes.filter((change) => change.changeClass !== "cosmetic");
    const createdAt = this.now();
    const revisionId = this.history.nextId();

    let impactedNodeIds: string[] = [];
    let earlyCutoffNodeIds: string[] = [];
    if (propagating.length > 0) {
      const roots = propagating.map((change) => change.edit.nodeId);
      if (this.impact) {
        const best = new Map<string, number>();
        for (const root of roots) {
          for (const node of this.impact.impactWalk(root, this.maxDepth)) {
            const previous = best.get(node.id);
            if (previous === undefined || node.depth < previous) best.set(node.id, node.depth);
          }
        }
        impactedNodeIds = [...best.keys()].sort();
        earlyCutoffNodeIds = [];
      } else {
        const walk = this.walker.walkCombined(roots);
        const pruned = this.cutoff.prune({
          roots,
          walkIds: new Set(walk.nodes.map((node) => node.id)),
          upstreamToken: canonicalFingerprint(roots.map((id) => input.edits.find((edit) => edit.nodeId === id)?.afterText ?? id)),
        });
        impactedNodeIds = [...pruned.impactedNodeIds].sort();
        earlyCutoffNodeIds = [...pruned.earlyCutoffNodeIds];
      }
    }

    const blast = describeBlast(this.graph, impactedNodeIds);
    const additiveCount = propagating.reduce((sum, change) => sum + additiveUnits(change), 0);
    const estimate = estimateDelta({
      changeClass,
      additiveCount,
      finishedTaskCount: blast.finishedTaskIds.length,
      microUsdPerDeltaTask: this.microUsdPerDeltaTask,
    });
    const preview = this.previewer.format({
      contractCount: blast.contractIds.length,
      activeTasks: blast.activeTasks,
      finishedTaskCount: blast.finishedTaskIds.length,
      untouchedTaskCount: blast.untouchedTaskCount,
      deltaTasks: estimate.deltaTasks,
      deltaCostMicroUsd: estimate.deltaCostMicroUsd,
    });

    const reverifiedPassedIds: string[] = [];
    const reworkTaskIds: string[] = [];
    const additiveTaskIds: string[] = [];
    const holdTaskIds: string[] = [];

    if (conflictCard === null) {
      if (changeClass === "breaking") {
        for (const task of blast.activeTasks) {
          this.holds.placeHold({
            taskId: task.id,
            reason: "requirement_change",
            source: revisionId,
            createdAt,
          });
          holdTaskIds.push(task.id);
        }
      }
      if (changeClass === "clarifying" || changeClass === "compatible" || changeClass === "breaking") {
        const impacted = new Set(impactedNodeIds);
        for (const taskId of blast.finishedTaskIds) {
          const task = this.graph.loadNode(taskId);
          if (!task) continue;
          const checks = this.graph
            .checksForTask(taskId)
            .filter((check) => impacted.has(check.requirementId));
          const decision = this.reverify.evaluate(taskId, this.graph.satisfiedChecks(task), checks);
          if (decision.outcome === "verified_under_rev") {
            this.graph.markVerified(taskId);
            reverifiedPassedIds.push(taskId);
          } else {
            const reworkId = `RW-${revisionId}-${taskId}`;
            this.graph.insertSpawn({
              id: reworkId,
              revisionId,
              kind: "rework",
              sourceTask: taskId,
              payload: { failingChecks: decision.failingChecks },
            });
            reworkTaskIds.push(reworkId);
          }
        }
      }
      if (changeClass === "compatible") {
        let additiveIndex = 0;
        for (const change of propagating) {
          const units = additiveUnits(change);
          for (let index = 0; index < units; index += 1) {
            additiveIndex += 1;
            const additiveId = `ADD-${revisionId}-${additiveIndex}`;
            this.graph.insertSpawn({
              id: additiveId,
              revisionId,
              kind: "additive",
              sourceTask: null,
              payload: { nodeId: change.edit.nodeId, reasons: change.reasons },
            });
            additiveTaskIds.push(additiveId);
          }
        }
      }
      for (const change of changes) {
        if (change.changeClass !== "breaking") continue;
        if (!isPremise(change)) continue;
        this.premiseReopener.reopenDependents(change.edit.nodeId, "revised");
      }
      for (const change of changes) {
        this.graph.updateNode(change.edit.nodeId, change.edit.afterText, change.edit.afterFields);
      }
    }

    const record: RevisionBatchRecord = {
      revisionId,
      triggerSource: input.triggerSource,
      changeClass,
      editedNodeIds: uniqueInOrder(input.edits.map((edit) => edit.nodeId)),
      impactedNodeIds,
      earlyCutoffNodeIds,
      reverifiedPassedIds: [...reverifiedPassedIds].sort(),
      reworkTaskIds,
      additiveTaskIds,
      holdTaskIds: [...holdTaskIds].sort(),
      conflictCard,
      preview,
      llmCalls: this.previewer.llmCalls,
      createdAt,
    };
    this.history.insert(record);
    return record;
  }
}

class GraphTaskHolds implements TaskHoldsPort {
  constructor(private readonly graph: RevisionGraph) {}

  placeHold(input: {
    readonly taskId: string;
    readonly reason: "requirement_change";
    readonly source: string;
    readonly createdAt: number;
  }): void {
    this.graph.placeHold(input.taskId, input.reason, input.source, input.createdAt);
  }
}

function toConflictCard(contradictions: readonly ContradictionFinding[]): ConflictCard {
  const pairs = contradictions.map((finding) => `${finding.src} contradicts ${finding.dst}`).join("; ");
  return {
    kind: "conflict_card",
    contradictions,
    message: `Revision paused: ${contradictions.length} unresolved contradiction(s) (${pairs}). Rework will not start until the conflict is settled.`,
  };
}

function isPremise(change: ClassifiedChange): boolean {
  return change.edit.nodeKind === "decision" || isRequirementKind(change.edit.nodeKind);
}

function uniqueInOrder(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function describeBlast(graph: RevisionGraph, impactedNodeIds: readonly string[]): {
  readonly contractIds: string[];
  readonly activeTasks: { readonly id: string; readonly title: string }[];
  readonly finishedTaskIds: string[];
  readonly untouchedTaskCount: number;
} {
  const impacted = new Set(impactedNodeIds);
  const contractIds: string[] = [];
  const activeTasks: { id: string; title: string }[] = [];
  const finishedTaskIds: string[] = [];
  for (const id of impactedNodeIds) {
    const node = graph.loadNode(id);
    if (!node) continue;
    if (node.kind === "contract") contractIds.push(id);
    if (node.kind !== "task") continue;
    const runtime = graph.taskRuntime(id);
    if (!runtime) continue;
    if (isActiveWorkingState(runtime.state)) {
      activeTasks.push({ id, title: graph.taskTitle(id, node.title) });
    } else if (isMergedDoneState(runtime.state)) {
      finishedTaskIds.push(id);
    }
  }
  activeTasks.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const untouchedTaskCount = graph.allTaskIds().filter((id) => !impacted.has(id)).length;
  return {
    contractIds: contractIds.sort(),
    activeTasks,
    finishedTaskIds: finishedTaskIds.sort(),
    untouchedTaskCount,
  };
}
