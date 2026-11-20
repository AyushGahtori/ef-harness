import { describe, expect, it } from "vitest";
import { namedQuery } from "../../src/readiness/index.js";
import {
  addDecision,
  addDecisions,
  createDb,
  seedSchemaTestR10,
  seedWorkItem,
  services,
} from "./harness.js";

describe("readiness calculator", () => {
  it("matches the schema-test R10 readiness fixture bit for bit", () => {
    const db = createDb();
    seedSchemaTestR10(db);
    const direct = db.prepare(namedQuery("readiness")).get({ work_item: "W1" }) as {
      planning_total: number;
      planning_settled: number;
      overall_total: number;
      overall_settled: number;
      critical_open: number;
    };
    const report = services(db).calculator.project("W1");
    expect(direct.planning_total).toBe(2);
    expect(direct.planning_settled).toBe(1);
    expect(direct.overall_total).toBe(3);
    expect(direct.overall_settled).toBe(1);
    expect(direct.critical_open).toBe(1);
    expect(report.canonical).toEqual({
      planningTotal: direct.planning_total,
      planningSettled: direct.planning_settled,
      overallTotal: direct.overall_total,
      overallSettled: direct.overall_settled,
      criticalOpen: direct.critical_open,
    });
    expect(report.counts.settledExplicit).toBe(1);
    expect(report.counts.openMustAsk).toBe(1);
    expect(report.counts.openStandard).toBe(1);
    expect(report.counts.activeDenominator).toBe(3);
    expect(report.isReadyToPlan).toBe(false);
    expect(report.headline.includes("%")).toBe(false);
  });

  it("counts every status and basis combination without giving unverified claims credit", () => {
    const db = createDb();
    seedWorkItem(db);
    addDecisions(db, "W1", [
      { id: "D-explicit", title: "Explicit", status: "settled", basis: "explicit" },
      { id: "D-derived", title: "Derived", status: "settled", basis: "derived" },
      { id: "D-delegated", title: "Delegated", status: "settled", basis: "delegated" },
      { id: "D-defaulted", title: "Defaulted", status: "settled", basis: "defaulted" },
      { id: "D-observed", title: "Observed", status: "settled", basis: "observed" },
      { id: "D-proposed", title: "Proposed", status: "settled", basis: "proposed" },
      { id: "D-pending", title: "Pending", status: "pending_verification", basis: "derived" },
      { id: "D-open", title: "Open", status: "open" },
      { id: "D-must", title: "Must", status: "open", mustAsk: true },
      { id: "D-asked", title: "Asked", status: "asked" },
      { id: "D-partial", title: "Partial", status: "partial" },
      { id: "D-missing", title: "Missing", status: "missing" },
      { id: "D-conflict", title: "Conflict", status: "conflict" },
      { id: "D-deferred", title: "Deferred", status: "deferred" },
      { id: "D-deferred-must", title: "Deferred must", status: "deferred", mustAsk: true },
      { id: "D-na", title: "Pruned", status: "not_applicable" },
    ]);
    const report = services(db).calculator.project("W1");
    expect(report.counts).toMatchObject({
      settledExplicit: 1,
      settledDerived: 1,
      settledDelegated: 1,
      settledDefaulted: 1,
      settledObserved: 1,
      settledTotal: 5,
      chosenForYou: 2,
      pendingVerification: 2,
      openMustAsk: 2,
      openStandard: 2,
      partial: 1,
      missing: 1,
      conflict: 1,
      deferred: 1,
      notApplicable: 1,
      activeDenominator: 15,
      criterionCount: 16,
    });
    expect(report.canonical.planningSettled).toBe(6);
    expect(report.canonical.overallSettled).toBe(6);
    expect(report.isReadyToPlan).toBe(false);
    expect(report.headline.includes("%")).toBe(false);
  });

  it("refuses to round 99 of 100 with one conflict into a percentage or a plan", () => {
    const db = createDb();
    seedWorkItem(db);
    for (let index = 1; index <= 99; index += 1) {
      addDecision(db, "W1", {
        id: `D-${index}`,
        title: `Settled ${index}`,
        status: "settled",
        basis: "explicit",
      });
    }
    addDecision(db, "W1", { id: "D-conflict", title: "Conflict", status: "conflict" });
    const report = services(db).calculator.project("W1");
    expect(report.counts.settledTotal).toBe(99);
    expect(report.counts.activeDenominator).toBe(100);
    expect(report.counts.conflict).toBe(1);
    expect(report.isReadyToPlan).toBe(false);
    expect(report.headline).toBe("99 of 100 settled · 1 conflict blocks planning");
    expect(report.headline).not.toBe("100%");
    expect(report.headline).not.toBe("99%");
    expect(report.headline.includes("%")).toBe(false);
  });

  it("formats mixed blockers as exact counts, including chosen for you", () => {
    const db = createDb();
    seedWorkItem(db);
    for (let index = 1; index <= 12; index += 1) {
      addDecision(db, "W1", { id: `E-${index}`, title: `Explicit ${index}`, status: "settled", basis: "explicit" });
    }
    for (let index = 1; index <= 3; index += 1) {
      addDecision(db, "W1", { id: `G-${index}`, title: `Delegated ${index}`, status: "settled", basis: "delegated" });
    }
    addDecision(db, "W1", { id: "F-1", title: "Defaulted", status: "settled", basis: "defaulted" });
    addDecision(db, "W1", { id: "M-1", title: "Must 1", status: "open", mustAsk: true });
    addDecision(db, "W1", { id: "M-2", title: "Must 2", status: "open", mustAsk: true });
    addDecision(db, "W1", { id: "C-1", title: "Conflict", status: "conflict" });
    const report = services(db).calculator.project("W1");
    expect(report.headline).toBe("16 of 19 settled · 2 must-ask left · 1 conflict · 4 chosen for you");
    expect(report.isReadyToPlan).toBe(false);
  });

  it("gives pending verification and failed entailment zero credit and offers retry", () => {
    const db = createDb();
    seedWorkItem(db);
    addDecision(db, "W1", { id: "D-ok", title: "Ok", status: "settled", basis: "explicit" });
    addDecision(db, "W1", { id: "D-a", title: "Derived A", status: "settled", basis: "derived" });
    addDecision(db, "W1", { id: "D-b", title: "Derived B", status: "settled", basis: "derived" });
    const report = services(db, {
      entailment: {
        verdict(decisionId) {
          if (decisionId === "D-a" || decisionId === "D-b") return "unavailable";
          return "not_applicable";
        },
      },
    }).calculator.project("W1");
    expect(report.counts.pendingVerification).toBe(2);
    expect(report.counts.settledTotal).toBe(1);
    expect(report.counts.settledDerived).toBe(0);
    expect(report.isReadyToPlan).toBe(false);
    expect(report.actions).toEqual([
      { kind: "retry_verification", label: "Retry verification", decisionIds: ["D-a", "D-b"] },
    ]);
    expect(report.headline.includes("%")).toBe(false);
  });

  it("keeps a stored pending_verification criterion out of every settled counter", () => {
    const db = createDb();
    seedWorkItem(db);
    addDecision(db, "W1", { id: "D-p", title: "Awaiting", status: "pending_verification", basis: "derived" });
    const report = services(db).calculator.project("W1");
    expect(report.counts.pendingVerification).toBe(1);
    expect(report.counts.settledTotal).toBe(0);
    expect(report.actions[0]?.label).toBe("Retry verification");
  });

  it("guards a fully pruned scope against division by zero", () => {
    const db = createDb();
    seedWorkItem(db);
    addDecision(db, "W1", { id: "D-1", title: "Auth", status: "not_applicable", scopeId: "S-Auth", scopeLabel: "Auth" });
    addDecision(db, "W1", { id: "D-2", title: "DB", status: "not_applicable", scopeId: "S-Data", scopeLabel: "Data" });
    const report = services(db).calculator.project("W1");
    expect(report.counts.activeDenominator).toBe(0);
    expect(report.counts.notApplicable).toBe(2);
    expect(report.counts.settledTotal).toBe(0);
    expect(report.disposition).toBe("not_applicable");
    expect(report.headline).toBe("Not applicable · excluded from the active denominator");
    expect(report.headline.includes("%")).toBe(false);
    expect(report.headline.includes("NaN")).toBe(false);
    expect(report.isReadyToPlan).toBe(true);
  });

  it("reads an empty scope as awaiting scope definition", () => {
    const db = createDb();
    seedWorkItem(db, "W-empty");
    const report = services(db).calculator.project("W-empty");
    expect(report.counts.criterionCount).toBe(0);
    expect(report.counts.activeDenominator).toBe(0);
    expect(report.disposition).toBe("awaiting_definition");
    expect(report.headline).toBe("awaiting scope definition");
    expect(report.isReadyToPlan).toBe(true);
  });

  it("is ready only when every blocker count is zero and transitive prerequisites are met", () => {
    const db = createDb();
    seedWorkItem(db);
    addDecision(db, "W1", { id: "D-1", title: "Purpose", status: "settled", basis: "explicit" });
    const ready = services(db).calculator.project("W1");
    expect(ready.isReadyToPlan).toBe(true);
    expect(ready.headline).toBe("1 of 1 settled");
    expect(ready.disposition).toBe("active");

    const partial = createDb();
    seedWorkItem(partial);
    addDecision(partial, "W1", { id: "D-p", title: "Partial", status: "partial" });
    expect(services(partial).calculator.project("W1").isReadyToPlan).toBe(false);

    const missing = createDb();
    seedWorkItem(missing);
    addDecision(missing, "W1", { id: "D-m", title: "Missing", status: "missing" });
    expect(services(missing).calculator.project("W1").isReadyToPlan).toBe(false);
  });
});
