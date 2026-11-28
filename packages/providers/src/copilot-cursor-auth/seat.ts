import type { CopilotSeatHttpBody, SeatDecision } from "./types.js";

export function interpretCopilotSeatHttp(status: number, body: CopilotSeatHttpBody): SeatDecision {
  const login = body.login && /^[A-Za-z0-9-]{1,64}$/.test(body.login) ? body.login : "unknown";
  if (body.code === "no_copilot_entitlement" || body.entitlement === false) {
    return {
      ok: false,
      code: "no_copilot_entitlement",
      login,
      message: `This GitHub account (@${login}) has no active Copilot subscription (no_copilot_entitlement). Sign in with an account that has a Copilot seat before starting a build.`,
    };
  }
  if (status === 403) {
    const message =
      body.orgPolicyMessage ??
      body.message ??
      "The GitHub organization blocked this Copilot sign-in.";
    return { ok: false, code: "org_policy", message };
  }
  if (status !== 200) {
    return {
      ok: false,
      code: "org_policy",
      message: body.message ?? "Copilot seat verification failed.",
    };
  }
  const billingMode = body.billingMode === "byok_api_key" ? "byok_api_key" : "copilot_subscription";
  return {
    ok: true,
    login,
    plan: body.plan ?? "copilot",
    allowedModels: body.allowedModels ? [...body.allowedModels] : [],
    billingMode,
    orgPolicyMessage: body.orgPolicyMessage ?? null,
  };
}
