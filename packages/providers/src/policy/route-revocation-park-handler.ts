import type {
  AccountCard,
  ActiveAtomicStep,
  ConnectionRecord,
  DispatchDecision,
  PolicyRoute,
  SilentFallbackDecision,
} from "./types.js";

const CONNECTION_ROUTE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  siwc_preview: ["siwc"],
  gemini_cli_acp: ["gemini_cli"],
  codex_cli: ["codex_app_server"],
  copilot_sdk: ["copilot"],
  cursor_sdk: ["cursor"],
};

const DEFAULT_ACTIONS: AccountCard["actions"] = [
  { id: "switch_connection", label: "Switch Connection" },
  { id: "keep_parked", label: "Keep Parked" },
];

export interface ParkTransitionInput {
  previousRoutes: readonly PolicyRoute[];
  nextRoutes: readonly PolicyRoute[];
  connections: readonly ConnectionRecord[];
  activeSteps: readonly ActiveAtomicStep[];
  checkpoint: (step: ActiveAtomicStep) => ActiveAtomicStep;
  nowIso: string;
}

export interface ParkTransitionResult {
  card: AccountCard | null;
  steps: ActiveAtomicStep[];
  parkedRouteIds: string[];
  checkpointedStepIds: string[];
}

export class RouteRevocationParkHandler {
  private readonly revoked = new Set<string>();
  private card: AccountCard | null = null;

  syncFromDocument(routes: readonly PolicyRoute[], pendingCard: AccountCard | null = null): void {
    this.revoked.clear();
    for (const route of routes) {
      if (route.status === "route_revoked") this.revoked.add(route.id);
    }
    this.card = pendingCard;
  }

  currentCard(): AccountCard | null {
    return this.card;
  }

  acknowledgeCard(): void {
    this.card = null;
  }

  isRevoked(routeId: string): boolean {
    for (const revokedId of this.revoked) {
      if (routesMatch(routeId, revokedId)) return true;
    }
    return false;
  }

  applyTransition(input: ParkTransitionInput): ParkTransitionResult {
    const previous = new Map(input.previousRoutes.map((route) => [route.id, route.status]));
    const newlyRevoked = input.nextRoutes.filter(
      (route) => route.status === "route_revoked" && previous.get(route.id) !== "route_revoked",
    );
    this.syncFromDocument(input.nextRoutes, this.card);

    const revokedIds = new Set(newlyRevoked.map((route) => route.id));
    const matchedConnections = input.connections.filter((connection) =>
      [...revokedIds].some((routeId) => connectionMatchesRoute(connection.route, routeId)),
    );
    const checkpointedStepIds: string[] = [];
    const steps = input.activeSteps.map((step) => {
      const hit = [...revokedIds].some((routeId) => routesMatch(step.routeId, routeId));
      if (!hit) return step;
      const saved = input.checkpoint(step);
      checkpointedStepIds.push(step.stepId);
      return { ...saved, checkpointed: true, corrupted: false };
    });

    let card: AccountCard | null = null;
    if (newlyRevoked.length > 0) {
      const notice = newlyRevoked
        .map(
          (route) =>
            route.revocationNotice ??
            "This route was revoked by the signed provider policy. New dispatches are parked.",
        )
        .join("\n");
      card = {
        cardId: `route-revoked-${input.nowIso}-${newlyRevoked.map((route) => route.id).join("+")}`,
        kind: "route_revoked",
        routeIds: newlyRevoked.map((route) => route.id),
        connectionIds: matchedConnections.map((connection) => connection.id),
        revocationNotice: notice,
        actions: DEFAULT_ACTIONS,
        silentPaidFallback: false,
      };
      this.card = card;
    }

    return {
      card,
      steps,
      parkedRouteIds: [...revokedIds],
      checkpointedStepIds,
    };
  }

  allowDispatch(input: { routeId: string; connectionId: string }): DispatchDecision {
    if (!this.isRevoked(input.routeId)) {
      return { allowed: true, reason: "ok", card: null };
    }
    return {
      allowed: false,
      reason: "route_revoked",
      card: this.card,
    };
  }

  considerSilentFallback(input: {
    fromRouteId: string;
    toRouteId: string;
    toBilling: ConnectionRecord["billing"];
  }): SilentFallbackDecision {
    if (this.isRevoked(input.toRouteId)) {
      return { accepted: false, reason: "target_revoked" };
    }
    if (this.isRevoked(input.fromRouteId) && input.toBilling === "api_key") {
      return { accepted: false, reason: "no_silent_paid_fallback" };
    }
    return { accepted: true, reason: "ok" };
  }

  acceptExplicitSwitch(input: { toRouteId: string; explicitUserChoice: boolean }): SilentFallbackDecision {
    if (!input.explicitUserChoice) {
      return { accepted: false, reason: "no_silent_paid_fallback" };
    }
    if (this.isRevoked(input.toRouteId)) {
      return { accepted: false, reason: "target_revoked" };
    }
    return { accepted: true, reason: "ok" };
  }
}

function routesMatch(candidate: string, policyRouteId: string): boolean {
  return candidate === policyRouteId || connectionMatchesRoute(candidate, policyRouteId);
}

function connectionMatchesRoute(connectionRoute: string, policyRouteId: string): boolean {
  if (connectionRoute === policyRouteId) return true;
  const aliases = CONNECTION_ROUTE_ALIASES[policyRouteId] ?? [];
  return aliases.includes(connectionRoute);
}
