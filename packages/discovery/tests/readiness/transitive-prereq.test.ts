import { describe, expect, it } from "vitest";
import {
  addDecision,
  addDecisions,
  addFeature,
  createDb,
  dependOn,
  seedWorkItem,
  services,
} from "./harness.js";

describe("readiness transitive prerequisites", () => {
  it("blocks S-Checkout while S-Auth still has an open must-ask", () => {
    const db = createDb();
    seedWorkItem(db);
    addFeature(db, "W1", "S-Auth", "Auth");
    addFeature(db, "W1", "S-Checkout", "Checkout");
    addDecision(db, "W1", {
      id: "D-session",
      title: "Session expiry",
      criterion: "auth.session_expiry",
      status: "open",
      mustAsk: true,
      scopeId: "S-Auth",
      scopeLabel: "Auth",
    });
    for (let index = 1; index <= 8; index += 1) {
      addDecision(db, "W1", {
        id: `D-check-${index}`,
        title: `Checkout ${index}`,
        status: "settled",
        basis: "explicit",
        scopeId: "S-Checkout",
        scopeLabel: "Checkout",
      });
    }
    dependOn(db, "S-Checkout", "S-Auth");
    const { calculator } = services(db);
    const checkout = calculator.scope("W1", "S-Checkout");
    expect(checkout.counts.settledTotal).toBe(8);
    expect(checkout.counts.activeDenominator).toBe(8);
    expect(checkout.transitivePrereqsMet).toBe(false);
    expect(checkout.blockedByPrereq).toEqual(["S-Auth"]);
    expect(checkout.isReadyToPlan).toBe(false);
    expect(checkout.drilldown.mustAsk).toEqual([]);
    expect(checkout.drilldown.blockedByPrereqScope.map((blocker) => blocker.criterionId)).toEqual([
      "auth.session_expiry",
    ]);
    expect(checkout.drilldown.blockedByPrereqScope[0]?.focus).toEqual({
      kind: "question",
      targetId: "D-session",
    });
    expect(calculator.project("W1").isReadyToPlan).toBe(false);
  });

  it("allows the downstream scope once the ancestor must-ask is settled", () => {
    const db = createDb();
    seedWorkItem(db);
    addFeature(db, "W1", "S-Auth", "Auth");
    addFeature(db, "W1", "S-Checkout", "Checkout");
    addDecisions(db, "W1", [
      {
        id: "D-session",
        title: "Session expiry",
        criterion: "auth.session_expiry",
        status: "settled",
        basis: "explicit",
        mustAsk: true,
        scopeId: "S-Auth",
        scopeLabel: "Auth",
      },
      {
        id: "D-check",
        title: "Checkout",
        status: "settled",
        basis: "explicit",
        scopeId: "S-Checkout",
        scopeLabel: "Checkout",
      },
    ]);
    dependOn(db, "S-Checkout", "S-Auth");
    const checkout = services(db).calculator.scope("W1", "S-Checkout");
    expect(checkout.transitivePrereqsMet).toBe(true);
    expect(checkout.blockedByPrereq).toEqual([]);
    expect(checkout.isReadyToPlan).toBe(true);
  });
});
