import type { ProjectStateDb } from "@ef-harness/db";
import { chunkTurnWithOffsets } from "../core/chunk-turn.js";
import { parseDecisionFields, toDecisionNodeFields } from "../core/decision-fields.js";
import { presentOpening } from "../core/opening-prompts.js";
import { AskValueInterrogationGuard } from "../depth/ask-value-guard.js";
import { CatalogIndex } from "../depth/catalog.js";
import { DecisionStore } from "../depth/decision-store.js";
import { AcceptAllRecommendedAction } from "../depth/delegation.js";
import { BasisHonestyError } from "../depth/errors.js";
import { MustAskPolicyFloor } from "../depth/must-ask-floor.js";
import { StageDepthController } from "../depth/stage-depth-controller.js";
import type { AcceptAllResult, DepthCatalogEntry, DepthDecision, ProjectStage } from "../depth/types.js";
import { selectNextBatch } from "../selector/engine.js";
import type { DiscoveryBatchStore } from "../selector/store.js";
import type { CatalogQuestion, CriterionState, DiscoveryBatchRecord } from "../selector/types.js";
import { AdaptiveBatchSelector } from "./adaptive-selector.js";
import { HonestReadinessCalculator, type HonestReadinessCounts } from "./honest-readiness.js";
import { ProjectStateDepthGraph } from "./project-state-graph.js";

export interface ObservedCriterionSettlement {
  readonly criterionId: string;
  readonly value: string;
}

export interface DiscoverySessionStart {
  readonly workItemId: string;
  readonly stage: ProjectStage;
  readonly criterionIds: readonly string[];
  readonly visibleQuestionCap: number;
}

export interface IngestedDiscoveryTurn {
  readonly workItemId: string;
  readonly turnId: string;
  readonly chunkCount: number;
  readonly openingPromptId: string;
  readonly askedCriterionIds: readonly string[];
  readonly batchId: string;
}

export interface ObservedSettlementResult {
  readonly workItemId: string;
  readonly settledCriterionIds: readonly string[];
  readonly skippedCriterionIds: readonly string[];
  readonly askedCriterionIds: readonly string[];
}

interface LiveSession {
  readonly workItemId: string;
  readonly store: DecisionStore;
  readonly catalog: CatalogIndex;
  readonly depth: StageDepthController;
  readonly accept: AcceptAllRecommendedAction;
  readonly questions: readonly CatalogQuestion[];
  turns: number;
}

/**
 * One discovery session over `ProjectStateDb`: opening turns, delegated
 * defaults, observed brownfield settlements, and exact readiness counts.
 */
export class DiscoverySessionCoordinator {
  private readonly graph: ProjectStateDepthGraph;
  private readonly readiness: HonestReadinessCalculator;
  private readonly now: () => number;
  private readonly sessions = new Map<string, LiveSession>();
  private readonly batches: DiscoveryBatchStore;

  constructor(options: { readonly stateDb: ProjectStateDb; readonly now?: () => number }) {
    this.graph = new ProjectStateDepthGraph(options.stateDb);
    this.readiness = new HonestReadinessCalculator(options.stateDb);
    this.now = options.now ?? (() => Date.now());
    this.batches = {
      insert: (record) => {
        this.graph.insertBatch({
          id: record.id,
          workItemId: record.workItemId,
          scopeRev: record.scopeRev,
          questionsJson: record.questionsJson,
          cursor: record.cursor,
          createdAt: record.createdAt,
        });
      },
      get: (id) => readStoredBatch(this.graph.readBatchJson(id)),
    };
  }

  async close(): Promise<void> {
    await this.graph.drain();
  }

  startSession(input: {
    readonly workItemId: string;
    readonly title: string;
    readonly catalog: readonly DepthCatalogEntry[];
    readonly stage?: ProjectStage;
    readonly prompt?: string;
  }): DiscoverySessionStart {
    if (this.sessions.has(input.workItemId)) {
      throw new Error(`discovery session ${input.workItemId} is already open`);
    }
    if (input.catalog.length === 0) throw new Error("discovery catalog is empty");
    const stage = input.stage ?? "prototype";
    const catalog = new CatalogIndex(input.catalog);
    const floor = new MustAskPolicyFloor(input.prompt ?? "");
    const store = new DecisionStore(this.graph, { now: this.now }, input.workItemId);
    store.bootstrap({ title: input.title, stage, catalog, floor });
    const guard = new AskValueInterrogationGuard(store, floor, catalog, { now: this.now });
    const depth = new StageDepthController(store, guard, catalog, floor);
    const chip = depth.chip();
    const accept = new AcceptAllRecommendedAction(store, floor, catalog, new AdaptiveBatchSelector(), {
      now: this.now,
    });
    const questions = input.catalog.map((entry) => questionFrom(entry, floor.assess(entry).mustAsk));
    this.sessions.set(input.workItemId, {
      workItemId: input.workItemId,
      store,
      catalog,
      depth,
      accept,
      questions,
      turns: 0,
    });
    return {
      workItemId: input.workItemId,
      stage: chip.stage,
      criterionIds: input.catalog.map((entry) => entry.criterionId),
      visibleQuestionCap: chip.visibleQuestionCap,
    };
  }

