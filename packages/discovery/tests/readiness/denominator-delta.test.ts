import { describe, expect, it } from "vitest";
import { SilentDenominatorJumpError } from "../../src/readiness/index.js";
import {
  addDecision,
  addDecisions,
  createDb,
  markNotApplicable,
  seedWorkItem,
  services,
  settle,
} from "./harness.js";

describe("readiness denominator deltas", () => {
  it("explains billing criteria added after enabling Stripe", () => {
    const db = createDb();
    seedWorkItem(db);
    for (let index = 1; index <= 15; index += 1) {
      addDecision(db, "W1", { id: `D-${index}`, title: `Item ${index}`, status: "open", scopeId: "S-Core", scopeLabel: "Core" });
    }
    const { explainer } = services(db);
    explainer.recordBaseline({ workItemId: "W1", turnId: "turn-1" });
    for (let index = 1; index <= 5; index += 1) {
      addDecision(db, "W1", {
        id: `B-${index}`,
        title: `Billing ${index}`,
        status: "open",
        scopeId: "S-Billing",
        scopeLabel: "Billing",
      });
    }
    const explained = explainer.explainTurn({ workItemId: "W1", turnId: "turn-2", trigger: "enabling Stripe" });
    expect(explained.changed).toBe(true);
    expect(explained.delta?.explanation).toBe(
      "Total items changed 15 → 20 (+5 billing items added after enabling Stripe)",
    );
    expect(explainer.latestDelta("W1")?.explanation).toBe(explained.delta?.explanation);
    expect(explainer.latestSnapshot("W1")?.activeDenominator).toBe(20);
    const stored = db
      .prepare("SELECT count(*) AS n FROM outbox WHERE type = 'discovery.denominator_delta' AND subject = 'W1'")
      .get() as { n: number };
    expect(stored.n).toBe(1);
  });

  it("reports settlements and newly unlocked groups in the same turn", () => {
    const db = createDb();
    seedWorkItem(db);
    for (let index = 1; index <= 10; index += 1) {
      addDecision(db, "W1", { id: `D-${index}`, title: `Item ${index}`, status: "open" });
    }
    const { explainer } = services(db);
    explainer.recordBaseline({ workItemId: "W1", turnId: "turn-1" });
    settle(db, "D-1", "explicit");
    settle(db, "D-2", "explicit");
    settle(db, "D-3", "explicit");
    for (let index = 1; index <= 5; index += 1) {
      addDecision(db, "W1", {
        id: `B-${index}`,
        title: `Billing ${index}`,
        status: "open",
        scopeId: "S-Billing",
        scopeLabel: "Billing",
      });
    }
    for (let index = 1; index <= 3; index += 1) {
      addDecision(db, "W1", {
        id: `E-${index}`,
        title: `Email ${index}`,
        status: "open",
        scopeId: "S-Email",
        scopeLabel: "Email",
      });
    }
    const explained = explainer.explainTurn({ workItemId: "W1", turnId: "turn-2", trigger: "enabling Stripe and email" });
    expect(explained.delta?.explanation).toBe("3 settled · +8 new items unlocked (5 Billing, 3 Email)");
    expect(explained.delta?.settledThisTurn).toBe(3);
    expect(explained.snapshot.activeDenominator).toBe(18);
  });

  it("explains criteria pruned to not applicable", () => {
    const db = createDb();
    seedWorkItem(db);
    for (let index = 1; index <= 10; index += 1) {
      addDecision(db, "W1", {
        id: `A-${index}`,
        title: `Auth ${index}`,
        status: "open",
        scopeId: "S-Auth",
        scopeLabel: "Auth",
      });
    }
    const { explainer } = services(db);
    explainer.recordBaseline({ workItemId: "W1", turnId: "turn-1" });
    for (let index = 1; index <= 4; index += 1) markNotApplicable(db, `A-${index}`);
    const explained = explainer.explainTurn({ workItemId: "W1", turnId: "turn-2", trigger: "No user accounts" });
    expect(explained.delta?.explanation).toBe(
      "Total items changed 10 → 6 (-4 auth items marked not applicable after No user accounts)",
    );
    expect(explained.snapshot.criterionIds).toHaveLength(6);
  });

  it("rejects a silent denominator jump until a delta is recorded", () => {
    const db = createDb();
    seedWorkItem(db);
    addDecisions(db, "W1", [{ id: "D-1", title: "One", status: "open" }]);
    const { explainer, gate } = services(db);
    explainer.recordBaseline({ workItemId: "W1", turnId: "turn-1" });
    addDecision(db, "W1", { id: "D-2", title: "Two", status: "open" });
    expect(() => gate.transition("W1")).toThrow(SilentDenominatorJumpError);
    const explained = explainer.explainTurn({ workItemId: "W1", turnId: "turn-2", trigger: "adding a question" });
    expect(explained.changed).toBe(true);
    expect(() => gate.transition("W1")).not.toThrow();
  });
});
