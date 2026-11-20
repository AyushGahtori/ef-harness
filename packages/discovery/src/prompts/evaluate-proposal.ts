import { ExactQuoteEvidenceVerifier } from "./exact-quote-evidence-verifier.js";
import {
  delegationIsBounded,
  forbidsDerivedBasis,
  inferTwoReadings,
  twoReadingsApplyToCriterion,
  valueWithinLimits,
} from "./text-rules.js";
import type {
  AllowlistedRule,
  BatchCriterion,
  BatchProposal,
  CriterionDisposition,
  DiscoveryTurn,
  OptionsVersionBinding,
  PendingDecision,
  PriorFact,
  ReadingOption,
  RecommendedOption,
  RepoBaseline,
  SettledDecision,
  UnsettledDecision,
} from "./types.js";

export interface EvaluateInput {
  readonly proposal: BatchProposal;
  readonly criterion: BatchCriterion | null;
  readonly turns: readonly DiscoveryTurn[];
  readonly activeCriteria: readonly string[];
  readonly activeQuestions: readonly string[];
  readonly rules: readonly AllowlistedRule[];
  readonly priorFacts: readonly PriorFact[];
  readonly transcript: string;
  readonly baseline: RepoBaseline | null;
  readonly binding: OptionsVersionBinding | null;
  readonly recommended: readonly RecommendedOption[];
}

function pending(proposal: BatchProposal, code: string, message: string): CriterionDisposition {
  return {
    kind: "pending",
    decision: {
      criterionId: proposal.criterion,
      questionId: proposal.question,
      code,
      message,
    },
  };
}

export function readingsFor(criterion: BatchCriterion, transcript: string, proposal: BatchProposal): readonly ReadingOption[] {
  if (criterion.twoReadings && criterion.twoReadings.length >= 2) return criterion.twoReadings;
  const blob = [transcript, ...proposal.evidence.map((span) => span.quote)].join("\n");
  const inferred = inferTwoReadings(blob);
  if (!inferred || !twoReadingsApplyToCriterion(criterion.id)) return [];
  return inferred;
}

function unsettledOf(proposal: BatchProposal): UnsettledDecision {
  return {
    criterionId: proposal.criterion,
    questionId: proposal.question,
    status: proposal.status === "settled" ? "missing" : proposal.status,
    missingDetail: proposal.missing_detail,
    evidence: proposal.evidence,
    conflict: proposal.conflict,
    delegation: proposal.delegation,
  };
}

/**
 * Judge one criterion without looking at sibling proposals.
 * An invalid sibling never changes this result.
 */
