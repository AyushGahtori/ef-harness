import { AskValueInterrogationGuard } from "./ask-value-guard.js";
import { AutopilotDelegationEngine } from "./autopilot.js";
import { CatalogIndex } from "./catalog.js";
import { ChosenForYouLedger } from "./chosen-for-you-ledger.js";
import { AcceptAllRecommendedAction } from "./delegation.js";
import { derivedFields, explicitFields } from "./decision-fields.js";
import { DecisionStore } from "./decision-store.js";
import { RecommendationError } from "./errors.js";
import { LocalGreedyQuestionSelector, type GreedyQuestionSelector } from "./greedy-selector.js";
import { openDepthKnowledgeGraph, type KnowledgeGraphRepo, type NodeVersionRow } from "./knowledge-graph.js";
import { MustAskPolicyFloor } from "./must-ask-floor.js";
import { LocalPremiseSupersessionReopener, type PremiseSupersessionReopener } from "./premise-reopener.js";
import { StageDepthController } from "./stage-depth-controller.js";
import type {
  AcceptAllResult,
  AutopilotResult,
  DepthCatalogEntry,
  DepthClock,
  DepthDecision,
  OverrideResult,
  ProjectStage,
  RecommendationResolution,
  ReconcileResult,
  StageChipModel,
  StageProfile,
  StageSwitchResult,
} from "./types.js";
import { systemClock } from "./types.js";

export interface DepthSessionOptions {
  readonly catalog: readonly DepthCatalogEntry[];
  readonly workItemId?: string;
  readonly title?: string;
  readonly prompt?: string;
  readonly stage?: ProjectStage;
  readonly clock?: DepthClock;
  readonly filename?: string;
  readonly selector?: GreedyQuestionSelector;
  readonly reopener?: PremiseSupersessionReopener;
}

/** Wires the depth controllers to an in-memory `schema/state.sql` database. */
export class DepthSession {
  readonly graph: KnowledgeGraphRepo;
  readonly floor: MustAskPolicyFloor;
  readonly guard: AskValueInterrogationGuard;
  readonly stages: StageDepthController;
  readonly autopilot: AutopilotDelegationEngine;
  readonly ledger: ChosenForYouLedger;
  readonly selector: GreedyQuestionSelector;
  readonly reopener: PremiseSupersessionReopener;
  private readonly store: DecisionStore;
  private readonly catalogIndex: CatalogIndex;
  private readonly acceptAllAction: AcceptAllRecommendedAction;

  constructor(options: DepthSessionOptions) {
    const stage = options.stage ?? "mvp";
    this.graph = openDepthKnowledgeGraph(options.filename ?? ":memory:");
    this.catalogIndex = new CatalogIndex(options.catalog);
    this.floor = new MustAskPolicyFloor(options.prompt ?? "");
    const clock = options.clock ?? systemClock();
    this.store = new DecisionStore(this.graph, clock, options.workItemId ?? "project-1");
    this.selector = options.selector ?? new LocalGreedyQuestionSelector();
    this.reopener = options.reopener ?? new LocalPremiseSupersessionReopener(this.graph, this.store);
    this.guard = new AskValueInterrogationGuard(this.store, this.floor, this.catalogIndex, clock);
    this.stages = new StageDepthController(this.store, this.guard, this.catalogIndex, this.floor);
    this.acceptAllAction = new AcceptAllRecommendedAction(
      this.store,
      this.floor,
      this.catalogIndex,
      this.selector,
      clock,
    );
    this.autopilot = new AutopilotDelegationEngine(this.store, this.floor, this.catalogIndex, this.selector, clock);
    this.ledger = new ChosenForYouLedger(this.store, this.catalogIndex);
    this.store.bootstrap({
      title: options.title ?? "Project",
      stage,
      catalog: this.catalogIndex,
      floor: this.floor,
    });
    this.store.run("kernel", "apply ask_value guard", () => {
      this.guard.reconcile(stage);
    });
  }

  close(): void {
    this.graph.close();
  }

  decisions(): readonly DepthDecision[] {
    return this.store.list();
  }

  decision(criterionId: string): DepthDecision {
    return this.store.require(criterionId);
  }

  versions(criterionId: string): readonly NodeVersionRow[] {
    return this.store.listVersions(criterionId);
  }

  stage(): ProjectStage {
    return this.store.persistedStage();
  }

  profile(): StageProfile {
    return this.stages.profile();
  }

  chip(): StageChipModel {
    return this.stages.chip();
  }

  scopeReason(): string | null {
    return this.graph.latestScope(this.store.workItemId)?.reason ?? null;
  }

  recommendationFor(criterionId: string): RecommendationResolution {
    return this.stages.recommendationFor(criterionId);
  }

  switchStage(stage: ProjectStage): StageSwitchResult {
    return this.stages.switchStage(stage);
  }

  acceptAllRecommended(input?: {
    readonly scope?: "batch" | "open";
    readonly criterionIds?: readonly string[];
    readonly k?: number;
  }): AcceptAllResult {
    return this.acceptAllAction.accept(input);
  }

  runAutopilot(input?: { readonly cancelAfter?: number }): AutopilotResult {
    return this.autopilot.run(input);
  }

  overrideChosen(criterionId: string, optionId: string): OverrideResult {
    return this.ledger.override(criterionId, optionId, this.reopener);
  }

  recordExplicit(criterionId: string, optionId: string): void {
    const entry = this.catalogIndex.get(criterionId);
    if (!entry.options.some((option) => option.id === optionId)) {
      throw new RecommendationError(`${criterionId} has no option ${optionId}`);
    }
    this.store.run("chat", `explicit ${criterionId}`, () => {
      const current = this.store.require(criterionId);
      this.store.save(
        explicitFields({
          current,
          optionId,
          rationale: "Answered directly.",
        }),
      );
    });
  }

  linkDerived(dependentCriterionId: string, premiseCriterionId: string, optionId: string): void {
    const entry = this.catalogIndex.get(dependentCriterionId);
    if (!entry.options.some((option) => option.id === optionId)) {
      throw new RecommendationError(`${dependentCriterionId} has no option ${optionId}`);
    }
    this.store.run("kernel", `derive ${dependentCriterionId}`, () => {
      const dependent = this.store.require(dependentCriterionId);
      const premise = this.store.require(premiseCriterionId);
      this.store.save(
        derivedFields({
          current: dependent,
          optionId,
          rationale: `Derived from ${premise.criterionId}.`,
        }),
      );
      this.store.linkDerived(dependent.nodeId, premise.nodeId);
    });
  }

  noteUserText(text: string): ReconcileResult {
    this.floor.noteUserText(text);
    const stage = this.store.persistedStage();
    return this.store.run("chat", "note user text", () => this.guard.reconcile(stage));
  }
}
