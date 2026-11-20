import { planCriterion } from "./ask-value-guard.js";
import type { CatalogIndex } from "./catalog.js";
import { automaticFields } from "./decision-fields.js";
import type { DecisionStore } from "./decision-store.js";
import type { GreedyQuestionSelector } from "./greedy-selector.js";
import type { MustAskPolicyFloor } from "./must-ask-floor.js";
import type { AutopilotResult, DepthClock, GreedyQuestionCandidate, HaltReason } from "./types.js";

interface Blocker {
  readonly criterionId: string;
  readonly reason: HaltReason;
  readonly badge: string | null;
}

/**
 * Delegates every open, non-must-ask, non-conflict criterion with its stage
 * recommendation. Each criterion is its own transaction, so cancelling after a
 * commit leaves that decision complete and does not start the next one.
 * The run hands control back on a must-ask, a conflict, a high-risk
 * `spec-expander@1` proposal, an ambiguous brownfield finding, or a missing
 * safe recommendation.
 */
export class AutopilotDelegationEngine {
  constructor(
    private readonly store: DecisionStore,
    private readonly floor: MustAskPolicyFloor,
    private readonly catalog: CatalogIndex,
    private readonly selector: GreedyQuestionSelector,
    private readonly clock: DepthClock,
  ) {}

  run(input?: { readonly cancelAfter?: number }): AutopilotResult {
    const stage = this.store.persistedStage();
    const settledCriterionIds: string[] = [];
    const cancelAfter = input?.cancelAfter;
    let pool = this.resolvableIds();
    while (pool.length > 0) {
      if (cancelAfter !== undefined && settledCriterionIds.length >= cancelAfter) {
        return this.finish(settledCriterionIds, true);
      }
      const batch = this.selector.selectBatch(
        pool.map((criterionId, index) => this.candidate(criterionId, index)),
        4,
      );
      const ids = batch.length > 0 ? batch.flatMap((question) => [...question.criterionIds]) : pool.slice(0, 1);
      let progressed = false;
      for (const criterionId of ids) {
        if (cancelAfter !== undefined && settledCriterionIds.length >= cancelAfter) {
          return this.finish(settledCriterionIds, true);
        }
        const current = this.store.require(criterionId);
        const entry = this.catalog.get(criterionId);
        const plan = planCriterion(entry, current, stage, this.floor);
        if (plan.blockReason !== null || plan.recommendation.kind !== "option" || current.basis !== undefined) {
          continue;
        }
        this.store.run("kernel", `autopilot ${criterionId}`, () => {
          const fresh = this.store.require(criterionId);
          const freshPlan = planCriterion(entry, fresh, stage, this.floor);
          if (freshPlan.blockReason !== null || freshPlan.recommendation.kind !== "option" || fresh.basis !== undefined) {
            return;
          }
          this.store.save(
            automaticFields({
              current: fresh,
              basis: "delegated",
              optionId: freshPlan.recommendation.optionId,
              rationale: freshPlan.recommendation.rationale,
              stage,
              at: this.clock.now(),
              askValue: freshPlan.score.askValue,
              impact: freshPlan.score.impact,
              uncertainty: freshPlan.score.uncertainty,
            }),
          );
        });
        const saved = this.store.require(criterionId);
        if (saved.basis === "delegated") {
          settledCriterionIds.push(criterionId);
          progressed = true;
        }
      }
      if (!progressed) break;
      const done = new Set(settledCriterionIds);
      pool = this.resolvableIds().filter((criterionId) => !done.has(criterionId));
    }
    return this.finish(settledCriterionIds, false);
  }

  private resolvableIds(): string[] {
    const stage = this.store.persistedStage();
    return this.store
      .list()
      .filter((decision) => {
        if (decision.status !== "open" || decision.basis !== undefined) return false;
        const entry = this.catalog.get(decision.criterionId);
        const plan = planCriterion(entry, decision, stage, this.floor);
        return plan.blockReason === null && plan.recommendation.kind === "option";
      })
      .map((decision) => decision.criterionId)
      .sort((left, right) => left.localeCompare(right));
  }

  private candidate(criterionId: string, index: number): GreedyQuestionCandidate {
    const decision = this.store.require(criterionId);
    return {
      id: criterionId,
      criterionIds: [criterionId],
      mustAsk: decision.mustAsk,
      conflict: decision.status === "conflict" || decision.conflict === true,
      downstreamUnblocks: decision.downstreamTaskCount,
      catalogPriority: index,
    };
  }

  private finish(settledCriterionIds: readonly string[], cancelled: boolean): AutopilotResult {
    const blockers = this.blockers();
    if (cancelled) {
      return {
        settledCriterionIds,
        halted: true,
        haltReason: "cancelled",
        haltCriterionId: null,
        badge: null,
        remainingBlockers: blockers.map((blocker) => blocker.criterionId),
        reachedReadinessGate: false,
        cancelled: true,
      };
    }
    const first = blockers[0];
    if (!first) {
      return {
        settledCriterionIds,
        halted: false,
        haltReason: null,
        haltCriterionId: null,
        badge: null,
        remainingBlockers: [],
        reachedReadinessGate: true,
        cancelled: false,
      };
    }
    return {
      settledCriterionIds,
      halted: true,
      haltReason: first.reason,
      haltCriterionId: first.criterionId,
      badge: first.badge,
      remainingBlockers: blockers.map((blocker) => blocker.criterionId),
      reachedReadinessGate: false,
      cancelled: false,
    };
  }

  private blockers(): Blocker[] {
    const stage = this.store.persistedStage();
    const blockers: Blocker[] = [];
    for (const decision of this.store.list()) {
      if (decision.basis !== undefined || decision.status === "settled") continue;
      const entry = this.catalog.get(decision.criterionId);
      const plan = planCriterion(entry, decision, stage, this.floor);
      if (plan.blockReason === null && decision.status === "open") continue;
      blockers.push({
        criterionId: decision.criterionId,
        reason: plan.blockReason ?? "missing_recommendation",
        badge: plan.badge,
      });
    }
    return blockers.sort((left, right) => left.criterionId.localeCompare(right.criterionId));
  }
}
