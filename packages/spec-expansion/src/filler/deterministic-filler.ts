import { hashParts } from "./canonical.js";
import { CROSS_CUTTING_RULES, OPTION_ELABORATIONS, UNIVERSAL_POLICIES } from "./corpus.js";
import { basisRank, cellMatches, globMatch } from "./match.js";
import type {
  ChosenOption,
  CrossCuttingRule,
  DecisionEntailment,
  FillBasis,
  OpenCell,
  OptionElaboration,
  SettledDecision,
  UniversalPolicyClause,
} from "./types.js";

export interface DeterministicClaim {
  readonly cellId: string;
  readonly pass: 1 | 2;
  readonly basis: FillBasis;
  readonly value: string;
  readonly earsText: string;
  readonly oracleSketch: string;
  readonly sourceIds: readonly string[];
  readonly sourceHash: string;
  readonly provenanceKind: "decision" | "ccr" | "elaboration" | "policy";
  readonly provenanceTitle: string;
  readonly provenanceText: string;
  readonly provenanceFields: Record<string, unknown>;
}

export interface DeterministicFillInput {
  readonly cells: readonly OpenCell[];
  readonly decisions: readonly SettledDecision[];
  readonly rules?: readonly CrossCuttingRule[];
  readonly elaborations?: readonly OptionElaboration[];
  readonly policies?: readonly UniversalPolicyClause[];
  readonly chosenOptions?: readonly ChosenOption[];
}

export class DeterministicPass1And2Filler {
  fill(input: DeterministicFillInput): ReadonlyMap<string, DeterministicClaim> {
    const rules = input.rules ?? CROSS_CUTTING_RULES;
    const elaborations = input.elaborations ?? OPTION_ELABORATIONS;
    const policies = input.policies ?? UNIVERSAL_POLICIES;
    const chosen = new Set(
      (input.chosenOptions ?? []).map((option) => `${option.questionId}\u0000${option.optionId}`),
    );
    const claims = new Map<string, DeterministicClaim>();
    for (const cell of input.cells) {
      if ((cell.applicability ?? "active") === "not_applicable") continue;
      const claim = claimPass1(cell, input.decisions, rules) ?? claimPass2(cell, elaborations, policies, chosen);
      if (claim) claims.set(cell.id, claim);
    }
    return claims;
  }
}

function claimPass1(
  cell: OpenCell,
  decisions: readonly SettledDecision[],
  rules: readonly CrossCuttingRule[],
): DeterministicClaim | null {
  const decision = matchDecision(cell, decisions);
  if (decision) {
    return {
      cellId: cell.id,
      pass: 1,
      basis: decision.decision.basis,
      value: decision.entailment.value,
      earsText: decision.entailment.earsText,
      oracleSketch: decision.entailment.oracleSketch,
      sourceIds: [decision.decision.id],
      sourceHash: decision.decision.contentHash,
      provenanceKind: "decision",
      provenanceTitle: decision.decision.title,
      provenanceText: decision.decision.text,
      provenanceFields: {
        feature: cell.featureId,
        basis: decision.decision.basis,
        content_hash: decision.decision.contentHash,
      },
    };
  }
  const matched = rules.find((rule) =>
    cellMatches(cell.subject, cell.touches, rule.cellPatterns, { any: rule.any, all: rule.all }),
  );
  if (!matched) return null;
  return {
    cellId: cell.id,
    pass: 1,
    basis: "derived",
    value: matched.text,
    earsText: matched.earsText,
    oracleSketch: matched.oracleSketch,
    sourceIds: [matched.id],
    sourceHash: hashParts([matched.id, matched.earsText, matched.oracleSketch]),
    provenanceKind: "ccr",
    provenanceTitle: matched.id,
    provenanceText: matched.text,
    provenanceFields: {
      feature: cell.featureId,
      rule_id: matched.id,
    },
  };
}

function claimPass2(
  cell: OpenCell,
  elaborations: readonly OptionElaboration[],
  policies: readonly UniversalPolicyClause[],
  chosen: ReadonlySet<string>,
): DeterministicClaim | null {
  const covered = elaborations.some((item) => globMatch(item.cellPattern, cell.subject));
  const chosenHit = elaborations
    .filter(
      (item) =>
        chosen.has(`${item.questionId}\u0000${item.optionId}`) && globMatch(item.cellPattern, cell.subject),
    )
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  if (chosenHit) {
    return {
      cellId: cell.id,
      pass: 2,
      basis: "defaulted",
      value: chosenHit.value,
      earsText: chosenHit.earsText,
      oracleSketch: chosenHit.oracleSketch,
      sourceIds: [chosenHit.id],
      sourceHash: hashParts([chosenHit.id, chosenHit.earsText, chosenHit.oracleSketch]),
      provenanceKind: "elaboration",
      provenanceTitle: chosenHit.id,
      provenanceText: chosenHit.value,
      provenanceFields: {
        feature: cell.featureId,
        question_id: chosenHit.questionId,
        option_id: chosenHit.optionId,
      },
    };
  }
  if (covered) return null;
  const policyHits = policies.filter((item) =>
    cellMatches(cell.subject, cell.touches, item.cellPatterns, { any: item.any, all: item.all }),
  );
  policyHits.sort((left, right) => {
    const specificity = longestPattern(right.cellPatterns, cell.subject) - longestPattern(left.cellPatterns, cell.subject);
    if (specificity !== 0) return specificity;
    return `${left.id}:${left.source}`.localeCompare(`${right.id}:${right.source}`);
  });
  const policy = policyHits[0];
  if (!policy) return null;
  const sourceId = `${policy.id}@${policy.source}`;
  return {
    cellId: cell.id,
    pass: 2,
    basis: "defaulted",
    value: policy.statement,
    earsText: policy.earsText,
    oracleSketch: policy.oracleSketch,
    sourceIds: [sourceId],
    sourceHash: hashParts([sourceId, policy.earsText, policy.oracleSketch]),
    provenanceKind: "policy",
    provenanceTitle: sourceId,
    provenanceText: policy.statement,
    provenanceFields: {
      feature: cell.featureId,
      policy_id: policy.id,
      policy_source: policy.source,
    },
  };
}

function matchDecision(
  cell: OpenCell,
  decisions: readonly SettledDecision[],
): { decision: SettledDecision; entailment: DecisionEntailment } | null {
  const ranked = [...decisions].sort(
    (left, right) => basisRank(left.basis) - basisRank(right.basis) || left.id.localeCompare(right.id),
  );
  for (const decision of ranked) {
    for (const entailment of decision.entails) {
      if (entailment.cellId === cell.id) return { decision, entailment };
    }
  }
  for (const decision of ranked) {
    for (const entailment of decision.entails) {
      if (entailment.cellPattern && globMatch(entailment.cellPattern, cell.subject)) {
        return { decision, entailment };
      }
    }
  }
  return null;
}

function longestPattern(patterns: readonly string[], subject: string): number {
  let best = 0;
  for (const pattern of patterns) {
    if (globMatch(pattern, subject)) best = Math.max(best, pattern.length);
  }
  return best;
}
