import { describe, expect, it } from "vitest";
import { RouteRevocationParkHandler, type PolicyRoute } from "../../src/policy/index.js";
import { editablePolicy } from "./fixtures.js";

describe("RouteRevocationParkHandler", () => {
  it("checkpoints the active step, emits one card, and blocks new dispatches", () => {
    const handler = new RouteRevocationParkHandler();
    const previous = editablePolicy().routes;
    const next = editablePolicy().routes.map((route) =>
      route.id === "siwc_preview"
        ? {
            ...route,
            status: "route_revoked" as const,
            revocationNotice: "Preview route withdrawn. Switch connection or keep parked.",
          }
        : route,
    );
    const result = handler.applyTransition({
      previousRoutes: previous,
      nextRoutes: next,
      connections: [
        {
          id: "chatgpt-plus",
          provider: "openai",
          route: "siwc",
          currency: "allowance:chatgpt",
          enabled: true,
          billing: "plan",
        },
      ],
      activeSteps: [
        {
          stepId: "atomic-1",
          connectionId: "chatgpt-plus",
          routeId: "siwc",
          checkpointed: false,
          corrupted: false,
        },
      ],
      checkpoint: (step) => ({ ...step, checkpointed: true, corrupted: true }),
      nowIso: "2026-11-22T00:00:00.000Z",
    });

    expect(result.card).not.toBeNull();
    expect(result.checkpointedStepIds).toEqual(["atomic-1"]);
    expect(result.steps[0]?.checkpointed).toBe(true);
    expect(result.steps[0]?.corrupted).toBe(false);
    expect(result.card?.connectionIds).toEqual(["chatgpt-plus"]);
    expect(result.card?.actions.map((action) => action.label)).toEqual([
      "Switch Connection",
      "Keep Parked",
    ]);
    expect(handler.allowDispatch({ routeId: "siwc", connectionId: "chatgpt-plus" })).toMatchObject({
      allowed: false,
      reason: "route_revoked",
    });
    expect(
      handler.considerSilentFallback({
        fromRouteId: "siwc_preview",
        toRouteId: "openai_api",
        toBilling: "api_key",
      }).reason,
    ).toBe("no_silent_paid_fallback");

    const repeat = handler.applyTransition({
      previousRoutes: next,
      nextRoutes: next,
      connections: [],
      activeSteps: [],
      checkpoint: (step) => step,
      nowIso: "2026-11-22T01:00:00.000Z",
    });
    expect(repeat.card).toBeNull();
  });

  it("does not park an unrelated route", () => {
    const handler = new RouteRevocationParkHandler();
    const routes = editablePolicy().routes satisfies PolicyRoute[];
    handler.syncFromDocument(routes, null);
    expect(handler.allowDispatch({ routeId: "local_ollama", connectionId: "local" }).allowed).toBe(true);
    expect(
      handler.considerSilentFallback({
        fromRouteId: "local_ollama",
        toRouteId: "openai_api",
        toBilling: "api_key",
      }).accepted,
    ).toBe(true);
  });
});
