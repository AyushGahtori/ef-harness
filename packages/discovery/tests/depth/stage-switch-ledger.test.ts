import { afterEach, describe, expect, it } from "vitest";
import { DepthSession } from "../../src/depth/index.js";
import type { DepthCatalogEntry } from "../../src/depth/index.js";
import { FIXED_CLOCK, highOpen, lowImpact, mediumImpact } from "./fixtures.js";

const sessions: DepthSession[] = [];

afterEach(() => {
  while (sessions.length > 0) sessions.pop()?.close();
});

function openSession(catalog: readonly DepthCatalogEntry[], stage: "prototype" | "mvp" | "production" = "prototype") {
  const session = new DepthSession({ catalog, clock: FIXED_CLOCK, stage, title: "Stage switch fixture" });
  sessions.push(session);
  return session;
}

describe("stage promotion, demotion, cap, and ledger override", () => {
  it("preserves explicit decisions and opens only the production delta", () => {
    const explicit = Array.from({ length: 15 }, (_unused, index) =>
      highOpen(`explicit.${String(index + 1).padStart(2, "0")}`, `Explicit ${index + 1}`),
    );
    const delta = [
      mediumImpact("ops.backups", "Backups"),
      mediumImpact("ops.rate_limiting", "Rate limiting"),
      mediumImpact("ops.audit_logging", "Audit logging"),
      mediumImpact("ops.https_headers", "HTTPS and headers"),
      mediumImpact("ops.error_alerting", "Error alerting"),
      mediumImpact("ops.observability", "Observability"),
    ];
    const session = openSession([...explicit, ...delta], "prototype");
    for (const entry of explicit) session.recordExplicit(entry.criterionId, "keep");
    const before = new Map(
      explicit.map((entry) => {
        const decision = session.decision(entry.criterionId);
        return [entry.criterionId, session.graph.getNode(decision.nodeId)?.fieldsJson];
      }),
    );
    const switched = session.switchStage("production");
    expect(switched.banner).toBe("+6 criteria added for Production stage");
    expect(switched.reopened).toHaveLength(6);
    expect(switched.preservedExplicit).toHaveLength(15);
    expect(session.scopeReason()).toBe("+6 criteria added for Production stage");
    for (const entry of explicit) {
      const decision = session.decision(entry.criterionId);
      expect(decision.basis).toBe("explicit");
      expect(decision.value).toBe("keep");
      expect(session.graph.getNode(decision.nodeId)?.fieldsJson).toBe(before.get(entry.criterionId));
    }
    for (const entry of delta) {
      const decision = session.decision(entry.criterionId);
      expect(decision.status).toBe("open");
      expect(decision.basis).toBeUndefined();
      expect(decision.value).toBeNull();
    }
  });

  it("reopens prototype defaults that cross the MVP threshold", () => {
    const session = openSession(
      [
        lowImpact("scale.users", "Expected users"),
        mediumImpact("ops.logs", "Logs"),
        mediumImpact("ops.accessibility", "Accessibility"),
      ],
      "prototype",
    );
    expect(session.decision("ops.logs").basis).toBe("defaulted");
    expect(session.decision("scale.users").basis).toBe("defaulted");
    const switched = session.switchStage("mvp");
    expect(switched.banner).toBe("+2 criteria added for MVP stage");
    expect(session.decision("ops.logs").status).toBe("open");
    expect(session.decision("ops.accessibility").status).toBe("open");
    expect(session.decision("scale.users").basis).toBe("defaulted");
  });

  it("downgrades open production-only criteria to prototype defaults and keeps history", () => {
    const productionOnly = (criterionId: string, label: string): DepthCatalogEntry => ({
      ...mediumImpact(criterionId, label),
      stageApplicability: { prototype: false, mvp: false, production: true },
      strongConventionStages: [],
      recommendations: [
        {
          stage: "prototype",
          optionId: "not_in_this_release",
          rationale: "Lightweight prototype default.",
          safeForLowerStage: true,
        },
        {
          stage: "production",
          optionId: "durable",
          rationale: "Production keeps the durable option.",
          safeForLowerStage: false,
        },
      ],
    });
    const openIds = ["ops.backups", "ops.rate_limiting", "ops.audit_logging", "ops.https_headers"];
    const session = openSession(
      [...openIds.map((id) => productionOnly(id, id)), highOpen("explicit.keep", "Keep this")],
      "production",
    );
    for (const criterionId of openIds) {
      expect(session.decision(criterionId).status).toBe("open");
    }
    session.recordExplicit("explicit.keep", "keep");
    const explicitJson = session.graph.getNode(session.decision("explicit.keep").nodeId)?.fieldsJson;
    const switched = session.switchStage("prototype");
    expect(switched.banner).toBeNull();
    expect(switched.preservedExplicit).toEqual(["explicit.keep"]);
    expect(session.graph.getNode(session.decision("explicit.keep").nodeId)?.fieldsJson).toBe(explicitJson);
    for (const criterionId of openIds) {
      const decision = session.decision(criterionId);
      expect(decision.basis).toBe("defaulted");
      expect(decision.value).toBe("not_in_this_release");
      expect(session.graph.getNode(decision.nodeId)).not.toBeNull();
      const versions = session.versions(criterionId);
      expect(versions.length).toBeGreaterThanOrEqual(2);
      expect(versions.some((version) => JSON.parse(version.fieldsJson).status === "open")).toBe(true);
    }
    const ledgerIds = session.ledger.view().entries.map((entry) => entry.criterionId).sort();
    expect(ledgerIds).toEqual([...openIds].sort());
  });

  it("pushes questions past the prototype cap into Chosen for you", () => {
    const capped = Array.from({ length: 12 }, (_unused, index) =>
      highOpen(`cap.${String(index).padStart(2, "0")}`, `Cap ${index}`, index),
    );
    const session = openSession(
      [...capped, mustAskAuth()],
      "prototype",
    );
    const chosen = session.ledger.view().entries.map((entry) => entry.criterionId).sort();
    expect(chosen).toEqual(["cap.00", "cap.01"]);
    expect(session.decisions().filter((decision) => decision.status === "open" && !decision.mustAsk)).toHaveLength(10);
    expect(session.decision("auth.roles").status).toBe("open");
    expect(session.decision("auth.roles").basis).toBeUndefined();
  });

  it("overrides a delegated decision to explicit, drops it from the ledger, and reopens derived dependents", () => {
    const session = openSession([
      highOpen("choice.storage", "Where is data stored", 4),
      highOpen("choice.migrations", "Migration strategy", 1),
      highOpen("choice.theme", "Theme", 0),
      lowImpact("scale.users", "Expected users"),
    ]);
    session.acceptAllRecommended({ scope: "batch", criterionIds: ["choice.storage"] });
    session.linkDerived("choice.migrations", "choice.storage", "keep");
    session.recordExplicit("choice.theme", "change");
    const neighbor = session.graph.getNode(session.decision("choice.theme").nodeId)?.fieldsJson;
    expect(session.decision("choice.storage").basis).toBe("delegated");
    expect(session.decision("choice.migrations").basis).toBe("derived");
    const result = session.overrideChosen("choice.storage", "change");
    expect(result.basis).toBe("explicit");
    expect(result.reopenedDependents).toEqual(["choice.migrations"]);
    const overridden = session.decision("choice.storage");
    expect(overridden.basis).toBe("explicit");
    expect(overridden.value).toBe("change");
    expect(overridden.supersession?.previousBasis).toBe("delegated");
    expect(session.ledger.view().entries.map((entry) => entry.criterionId)).not.toContain("choice.storage");
    expect(session.decision("choice.migrations").status).toBe("open");
    expect(session.decision("choice.migrations").basis).toBeUndefined();
    expect(session.graph.getNode(session.decision("choice.theme").nodeId)?.fieldsJson).toBe(neighbor);
    const versions = session.versions("choice.storage");
    expect(versions.some((version) => JSON.parse(version.fieldsJson).basis === "delegated")).toBe(true);
    expect(session.graph.getNode(overridden.nodeId)?.basis).toBe("explicit");
  });

  it("lists every delegated and defaulted decision for plan preview", () => {
    const session = openSession(
      [lowImpact("scale.users", "Expected users"), highOpen("choice.storage", "Where is data stored", 4)],
      "prototype",
    );
    session.acceptAllRecommended({ scope: "open" });
    const autos = session
      .decisions()
      .filter((decision) => decision.basis === "delegated" || decision.basis === "defaulted")
      .map((decision) => decision.criterionId)
      .sort();
    const view = session.ledger.view();
    expect(view.entries.map((entry) => entry.criterionId).sort()).toEqual(autos);
    expect(view.planPreviewEntries).toEqual(view.entries);
    expect(session.ledger.forPlanPreview()).toEqual(view.entries);
    expect(view.groups.map((group) => group.basis).sort()).toEqual(["defaulted", "delegated"]);
    const storage = view.entries.find((entry) => entry.criterionId === "choice.storage");
    expect(storage).toMatchObject({
      criterionLabel: "Where is data stored",
      chosenValue: "Keep",
      basis: "delegated",
      impactLevel: "critical",
      downstreamTaskCount: 4,
      change: { label: "Change", route: "revision", task: "Task-087" },
      override: { label: "Override", route: "revision", task: "Task-087" },
      planPreview: { surface: "plan-preview", task: "Task-108", visibleBeforeStartBuild: true },
    });
    const scale = view.entries.find((entry) => entry.criterionId === "scale.users");
    expect(scale?.basis).toBe("defaulted");
    expect(scale?.chosenValue).toBe("Not in this release");
    expect(view.entries.every((entry) => entry.rationale.length > 0)).toBe(true);
  });
});

function mustAskAuth(): DepthCatalogEntry {
  return {
    ...highOpen("auth.roles", "Who can sign in"),
    mustAskClass: "authentication_roles",
    domain: "authentication",
  };
}
