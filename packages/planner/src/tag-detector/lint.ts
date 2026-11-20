import { matchesScopePredicate, touchTagSet } from "./closed-tags.js";
import type { CrossCuttingRule } from "./rules.js";
import { EXPECTED_RULE_IDS } from "./rules.js";
import { queryFromMatchCase, seamActivates } from "./seam-match.js";
import type { SeamTemplate } from "./seams.js";
import { EXPECTED_SEAM_IDS } from "./seams.js";
import { countTokens, RULE_TOKEN_CEILING } from "./tokens.js";

export interface LintReport {
  readonly ok: boolean;
  readonly violations: readonly string[];
}

function polarityViolations(rule: CrossCuttingRule): string[] {
  const violations: string[] = [];
  let positives = 0;
  let negatives = 0;
  for (const matchCase of rule.matchCases) {
    if (matchCase.polarity === "positive") positives += 1;
    else negatives += 1;
    const matched = matchesScopePredicate(rule.scope, touchTagSet(matchCase.tags), rule.global);
    const expectMatch = matchCase.polarity === "positive";
    if (matched !== expectMatch) {
      violations.push(
        `${rule.id} ${matchCase.polarity} case [${matchCase.tags.join(", ")}] ${matched ? "matched" : "did not match"}`,
      );
    }
  }
  if (!rule.global && positives < 1) {
    violations.push(`${rule.id} needs at least one positive match case`);
  }
  if (!rule.global && negatives < 1) {
    violations.push(`${rule.id} needs at least one negative match case`);
  }
  return violations;
}

export class StaticRuleLintGate {
  lintRules(
    rules: readonly CrossCuttingRule[],
    options?: { readonly inventory?: boolean },
  ): LintReport {
    const violations: string[] = [];
    const inventory = options?.inventory ?? false;
    if (inventory) {
      const ids = rules.map((rule) => rule.id);
      if (ids.length !== EXPECTED_RULE_IDS.length || ids.some((id, index) => id !== EXPECTED_RULE_IDS[index])) {
        violations.push("catalog must contain exactly X-01 through X-14 in order");
      }
    }
    for (const rule of rules) {
      const tokens = countTokens(rule.requirement);
      if (tokens > RULE_TOKEN_CEILING) {
        violations.push(
          `${rule.id} requirement has ${tokens} tokens; ceiling is ${RULE_TOKEN_CEILING}`,
        );
      }
      if (tokens === 0) {
        violations.push(`${rule.id} requirement is empty`);
      }
      if (!rule.verificationCheck.spec || !rule.verificationCheck.kind || !rule.verificationCheck.id) {
        violations.push(`${rule.id} is missing a concrete verification_check`);
      }
      const anyCount = rule.scope.any?.length ?? 0;
      const allCount = rule.scope.all?.length ?? 0;
      if (!rule.global && anyCount === 0 && allCount === 0) {
        violations.push(
          `${rule.id} scope is empty; a rule that matches every task must set global: true`,
        );
      }
      violations.push(...polarityViolations(rule));
    }
    return { ok: violations.length === 0, violations };
  }

  lintSeams(seams: readonly SeamTemplate[], options?: { readonly inventory?: boolean }): LintReport {
    const violations: string[] = [];
    const inventory = options?.inventory ?? false;
    if (inventory) {
      const ids = seams.map((seam) => seam.id);
      if (ids.length !== EXPECTED_SEAM_IDS.length || ids.some((id, index) => id !== EXPECTED_SEAM_IDS[index])) {
        violations.push("catalog must contain exactly S-01 through S-10 in order");
      }
    }
    for (const seam of seams) {
      const texts = [seam.contractShape, seam.integrationOracle, ...seam.failureModes, ...seam.questions];
      for (const text of texts) {
        const tokens = countTokens(text);
        if (tokens > RULE_TOKEN_CEILING) {
          violations.push(`${seam.id} text has ${tokens} tokens; ceiling is ${RULE_TOKEN_CEILING}`);
        }
        if (tokens === 0) violations.push(`${seam.id} has an empty contract, failure, or oracle`);
      }
      let positives = 0;
      let negatives = 0;
      for (const matchCase of seam.matchCases) {
        if (matchCase.polarity === "positive") positives += 1;
        else negatives += 1;
        const matched = seamActivates(seam, queryFromMatchCase(seam, matchCase));
        const expectMatch = matchCase.polarity === "positive";
        if (matched !== expectMatch) {
          violations.push(
            `${seam.id} ${matchCase.polarity} seam case ${matched ? "matched" : "did not match"}`,
          );
        }
      }
      if (positives < 1) violations.push(`${seam.id} needs at least one positive match case`);
      if (negatives < 1) violations.push(`${seam.id} needs at least one negative match case`);
    }
    return { ok: violations.length === 0, violations };
  }
}
