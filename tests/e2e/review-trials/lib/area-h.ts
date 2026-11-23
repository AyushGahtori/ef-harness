import { forbiddenNeedles } from "./area-g.js";

export const AREA_H_EVIDENCE = [
  "anthropic-console-only",
  "gemini-off-no-profile",
  "no-forbidden-registry",
  "chatgpt-wire",
  "aimd-2-plus1-half",
  "personal-reserve",
  "no-silent-paid-fallback",
  "ten-probe-downgrade",
] as const;

export interface ConnectionRecord {
  id: string;
  enabledByDefault: boolean;
  auth: "console-api-key" | "plan-pkce" | "off";
  readsUserProfile: boolean;
  storesSubscriptionOauth: boolean;
}

export function connectionRegistry(): readonly ConnectionRecord[] {
  return [
    { id: "anthropic", enabledByDefault: true, auth: "console-api-key", readsUserProfile: false, storesSubscriptionOauth: false },
    { id: "gemini-cli", enabledByDefault: false, auth: "off", readsUserProfile: false, storesSubscriptionOauth: false },
    { id: "chatgpt", enabledByDefault: true, auth: "plan-pkce", readsUserProfile: false, storesSubscriptionOauth: false },
  ];
}

export function aimd(concurrency: number, event: "success" | "throttle"): number {
  if (event === "success") return concurrency + 1;
  return Math.max(1, Math.floor(concurrency / 2));
}

export function grantFromWindow(input: { window: number; reserve: number; held: number; ask: number }): boolean {
  const workerBudget = input.window - input.reserve;
  return input.held + input.ask <= workerBudget;
}

export function routeCall(input: { planRemaining: number; paidFallback: boolean; spentPaid: number; cap: number }): "plan" | "paused" | "paid-explicit" {
  if (input.planRemaining > 0) return "plan";
  if (!input.paidFallback || input.spentPaid >= input.cap) return "paused";
  return "paid-explicit";
}

export function chatGptWire(body: { scope?: string; pkce?: boolean; max_output_tokens?: number }): void {
  if (body.max_output_tokens !== undefined) throw new Error("sign-in route rejects max_output_tokens");
  if (body.scope !== "chatgpt.tokens.use.direct") throw new Error("plan scope required");
  if (body.pkce !== true) throw new Error("pkce required");
}

export function conformance(results: readonly boolean[]): { probes: 10; downgraded: boolean } {
  if (results.length !== 10) throw new Error("conformance requires 10 probes");
  return { probes: 10, downgraded: results.some((ok) => !ok) };
}

export async function runAreaH(): Promise<string[]> {
  const evidence: string[] = [];
  const registry = connectionRegistry();
  const anthropic = registry.find((item) => item.id === "anthropic");
  const gemini = registry.find((item) => item.id === "gemini-cli");
  if (!anthropic || anthropic.auth !== "console-api-key" || anthropic.storesSubscriptionOauth) {
    throw new Error("Anthropic is not console-only");
  }
  evidence.push("anthropic-console-only");
  if (!gemini || gemini.enabledByDefault || gemini.readsUserProfile) throw new Error("Gemini is not off by default");
  evidence.push("gemini-off-no-profile");
  const banned = forbiddenNeedles();
  if (registry.some((item) => banned.includes(item.id) || item.storesSubscriptionOauth)) {
    throw new Error("forbidden product entered the connection registry");
  }
  evidence.push("no-forbidden-registry");
  chatGptWire({ scope: "chatgpt.tokens.use.direct", pkce: true });
  let rejected = false;
  try {
    chatGptWire({ scope: "chatgpt.tokens.use.direct", pkce: true, max_output_tokens: 100 });
  } catch (error) {
    rejected = error instanceof Error && error.message.includes("max_output_tokens");
  }
  if (!rejected) throw new Error("ChatGPT wire accepted max_output_tokens");
  evidence.push("chatgpt-wire");
  const up = aimd(2, "success");
  const down = aimd(up, "throttle");
  if (up !== 3 || down !== 1 || aimd(4, "throttle") !== 2) throw new Error("AIMD was not 2/+1/÷2");
  evidence.push("aimd-2-plus1-half");
  if (!grantFromWindow({ window: 100, reserve: 20, held: 70, ask: 10 })) throw new Error("reserve blocked a legal grant");
  if (grantFromWindow({ window: 100, reserve: 20, held: 70, ask: 11 })) throw new Error("workers consumed the personal reserve");
  evidence.push("personal-reserve");
  const paused = routeCall({ planRemaining: 0, paidFallback: false, spentPaid: 0, cap: 5 });
  const explicit = routeCall({ planRemaining: 0, paidFallback: true, spentPaid: 1, cap: 5 });
  if (paused !== "paused" || explicit !== "paid-explicit") throw new Error("paid fallback was silent");
  evidence.push("no-silent-paid-fallback");
  const healthy = conformance([true, true, true, true, true, true, true, true, true, true]);
  const failed = conformance([true, true, true, true, true, true, true, true, true, false]);
  if (healthy.downgraded || !failed.downgraded || failed.probes !== 10) throw new Error("conformance did not downgrade");
  evidence.push("ten-probe-downgrade");
  const missing = AREA_H_EVIDENCE.filter((id) => !evidence.includes(id));
  if (missing.length > 0) throw new Error(`area H missing ${missing.join(",")}`);
  return evidence;
}
