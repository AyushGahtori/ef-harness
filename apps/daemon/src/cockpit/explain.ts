import { CockpitExplainerV1Schema, getPromptContract } from "@ef-harness/shared-contracts";

export interface CockpitExplainResult {
  readonly contractId: "cockpit-explainer@1";
  readonly ok: boolean;
  readonly reason: "ok" | "essay" | "malformed" | "blocked";
  readonly text: string | null;
}

/**
 * Validate one clicked explainer reply against the landed `cockpit-explainer@1`
 * output schema. This does not call a model. Board load must not reach here.
 */
export function explainCockpit(modelOutput: unknown): CockpitExplainResult {
  const contract = getPromptContract("cockpit-explainer@1");
  if (contract.output !== CockpitExplainerV1Schema) {
    throw new Error("cockpit-explainer@1 schema diverges from CockpitExplainerV1Schema");
  }
  if (modelOutput === undefined) {
    return { contractId: "cockpit-explainer@1", ok: false, reason: "blocked", text: null };
  }
  const parsed = CockpitExplainerV1Schema.safeParse(modelOutput);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(" ");
    const essay = /sentence|500|character|too big|too_big/i.test(message);
    return {
      contractId: "cockpit-explainer@1",
      ok: false,
      reason: essay ? "essay" : "malformed",
      text: null,
    };
  }
  if ("blocked" in parsed.data) {
    return { contractId: "cockpit-explainer@1", ok: false, reason: "blocked", text: null };
  }
  return { contractId: "cockpit-explainer@1", ok: true, reason: "ok", text: parsed.data.text };
}