export function evaluateProposal(input: EvaluateInput): CriterionDisposition {
  const { proposal, criterion } = input;
  if (!criterion || !input.activeCriteria.includes(proposal.criterion)) {
    return pending(proposal, "unknown_criterion", `Criterion ${proposal.criterion} is not on the active list.`);
  }
  if (proposal.question !== criterion.questionId || !input.activeQuestions.includes(proposal.question)) {
    return pending(proposal, "unknown_question", `Question ${proposal.question} is not active for ${criterion.id}.`);
  }

  const readings = readingsFor(criterion, input.transcript, proposal);
  if (readings.length >= 2 && proposal.status !== "conflict") {
    return pending(
      proposal,
      "two_readings_must_conflict",
      "Two plausible readings must stay status conflict and trigger clarify. Neither reading is chosen silently.",
    );
  }

  if (proposal.status === "missing" || proposal.status === "partial") {
    return { kind: "unsettled", decision: unsettledOf(proposal) };
  }

  if (proposal.status === "conflict") {
    const sides = proposal.conflict ?? [];
    if (sides.length < 2) {
      return pending(proposal, "conflict_missing_reading", "A conflict must keep both supporting spans.");
    }
    const verifier = new ExactQuoteEvidenceVerifier(input.turns);
    for (const side of sides) {
      const checked = verifier.validateClaim(side.evidence, {
        criterionId: proposal.criterion,
        questionId: proposal.question,
        activeCriteria: input.activeCriteria,
        activeQuestions: input.activeQuestions,
      });
      if (!checked.accepted) {
        return pending(proposal, checked.code, checked.message);
      }
    }
    return { kind: "unsettled", decision: unsettledOf(proposal) };
  }

  if (proposal.basis === "derived" && forbidsDerivedBasis(criterion)) {
    return pending(
      proposal,
      "costly_derivation",
      "Paid services, identity, retention, deletion, legal, compliance, and must-ask criteria cannot be settled with basis derived.",
    );
  }

  if (proposal.basis === "derived") {
    const rule = input.rules.find((candidate) => candidate.id === proposal.rule);
    if (!rule) {
      return pending(proposal, "rule_not_allowlisted", `Rule ${proposal.rule ?? ""} is not allowlisted.`);
    }
    if (rule.criterionId !== proposal.criterion) {
      return pending(proposal, "rule_criterion_mismatch", "The allowlisted rule applies to a different criterion.");
    }
    if ((rule.forbidsCriterionIds ?? []).includes(proposal.criterion)) {
      return pending(proposal, "broadened_inference", "This rule cannot broaden the cited claim to this criterion.");
    }
    if (proposal.value !== rule.allowedValue) {
      return pending(proposal, "rule_value_mismatch", "Derived value does not match the allowlisted rule.");
    }
    const missingPremise = rule.premises.find((premise) => !proposal.premises.includes(premise));
    if (missingPremise) {
      return pending(proposal, "unresolved_premises", `Missing premise ${missingPremise}.`);
    }
    for (const premiseId of proposal.premises) {
      if (premiseId === proposal.criterion) {
        return pending(proposal, "self_support", "A derived claim cannot cite itself.");
      }
      const fact = input.priorFacts.find((candidate) => candidate.id === premiseId);
      if (!fact || fact.status !== "settled") {
        return pending(proposal, "unresolved_premises", `Premise ${premiseId} is not a settled fact.`);
      }
      if (fact.criterionId === proposal.criterion) {
        return pending(proposal, "self_support", "A derived claim cannot be grounded in itself.");
      }
    }
  }

  if (proposal.basis === "delegated") {
    const delegation = proposal.delegation;
    if (!delegation) {
      return pending(proposal, "delegation_unbounded", "Delegated settlements record scope and limits.");
    }
    const turn = input.turns.find((candidate) => candidate.id === delegation.turn);
    if (!turn) return pending(proposal, "turn_not_found", `Delegation turn ${delegation.turn} does not exist.`);
    if (turn.author !== "developer") {
      return pending(proposal, "assistant_author", "A delegation must be spoken by the developer.");
    }
    if (!delegationIsBounded(delegation.scope, delegation.limits) || !proposal.value || !valueWithinLimits(proposal.value, delegation.scope, delegation.limits)) {
      return pending(
        proposal,
        "delegation_unbounded",
        "Delegated value must sit inside an explicit, bounded limit.",
      );
    }
    if (forbidsDerivedBasis(criterion) && !delegationIsBounded(delegation.scope, delegation.limits)) {
      return pending(proposal, "delegation_unbounded", "Costly choices need an explicit value or a bounded delegation.");
    }
  }

  const verifier = new ExactQuoteEvidenceVerifier(input.turns);
  const checked = verifier.validateClaim(proposal.evidence, {
    criterionId: proposal.criterion,
    questionId: proposal.question,
    basis: proposal.basis,
    value: proposal.value,
    activeCriteria: input.activeCriteria,
    activeQuestions: input.activeQuestions,
    binding: input.binding,
    recommended: input.recommended,
    repoBaselineValue: input.baseline?.observedValue ?? null,
  });
  if (!checked.accepted) return pending(proposal, checked.code, checked.message);
  if (!proposal.value || !proposal.basis) {
    return pending(proposal, "evidence_required", "Settled decisions need a basis and a value.");
  }

  const decision: SettledDecision = {
    criterionId: proposal.criterion,
    questionId: proposal.question,
    basis: proposal.basis,
    value: proposal.value,
    evidence: proposal.evidence,
    rule: proposal.rule,
    premises: proposal.premises,
    delegation: proposal.delegation,
    plannedChange: input.baseline !== null && proposal.value !== input.baseline.observedValue,
  };
  return { kind: "settled", decision };
}

export function mutualSupportIds(
  settled: readonly SettledDecision[],
  priorFacts: readonly PriorFact[],
): readonly string[] {
  const derived = settled.filter((decision) => decision.basis === "derived");
  const depends = new Map<string, string[]>();
  for (const decision of derived) {
    const targets: string[] = [];
    for (const premiseId of decision.premises) {
      if (premiseId === decision.criterionId) targets.push(decision.criterionId);
      const fact = priorFacts.find((candidate) => candidate.id === premiseId);
      if (fact?.criterionId) targets.push(fact.criterionId);
    }
    depends.set(decision.criterionId, targets);
  }
  const circular = new Set<string>();
  for (const [criterionId, targets] of depends) {
    if (targets.includes(criterionId)) circular.add(criterionId);
    for (const target of targets) {
      const back = depends.get(target) ?? [];
      if (back.includes(criterionId)) {
        circular.add(criterionId);
        circular.add(target);
      }
    }
  }
  return [...circular];
}

export function asPending(decision: SettledDecision, code: string, message: string): PendingDecision {
  return { criterionId: decision.criterionId, questionId: decision.questionId, code, message };
}
