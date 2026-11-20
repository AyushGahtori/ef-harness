import { computeAskScore, isBelowAskThreshold } from "./ask-value.js";
import type { CatalogIndex } from "./catalog.js";
import { canonicalJson } from "./canonical-json.js";
import { automaticFields, decisionToJson } from "./decision-fields.js";
import type { DecisionStore } from "./decision-store.js";
import type { MustAskPolicyFloor } from "./must-ask-floor.js";
import { resolveStageRecommendation } from "./recommendations.js";
import type {
  AskScore,
  DepthCatalogEntry,
  DepthClock,
  DepthDecision,
  HaltReason,
  MustAskClass,
  ProjectStage,
  RecommendationResolution,
  ReconcileResult,
} from "./types.js";
import { VISIBLE_QUESTION_CAP } from "./weights.js";

export interface SettlementPlan {
  readonly entry: DepthCatalogEntry;
  readonly current: DepthDecision;
  readonly score: AskScore;
  readonly recommendation: RecommendationResolution;
  readonly mustAsk: boolean;
  readonly mustAskClass: MustAskClass | null;
  readonly badge: string | null;
  readonly blockReason: HaltReason | null;
  readonly action: "preserve_explicit" | "preserve_delegated" | "default" | "ask" | "block";
}

const MISSING_RECOMMENDATION_BADGE = "Needs your decision (no safe recommendation for this stage)";

export function planCriterion(
  entry: DepthCatalogEntry,
  current: DepthDecision,
  stage: ProjectStage,
  floor: MustAskPolicyFloor,
): SettlementPlan {
  const score = computeAskScore(entry, stage);
  const assessment = floor.assess(entry);
  const recommendation = resolveStageRecommendation(entry, stage);
  let blockReason = assessment.reason;
  let badge = assessment.badge;
  let mustAsk = assessment.mustAsk;
  if (recommendation.kind === "force_must_ask" && blockReason === null) {
    blockReason = "missing_recommendation";
    badge = MISSING_RECOMMENDATION_BADGE;
    mustAsk = true;
  }
  const plan: SettlementPlan = {
    entry,
    current,
    score,
    recommendation,
    mustAsk,
    mustAskClass: assessment.mustAskClass,
    badge,
    blockReason,
    action: "ask",
  };
  if (current.basis === "explicit") return { ...plan, action: "preserve_explicit" };
  if (
    blockReason !== null ||
    current.status === "conflict" ||
    current.status === "partial" ||
    current.status === "missing"
  ) {
    return { ...plan, action: "block" };
  }
  if (current.basis === "delegated") return { ...plan, action: "preserve_delegated" };
  if (!entry.stageApplicability[stage] || isBelowAskThreshold(score, false)) {
    return { ...plan, action: "default" };
  }
  return plan;
}

export function applyQuestionCap(plans: readonly SettlementPlan[], stage: ProjectStage): SettlementPlan[] {
  const asking = plans.filter((plan) => plan.action === "ask");
  const cap = VISIBLE_QUESTION_CAP[stage];
  if (asking.length <= cap) return [...plans];
  const overflow = new Set(
    [...asking]
      .sort(
        (left, right) =>
          left.score.askValue - right.score.askValue ||
          left.entry.criterionId.localeCompare(right.entry.criterionId),
      )
      .slice(0, asking.length - cap)
      .map((plan) => plan.entry.criterionId),
  );
  return plans.map((plan) => (overflow.has(plan.entry.criterionId) ? { ...plan, action: "default" } : plan));
}

/**
 * Scores every non-must-ask criterion and records stage defaults for those below
 * the active ask threshold. Must-ask, conflict, high-risk proposals, and ambiguous
 * brownfield findings stay open. Settled explicit answers are not rewritten.
 */
export class AskValueInterrogationGuard {
  constructor(
    private readonly store: DecisionStore,
    private readonly floor: MustAskPolicyFloor,
    private readonly catalog: CatalogIndex,
    private readonly clock: DepthClock,
  ) {}

  reconcile(stage: ProjectStage): ReconcileResult {
    const plans = applyQuestionCap(
      this.catalog.entries().map((entry) => planCriterion(entry, this.store.require(entry.criterionId), stage, this.floor)),
      stage,
    );
    const defaulted: string[] = [];
    const reopened: string[] = [];
    const heldOpen: string[] = [];
    const preservedExplicit: string[] = [];
    for (const plan of plans) {
      const current = plan.current;
      if (plan.action === "preserve_explicit") {
        preservedExplicit.push(current.criterionId);
        continue;
      }
      if (plan.action === "preserve_delegated") continue;
      if (plan.action === "default" && plan.recommendation.kind === "option") {
        const next = automaticFields({
          current,
          basis: "defaulted",
          optionId: plan.recommendation.optionId,
          rationale: plan.recommendation.rationale,
          stage,
          at: this.clock.now(),
          askValue: plan.score.askValue,
          impact: plan.score.impact,
          uncertainty: plan.score.uncertainty,
        });
        if (!sameDecision(current, next)) {
          this.store.save(next);
          defaulted.push(current.criterionId);
        }
        continue;
      }
      const next = heldDecision(current, plan);
      const changed = !sameDecision(current, next);
      if (changed) this.store.save(next);
      const wasAutomatic = current.basis === "defaulted" || current.basis === "delegated";
      if (wasAutomatic && changed) reopened.push(current.criterionId);
      else heldOpen.push(current.criterionId);
    }
    return { stage, defaulted, reopened, heldOpen, preservedExplicit };
  }
}

function heldDecision(current: DepthDecision, plan: SettlementPlan): DepthDecision {
  const next: DepthDecision = {
    nodeId: current.nodeId,
    version: current.version,
    criterionId: current.criterionId,
    label: current.label,
    status: heldStatus(current, plan.entry),
    value: null,
    workItemId: current.workItemId,
    impactLevel: current.impactLevel,
    downstreamTaskCount: current.downstreamTaskCount,
    mustAsk: plan.mustAsk,
    askValue: plan.score.askValue,
    impact: plan.score.impact,
    uncertainty: plan.score.uncertainty,
  };
  let stamped = next;
  if (current.domain !== undefined) stamped = { ...stamped, domain: current.domain };
  if (plan.mustAskClass) stamped = { ...stamped, mustAskClass: plan.mustAskClass };
  if (plan.badge) stamped = { ...stamped, decisionBadge: plan.badge };
  if (current.conflict === true) stamped = { ...stamped, conflict: true };
  if (current.highRiskSpecExpander === true) stamped = { ...stamped, highRiskSpecExpander: true };
  if (current.ambiguousBrownfield === true) stamped = { ...stamped, ambiguousBrownfield: true };
  return stamped;
}

function heldStatus(current: DepthDecision, entry: DepthCatalogEntry): DepthDecision["status"] {
  if (entry.conflict || current.status === "conflict") return "conflict";
  if (current.status === "partial" || current.status === "missing") return current.status;
  return "open";
}

function sameDecision(left: DepthDecision, right: DepthDecision): boolean {
  return canonicalJson(decisionToJson(left)) === canonicalJson(decisionToJson(right));
}