  ingestUserTurn(input: { readonly workItemId: string; readonly text: string; readonly opId: string }): IngestedDiscoveryTurn {
    const session = this.requireSession(input.workItemId);
    const text = input.text;
    if (text.trim().length === 0) throw new Error("discovery turn text is empty");
    if (input.opId.trim().length === 0) throw new Error("discovery turn opId is empty");
    const turnId = `turn:${input.opId}`;
    this.graph.insertTurn({ id: turnId, text, createdAt: this.now() });
    session.turns += 1;
    const opening = presentOpening({ mode: "talk_it_through" });
    const first = opening.prompts[0];
    if (!first) throw new Error("opening prompts are missing");
    const batch = this.ask(session, `batch:${input.opId}`);
    return {
      workItemId: input.workItemId,
      turnId,
      chunkCount: chunkTurnWithOffsets(text).length,
      openingPromptId: first.id,
      askedCriterionIds: coveredCriteria(batch),
      batchId: batch.id,
    };
  }

  acceptRecommendedDefaults(input: {
    readonly workItemId: string;
    readonly scope?: "batch" | "open";
  }): AcceptAllResult {
    const session = this.requireSession(input.workItemId);
    const scope = input.scope ?? "open";
    const result = session.accept.accept({ scope });
    for (const criterionId of result.delegatedCriterionIds) {
      this.assertBasis(session, criterionId, "delegated");
    }
    return result;
  }

  preSettleObservedCriteria(input: {
    readonly workItemId: string;
    readonly settlements: readonly ObservedCriterionSettlement[];
  }): ObservedSettlementResult {
    const session = this.requireSession(input.workItemId);
    const settled: string[] = [];
    const skipped: string[] = [];
    session.store.run("research", "pre-settle observed criteria", () => {
      for (const settlement of input.settlements) {
        if (settlement.value.trim().length === 0) {
          throw new Error(`observed value for ${settlement.criterionId} is empty`);
        }
        const current = session.store.require(settlement.criterionId);
        if (current.basis !== undefined || current.status === "settled") {
          skipped.push(settlement.criterionId);
          continue;
        }
        session.store.save(observedDecision(current, settlement.value));
        settled.push(settlement.criterionId);
      }
    });
    for (const criterionId of settled) this.assertBasis(session, criterionId, "observed");
    session.turns += 1;
    const batch = this.ask(session, `batch:observed:${String(session.turns)}`);
    return {
      workItemId: input.workItemId,
      settledCriterionIds: settled,
      skippedCriterionIds: skipped,
      askedCriterionIds: coveredCriteria(batch),
    };
  }

  getReadinessSnapshot(workItemId: string): HonestReadinessCounts {
    this.requireSession(workItemId);
    return this.readiness.snapshot(workItemId);
  }

  private ask(session: LiveSession, batchId: string): DiscoveryBatchRecord {
    const scope = this.graph.latestScope(session.workItemId);
    const cap = session.depth.profile().visibleQuestionCap;
    const selected = selectNextBatch({
      workItemId: session.workItemId,
      scopeRev: scope?.scopeRev ?? 1,
      batchId,
      catalogVersion: "discovery-session",
      criteria: session.store.list().map(criterionState),
      catalog: session.questions,
      turn: session.turns,
      createdAt: this.now(),
      lastOptionsVersion: 0,
      projectLocalCount: 0,
      targetSize: cap,
      batchStore: this.batches,
    });
    return selected.batch;
  }

