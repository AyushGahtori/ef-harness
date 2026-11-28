import { NoSilentPaidFallbackGuard } from "./guard.js";
import type { FallbackDecision, FallbackInput } from "./types.js";

export type RouteCompliance =
  | "allowed"
  | "opt_in_with_notice"
  | "disabled_by_policy"
  | "route_revoked";

export interface SignedProviderPolicyEnginePort {
  routeCompliance(providerId: string): RouteCompliance;
}

export interface AllowancePacingControllerPort {
  activeCwnd(connectionId: string): number;
  reservePercent(connectionId: string): number;
}

export interface BudgetLedgerPort {
  fallbackSpendMicroUsd(projectId: string, fromConnectionId: string, toConnectionId: string): number;
}

export interface ZeroTokenProbeResult {
  readonly latencyMs: number;
  readonly discoveredModelCount: number;
  readonly diagnostic: string;
}

export interface ApiKeyAuthPort {
  readonly kind: "api_key";
  probe(connectionId: string): Promise<ZeroTokenProbeResult>;
}

export interface SiwcAuthPort {
  readonly kind: "siwc";
  probe(connectionId: string): Promise<ZeroTokenProbeResult>;
}

export interface OpenRouterAndLocalAuthPort {
  readonly kind: "openrouter_or_local";
  probe(connectionId: string): Promise<ZeroTokenProbeResult>;
}

export interface CopilotCursorAuthPort {
  readonly kind: "copilot_or_cursor";
  probe(connectionId: string): Promise<ZeroTokenProbeResult>;
}

export interface SingleAppShellNavigationPort {
  openSettings(route: "connections" | "usage"): void;
}

export class MemoryBudgetLedger implements BudgetLedgerPort {
  private readonly spent = new Map<string, number>();

  set(projectId: string, fromConnectionId: string, toConnectionId: string, microUsd: number): void {
    this.spent.set(`${projectId}\u0000${fromConnectionId}\u0000${toConnectionId}`, microUsd);
  }

  fallbackSpendMicroUsd(projectId: string, fromConnectionId: string, toConnectionId: string): number {
    return this.spent.get(`${projectId}\u0000${fromConnectionId}\u0000${toConnectionId}`) ?? 0;
  }
}

export class MemorySignedProviderPolicy implements SignedProviderPolicyEnginePort {
  constructor(private readonly routes: Readonly<Record<string, RouteCompliance>> = {}) {}

  routeCompliance(providerId: string): RouteCompliance {
    return this.routes[providerId] ?? "allowed";
  }
}

export class MemoryAllowancePacing implements AllowancePacingControllerPort {
  private readonly cwnd = new Map<string, number>();
  private readonly reserve = new Map<string, number>();

  setActiveCwnd(connectionId: string, cwnd: number): void {
    this.cwnd.set(connectionId, cwnd);
  }

  setReservePercent(connectionId: string, percent: number): void {
    this.reserve.set(connectionId, percent);
  }

  activeCwnd(connectionId: string): number {
    return this.cwnd.get(connectionId) ?? 0;
  }

  reservePercent(connectionId: string): number {
    return this.reserve.get(connectionId) ?? 0;
  }
}

export type AuthProbeKind = "api_key" | "siwc" | "openrouter_or_local" | "copilot_or_cursor";

export interface AuthProbePorts {
  readonly apiKey: ApiKeyAuthPort;
  readonly siwc: SiwcAuthPort;
  readonly openRouterAndLocal: OpenRouterAndLocalAuthPort;
  readonly copilotCursor: CopilotCursorAuthPort;
}

export function dispatchConnectionProbe(
  kind: AuthProbeKind,
  ports: AuthProbePorts,
  connectionId: string,
): Promise<ZeroTokenProbeResult> {
  if (kind === "api_key") return ports.apiKey.probe(connectionId);
  if (kind === "siwc") return ports.siwc.probe(connectionId);
  if (kind === "openrouter_or_local") return ports.openRouterAndLocal.probe(connectionId);
  return ports.copilotCursor.probe(connectionId);
}

export function evaluateWithLedger(
  guard: NoSilentPaidFallbackGuard,
  ledger: BudgetLedgerPort,
  projectId: string,
  input: Omit<FallbackInput, "spentMicroUsd">,
): FallbackDecision {
  const spentMicroUsd = ledger.fallbackSpendMicroUsd(
    projectId,
    input.active.id,
    input.candidate.id,
  );
  return guard.evaluate({ ...input, spentMicroUsd });
}
