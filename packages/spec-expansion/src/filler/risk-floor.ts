import type { RiskTier } from "./types.js";

/**
 * Deterministic risk floor. An LLM `low` label cannot pass a cell whose matrix
 * or touches sit on auth, payments, PII, deletion, or an external side effect.
 */
const TAG_FLOORS: Readonly<Record<string, "auth" | "payments" | "pii" | "deletion" | "external_side_effect">> =
  {
    auth: "auth",
    authn: "auth",
    authz: "auth",
    session: "auth",
    payments: "payments",
    money: "payments",
    billing: "payments",
    pii: "pii",
    personal_data: "pii",
    deletion: "deletion",
    destructive_write: "deletion",
    external_side_effect: "external_side_effect",
    external_api: "external_side_effect",
    outbound_message: "external_side_effect",
    inbound_webhook: "external_side_effect",
  };

const SUBJECT_FLOOR =
  /(?:^|\.)(?:refund|delete|deletion|pii|payment|payments|billing|credential|credentials)(?:\.|$)/i;

export interface RiskFloorInput {
  readonly modelRisk: RiskTier;
  readonly touches: readonly string[];
  readonly matrixId: string;
  readonly subject: string;
}

export interface RiskFloorResult {
  readonly risk: RiskTier;
  readonly forcedHigh: boolean;
  readonly matchedTags: readonly string[];
}

export function applyRiskFloor(input: RiskFloorInput): RiskFloorResult {
  const matched = new Set<string>();
  for (const touch of input.touches) {
    const floor = TAG_FLOORS[touch];
    if (floor) matched.add(floor);
  }
  if (input.matrixId === "M10") matched.add("pii");
  if (SUBJECT_FLOOR.test(input.subject)) {
    if (/(refund|payment|payments|billing)/i.test(input.subject)) matched.add("payments");
    if (/(delete|deletion)/i.test(input.subject)) matched.add("deletion");
    if (/(pii|credential)/i.test(input.subject)) matched.add("pii");
  }
  const matchedTags = [...matched].sort();
  if (matchedTags.length === 0) {
    return { risk: input.modelRisk, forcedHigh: false, matchedTags };
  }
  return { risk: "high", forcedHigh: input.modelRisk !== "high", matchedTags };
}