  private assertBasis(session: LiveSession, criterionId: string, basis: "delegated" | "observed"): void {
    const stored = session.store.require(criterionId);
    const node = this.graph.getNode(stored.nodeId);
    if (!node) throw new BasisHonestyError(`decision ${criterionId} disappeared`);
    const fields = parseDecisionFields(JSON.parse(node.fieldsJson));
    const shaped = toDecisionNodeFields(fields);
    if (fields.basis !== basis || shaped.basis !== basis) {
      throw new BasisHonestyError(`${criterionId} basis is ${String(fields.basis)}, expected ${basis}`);
    }
    if (basis === "delegated" && shaped.selectedOptionId !== stored.value) {
      throw new BasisHonestyError(`${criterionId} delegated settlement lost its option`);
    }
    if (typeof stored.value === "string" && shaped.selectedOptionId !== stored.value) {
      throw new BasisHonestyError(`${criterionId} selected option does not match the stored value`);
    }
  }

  private requireSession(workItemId: string): LiveSession {
    const session = this.sessions.get(workItemId);
    if (!session) throw new Error(`discovery session ${workItemId} is not open`);
    return session;
  }
}

function observedDecision(current: DepthDecision, value: string): DepthDecision {
  const next: DepthDecision = {
    nodeId: current.nodeId,
    version: current.version,
    criterionId: current.criterionId,
    label: current.label,
    status: "settled",
    value,
    workItemId: current.workItemId,
    impactLevel: current.impactLevel,
    downstreamTaskCount: current.downstreamTaskCount,
    mustAsk: current.mustAsk,
    basis: "observed",
    rationale: "Observed before the question was asked.",
  };
  return keepIdentity(current, next);
}

function keepIdentity(current: DepthDecision, next: DepthDecision): DepthDecision {
  let stamped = next;
  if (current.domain !== undefined) stamped = { ...stamped, domain: current.domain };
  if (current.mustAskClass !== undefined) stamped = { ...stamped, mustAskClass: current.mustAskClass };
  if (current.conflict === true) stamped = { ...stamped, conflict: true };
  if (current.highRiskSpecExpander === true) stamped = { ...stamped, highRiskSpecExpander: true };
  if (current.ambiguousBrownfield === true) stamped = { ...stamped, ambiguousBrownfield: true };
  return stamped;
}

function questionFrom(entry: DepthCatalogEntry, mustAsk: boolean): CatalogQuestion {
  return {
    id: entry.criterionId,
    text: entry.label,
    options: entry.options.map((option, index) => ({
      id: option.id,
      label: option.label,
      recommended: index === 0,
    })),
    targetCriteria: [entry.criterionId],
    requiresSettled: [],
    touches: [],
    catalogPriority: 0,
    complex: false,
    conflictResolution: entry.conflict === true,
    mustAsk,
    bundleGroup: null,
    whyAsking: entry.label,
    projectLocal: false,
  };
}

function criterionState(decision: DepthDecision): CriterionState {
  return {
    id: decision.criterionId,
    decisionId: decision.nodeId,
    label: decision.label,
    status: decision.status,
    mustAsk: decision.mustAsk,
    scope: "leaf",
    askCount: 0,
    lastAskedTurn: null,
    skipCount: 0,
    ambiguous: decision.ambiguousBrownfield === true,
    requiresSettled: [],
  };
}

function coveredCriteria(batch: DiscoveryBatchRecord): string[] {
  const ids: string[] = [];
  for (const question of batch.snapshot) {
    for (const criterionId of question.targetCriteria) {
      if (!ids.includes(criterionId)) ids.push(criterionId);
    }
  }
  return ids;
}

function readStoredBatch(json: string | null): DiscoveryBatchRecord | null {
  if (json === null) return null;
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.work_item !== "string") return null;
  if (typeof record.scope_rev !== "number" || !Array.isArray(record.question_ids)) return null;
  if (!Array.isArray(record.snapshot) || typeof record.catalog_version !== "string") return null;
  return {
    id: record.id,
    workItemId: record.work_item,
    scopeRev: record.scope_rev,
    status: "open",
    questionIds: record.question_ids.map((item) => String(item)),
    questionsJson: json,
    snapshot: record.snapshot as DiscoveryBatchRecord["snapshot"],
    splitCard: record.split_card === null || record.split_card === undefined
      ? null
      : (record.split_card as DiscoveryBatchRecord["splitCard"]),
    diagnostics: Array.isArray(record.diagnostics) ? (record.diagnostics as DiscoveryBatchRecord["diagnostics"]) : [],
    cursor: typeof record.cursor === "number" ? record.cursor : 0,
    createdAt: typeof record.created_at === "number" ? record.created_at : 0,
    catalogVersion: record.catalog_version,
    askUpdates: Array.isArray(record.ask_updates) ? (record.ask_updates as DiscoveryBatchRecord["askUpdates"]) : [],
  };
}
