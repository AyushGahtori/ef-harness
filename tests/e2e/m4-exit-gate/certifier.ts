import http from "node:http";
import { PAID_REQUEST_MICRO_USD } from "./constants.ts";
import { closedPort, type MockPlane } from "./servers.ts";
import type { ExhaustionScenario, GateFaults } from "./types.ts";
import { getJson, postJson } from "./wire.ts";

type Reason = "usage_limit" | "overage" | "expired" | "econnrefused" | "route_revoked";

interface FallbackInput {
  readonly reason: Reason;
  readonly consent: boolean;
}

export class NoSilentPaidFallbackGuard {
  evaluate(input: FallbackInput): { readonly allowed: boolean; readonly park: string } {
    if (input.consent) return { allowed: true, park: "consented" };
    if (input.reason === "usage_limit") return { allowed: false, park: "CheckpointStopCard" };
    if (input.reason === "overage") return { allowed: false, park: "pause-before-overage" };
    if (input.reason === "expired") return { allowed: false, park: "AccountCard" };
    if (input.reason === "econnrefused") return { allowed: false, park: "pause" };
    return { allowed: false, park: "park-immediate" };
  }
}

export class SignedProviderPolicyPort {
  routeCompliance(revoked: boolean): "allowed" | "route_revoked" {
    return revoked ? "route_revoked" : "allowed";
  }
}

export interface FallbackCertification {
  readonly paidSpendMicroUsd: number;
  readonly unconsentedPaidRequests: number;
  readonly openRouterRequestCount: number;
  readonly copilotRequestsAfterQuotaZero: number;
  readonly consentDrillAllowsPaid: boolean;
  readonly exhaustionOk: boolean;
  readonly scenarios: readonly ExhaustionScenario[];
}

export class M4ComplianceAndFallbackCertifier {
  async certify(plane: MockPlane, faults: GateFaults = {}): Promise<FallbackCertification> {
    const guard = new NoSilentPaidFallbackGuard();
    const policy = new SignedProviderPolicyPort();
    const base = {
      anthropic: plane.counts.anthropic,
      openrouter: plane.counts.openrouter,
      copilotComplete: plane.counts.copilotComplete,
    };
    const scenarios: ExhaustionScenario[] = [];
    scenarios.push(await chatgptFull(plane, guard, faults, base));
    scenarios.push(await copilotOverage(plane, guard, faults));
    scenarios.push(await cursorExpired(plane, guard));
    scenarios.push(await ollamaDown(guard));
    scenarios.push(await routeRevoked(guard, policy));
    const anthropicDelta = plane.counts.anthropic - base.anthropic;
    const openrouterDelta = plane.counts.openrouter - base.openrouter;
    const copilotDelta = plane.counts.copilotComplete - base.copilotComplete;
    const unconsentedPaidRequests = anthropicDelta + openrouterDelta + copilotDelta;
    return {
      paidSpendMicroUsd: unconsentedPaidRequests === 0 ? 0 : unconsentedPaidRequests * PAID_REQUEST_MICRO_USD,
      unconsentedPaidRequests,
      openRouterRequestCount: openrouterDelta,
      copilotRequestsAfterQuotaZero: copilotDelta,
      consentDrillAllowsPaid: guard.evaluate({ reason: "usage_limit", consent: true }).allowed,
      exhaustionOk: scenarios.every((scenario) => scenario.ok),
      scenarios,
    };
  }
}

async function chatgptFull(
  plane: MockPlane,
  guard: NoSilentPaidFallbackGuard,
  faults: GateFaults,
  base: { anthropic: number },
): Promise<ExhaustionScenario> {
  const decision = guard.evaluate({ reason: "usage_limit", consent: false });
  if (faults.silentPaidPost === true) {
    await postJson(`${plane.origin}/v1/messages`, { source: "silent" });
  }
  const paid = plane.counts.anthropic - base.anthropic;
  const ok = decision.park === "CheckpointStopCard" && decision.allowed === false && paid === 0;
  return { id: "chatgpt-100", park: decision.park, ok, detail: ok ? "$0.00 anthropic" : "paid request" };
}

async function copilotOverage(plane: MockPlane, guard: NoSilentPaidFallbackGuard, faults: GateFaults): Promise<ExhaustionScenario> {
  const beforeComplete = plane.counts.copilotComplete;
  const beforeOpen = plane.counts.openrouter;
  const beforePaid = plane.counts.anthropic;
  const quota = await getJson(`${plane.origin}/copilot/quota`);
  const parsed = JSON.parse(quota.text) as { remaining?: number; overageEnabled?: boolean };
  const decision = guard.evaluate({ reason: "overage", consent: false });
  if (faults.copilotSendsAfterZero === true) {
    await postJson(`${plane.origin}/copilot/complete`, { overage: true });
  }
  if (faults.openRouterLeak === true) {
    await postJson(`${plane.origin}/openrouter/chat`, { retry: true });
  }
  const subsequent = plane.counts.copilotComplete - beforeComplete;
  const leaked = plane.counts.openrouter - beforeOpen;
  const paid = plane.counts.anthropic - beforePaid;
  const ok =
    quota.status === 200 &&
    parsed.remaining === 0 &&
    parsed.overageEnabled === true &&
    decision.park === "pause-before-overage" &&
    decision.allowed === false &&
    subsequent === 0 &&
    leaked === 0 &&
    paid === 0;
  return { id: "copilot-overage", park: decision.park, ok, detail: "remaining 0 before overage" };
}

async function cursorExpired(plane: MockPlane, guard: NoSilentPaidFallbackGuard): Promise<ExhaustionScenario> {
  const before = plane.counts.anthropic;
  const me = await getJson(`${plane.origin}/cursor/me`);
  const decision = guard.evaluate({ reason: "expired", consent: false });
  const ok = me.status === 401 && decision.park === "AccountCard" && plane.counts.anthropic === before;
  return { id: "cursor-expired", park: decision.park, ok, detail: "401 AccountCard" };
}

async function ollamaDown(guard: NoSilentPaidFallbackGuard): Promise<ExhaustionScenario> {
  const port = await closedPort();
  let code = "unknown";
  try {
    await new Promise<void>((resolve, reject) => {
      const request = http.get(`http://127.0.0.1:${port}/`, (response) => {
        response.resume();
        resolve();
      });
      request.on("error", reject);
    });
  } catch (error) {
    code = errorCode(error);
  }
  const decision = guard.evaluate({ reason: "econnrefused", consent: false });
  const ok = code === "ECONNREFUSED" && decision.park === "pause" && decision.allowed === false;
  return { id: "ollama-down", park: decision.park, ok, detail: code };
}

async function routeRevoked(guard: NoSilentPaidFallbackGuard, policy: SignedProviderPolicyPort): Promise<ExhaustionScenario> {
  const compliance = policy.routeCompliance(true);
  const decision = guard.evaluate({ reason: "route_revoked", consent: false });
  const ok = compliance === "route_revoked" && decision.park === "park-immediate" && decision.allowed === false;
  return { id: "route-revoked", park: decision.park, ok, detail: compliance };
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  if (error instanceof Error && error.message.includes("ECONNREFUSED")) return "ECONNREFUSED";
  return "unknown";
}
