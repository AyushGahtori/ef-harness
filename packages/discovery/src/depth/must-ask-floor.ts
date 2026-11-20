import type { DepthCatalogEntry, MustAskAssessment, MustAskClass } from "./types.js";

const CLASS_BADGES: Readonly<Record<MustAskClass, string>> = {
  authentication_roles: "Needs your decision (must-ask: authentication and roles)",
  payments_side_effects: "Needs your decision (must-ask: handles payments)",
  retention_privacy_pii: "Needs your decision (must-ask: privacy and personal data)",
  core_workflow: "Needs your decision (must-ask: core product workflow)",
  deployment_target: "Needs your decision (must-ask: deployment target)",
  user_contradiction: "Needs your decision (must-ask: contradicts an earlier answer)",
};

const DATA_MODEL_BADGE = "Needs your decision (must-ask: data model)";

export interface PromptSignals {
  readonly payments: boolean;
  readonly sensitiveData: boolean;
  readonly vagueProduct: boolean;
}

/** Stripe, HIPAA, and a vague product prompt escalate criteria onto the fixed floor. */
export function readPromptSignals(prompt: string): PromptSignals {
  return {
    payments: /\bstripe\b/i.test(prompt),
    sensitiveData: /\bhipaa\b/i.test(prompt),
    vagueProduct: isVagueProductPrompt(prompt),
  };
}

export function isVagueProductPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return false;
  const vague = /^(build|make|create)\s+(me\s+)?(a|an)\s+(saas|software|app|application|product)\b/i.test(trimmed);
  const concrete = /\b(for|that|which|with|users?|customers?|workflow|login|invoice|booking|who|when)\b/i.test(
    trimmed,
  );
  return vague && !concrete;
}

/**
 * Immutable must-ask floor. No stage preset, threshold, or Autopilot flag can clear a class
 * once it applies. Signals only ever turn on; they are not a way to opt out.
 */
export class MustAskPolicyFloor {
  private payments: boolean;
  private sensitiveData: boolean;
  private vagueProduct: boolean;
  private readonly contradictions = new Set<string>();

  constructor(prompt = "") {
    const signals = readPromptSignals(prompt);
    this.payments = signals.payments;
    this.sensitiveData = signals.sensitiveData;
    this.vagueProduct = signals.vagueProduct;
  }

  noteUserText(text: string): PromptSignals {
    const signals = readPromptSignals(text);
    this.payments = this.payments || signals.payments;
    this.sensitiveData = this.sensitiveData || signals.sensitiveData;
    this.vagueProduct = this.vagueProduct || signals.vagueProduct;
    return this.signals();
  }

  markContradiction(criterionId: string): void {
    this.contradictions.add(criterionId);
  }

  signals(): PromptSignals {
    return {
      payments: this.payments,
      sensitiveData: this.sensitiveData,
      vagueProduct: this.vagueProduct,
    };
  }

  assess(entry: DepthCatalogEntry): MustAskAssessment {
    if (entry.conflict || entry.mustAskClass === "user_contradiction" || this.contradictions.has(entry.criterionId)) {
      const mustAskClass = entry.mustAskClass === "user_contradiction" ? entry.mustAskClass : null;
      return {
        mustAsk: true,
        mustAskClass,
        badge:
          mustAskClass === "user_contradiction"
            ? CLASS_BADGES.user_contradiction
            : "Needs your decision (conflict)",
        reason: "conflict",
      };
    }

    const escalated = this.escalatedClass(entry);
    if (escalated) {
      return {
        mustAsk: true,
        mustAskClass: escalated,
        badge: CLASS_BADGES[escalated],
        reason: "must_ask",
      };
    }

    if (entry.mustAskClass === "deployment_target" && entry.deploymentObvious) {
      return { mustAsk: false, mustAskClass: null, badge: null, reason: null };
    }

    if (entry.mustAskClass) {
      return {
        mustAsk: true,
        mustAskClass: entry.mustAskClass,
        badge: CLASS_BADGES[entry.mustAskClass],
        reason: "must_ask",
      };
    }

    if (this.vagueProduct && entry.domain === "data_model") {
      return {
        mustAsk: true,
        mustAskClass: null,
        badge: DATA_MODEL_BADGE,
        reason: "must_ask",
      };
    }

    if (entry.highRiskSpecExpander) {
      return {
        mustAsk: false,
        mustAskClass: null,
        badge: "Needs your decision (high-risk spec proposal)",
        reason: "high_risk_spec_expander",
      };
    }

    if (entry.ambiguousBrownfield) {
      return {
        mustAsk: false,
        mustAskClass: null,
        badge: "Needs your decision (ambiguous brownfield finding)",
        reason: "ambiguous_brownfield",
      };
    }

    return { mustAsk: false, mustAskClass: null, badge: null, reason: null };
  }

  private escalatedClass(entry: DepthCatalogEntry): MustAskClass | null {
    if (this.payments && (entry.domain === "payments" || entry.mustAskClass === "payments_side_effects")) {
      return "payments_side_effects";
    }
    if (
      this.sensitiveData &&
      (entry.domain === "sensitive_data" || entry.mustAskClass === "retention_privacy_pii")
    ) {
      return "retention_privacy_pii";
    }
    if (this.vagueProduct && (entry.domain === "authentication" || entry.mustAskClass === "authentication_roles")) {
      return "authentication_roles";
    }
    if (this.vagueProduct && (entry.domain === "workflow" || entry.mustAskClass === "core_workflow")) {
      return "core_workflow";
    }
    return null;
  }
}
