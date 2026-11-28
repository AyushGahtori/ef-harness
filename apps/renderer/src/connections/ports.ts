export interface ConnectionProbeResult {
  readonly latencyMs: number;
  readonly discoveredModelCount: number;
  readonly diagnostic: string;
}

export interface ConnectionProbePort {
  probe(input: {
    readonly id: string;
    readonly provider: string;
    readonly authMode: string;
  }): Promise<ConnectionProbeResult>;
}

export interface ExplicitFallbackOrderItem {
  readonly fromConnectionId: string;
  readonly toConnectionId: string;
  readonly capMicroUsd: number;
}

export type RouteComplianceStatus =
  | "allowed"
  | "opt_in_with_notice"
  | "disabled_by_policy"
  | "route_revoked";

export type GuardBillingClass = "local_free" | "subscription" | "pay_per_token" | "copilot_overage";

export type GuardConnectionStatus =
  | "healthy"
  | "exhausted"
  | "expired"
  | "route_revoked"
  | "failed"
  | "crashed"
  | "paused";

export interface GuardConnectionView {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly family: string;
  readonly billingClass: GuardBillingClass;
  readonly costRank: number;
  readonly costEstimate: string;
  readonly status: GuardConnectionStatus;
  readonly routable: boolean;
}

/**
 * Same request `NoSilentPaidFallbackGuard.evaluate` consumes after
 * `evaluateScreenFallback` resolves active and candidate connections.
 */
export interface FallbackGuardPort {
  evaluate(input: {
    readonly activeId: string;
    readonly candidateId: string;
    readonly reason: string;
    readonly neverFallbackWithoutAsking: boolean;
    readonly explicitFallbackOrder: readonly ExplicitFallbackOrderItem[];
    readonly spentMicroUsd: number;
    readonly incomingMicroUsd: number;
    readonly userConsent: boolean;
    readonly connections: readonly GuardConnectionView[];
  }): {
    readonly outcome: "allow" | "block";
    readonly message: string;
    readonly costEstimate: string;
    readonly parked: boolean;
  };
}

export interface SettingsNavigationPort {
  openSettings(route: "connections" | "usage"): void;
}

export type ProbeKind = "zero-token" | "conformance";

export function probeKindFor(provider: string, authMode: string): ProbeKind {
  const mode = authMode.toLowerCase();
  if (mode.includes("cli") || provider.endsWith("_cli") || provider === "gemini_cli") {
    return "conformance";
  }
  return "zero-token";
}
