export const SMOKE_PHRASES: Readonly<Record<string, readonly string[]>> = {
  "infer-or-ask": ["explicit", "derived", "delegated", "missing"],
  "systematic-debugging": ["root cause", "reproduce", "hypothesis"],
  "test-driven-verification": ["failing test", "red", "edge case"],
  "frontend-accessibility-ui": ["semantic", "keyboard", "contrast", "design token"],
  "sql-migrations-safety": ["expand", "contract", "idempotent", "index"],
  "api-security-hardening": ["authorization", "validation", "structured error", "idempotency"],
};

export interface DiscoveryFixture {
  readonly costly: boolean;
  readonly explicitQuote: boolean;
  readonly delegated: boolean;
}

export type DiscoveryBasis = "explicit" | "delegated" | "missing";

/** Deterministic reading of the infer-or-ask costly-choice rule. */
export function classifyCostlyChoice(input: DiscoveryFixture): DiscoveryBasis {
  if (input.delegated) return "delegated";
  if (input.costly) return "missing";
  if (input.explicitQuote) return "explicit";
  return "missing";
}

export interface SmokeResult {
  readonly passed: boolean;
  readonly detail: string;
}

export function evaluateBehavioralSmoke(skillId: string, text: string): SmokeResult {
  const phrases = SMOKE_PHRASES[skillId];
  if (phrases === undefined) {
    if (/^##\s+Smoke check\b/m.test(text)) {
      return { passed: true, detail: "declared smoke check present" };
    }
    return { passed: false, detail: "missing behavioral smoke check" };
  }
  const haystack = text.toLowerCase();
  const missing = phrases.filter((phrase) => !haystack.includes(phrase.toLowerCase()));
  if (missing.length > 0) {
    return { passed: false, detail: `missing smoke phrases: ${missing.join(", ")}` };
  }
  if (skillId === "infer-or-ask") {
    const costly = classifyCostlyChoice({ costly: true, explicitQuote: false, delegated: false });
    const explicit = classifyCostlyChoice({ costly: false, explicitQuote: true, delegated: false });
    const delegated = classifyCostlyChoice({ costly: true, explicitQuote: false, delegated: true });
    if (costly !== "missing" || explicit !== "explicit" || delegated !== "delegated") {
      return { passed: false, detail: "infer-or-ask decision fixture failed" };
    }
  }
  return { passed: true, detail: `behavioral smoke passed (${phrases.join(", ")})` };
}
