import { describe, expect, it } from "vitest";
import { patchNodeFields } from "../../src/readiness/index.js";
import {
  addDecision,
  addFeature,
  createDb,
  decisionStatus,
  dependOn,
  seedWorkItem,
  services,
} from "./harness.js";

function seedPool(count: number) {
  const db = createDb();
  seedWorkItem(db);
  for (let index = 1; index <= count; index += 1) {
    addDecision(db, "W1", { id: `D-${index}`, title: `Optional ${index}`, criterion: `polish.${index}`, status: "open" });
  }
  return db;
}

describe("readiness bounded deferrals", () => {
  it("defers an optional criterion and lists it for the plan preview", () => {
    const db = createDb();
    seedWorkItem(db);
    addDecision(db, "W1", { id: "D-email", title: "Email provider", criterion: "delivery.provider", status: "open" });
    for (let index = 1; index <= 4; index += 1) {
      addDecision(db, "W1", { id: `D-pool-${index}`, title: `Pool ${index}`, status: "open" });
    }
    const { deferral } = services(db);
    const result = deferral.defer({
      workItemId: "W1",
      decisionId: "D-email",
      deferredReason: "stable delivery contract",
      revisitWave: "email-provider",
      stage: "mvp",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deferred).toMatchObject({
      decisionId: "D-email",
      criterionId: "delivery.provider",
      deferredReason: "stable delivery contract",
      revisitWave: "email-provider",
    });
    expect(decisionStatus(db, "D-email")).toBe("deferred");
    expect(deferral.listDeferred("W1")).toEqual([result.deferred]);
    const counts = services(db).calculator.project("W1").counts;
    expect(counts.deferred).toBe(1);
    expect(counts.settledTotal).toBe(0);
  });

  it("refuses to defer a must-ask or an active conflict", () => {
    const db = createDb();
    seedWorkItem(db);
    addDecision(db, "W1", {
      id: "D-refund",
      title: "Refund policy",
      criterion: "payments.refund_policy",
      status: "open",
      mustAsk: true,
    });
    addDecision(db, "W1", { id: "D-conflict", title: "Conflict", criterion: "billing.tax", status: "conflict" });
    const { deferral } = services(db);
    const mustAsk = deferral.defer({
      workItemId: "W1",
      decisionId: "D-refund",
      deferredReason: "later",
      revisitWave: "later",
    });
    const conflict = deferral.defer({
      workItemId: "W1",
      decisionId: "D-conflict",
      deferredReason: "later",
      revisitWave: "later",
    });
    expect(mustAsk).toEqual({
      ok: false,
      reason: "Cannot defer a must-ask criterion (payments.refund_policy)",
    });
    expect(conflict).toEqual({ ok: false, reason: "Cannot defer an active conflict (billing.tax)" });
    expect(decisionStatus(db, "D-refund")).toBe("open");
    expect(decisionStatus(db, "D-conflict")).toBe("conflict");
  });

  it("refuses to defer a criterion required by non-deferred scopes", () => {
    const db = createDb();
    seedWorkItem(db);
    addDecision(db, "W1", { id: "D-roles", title: "Roles", criterion: "auth.roles", status: "open" });
    addFeature(db, "W1", "S-Orders", "Orders");
    addFeature(db, "W1", "S-Admin", "Admin Panel");
    addFeature(db, "W1", "S-Invoices", "Invoices");
    dependOn(db, "S-Orders", "D-roles");
    dependOn(db, "S-Admin", "D-roles");
    dependOn(db, "S-Invoices", "D-roles");
    const result = services(db).deferral.defer({
      workItemId: "W1",
      decisionId: "D-roles",
      deferredReason: "later",
      revisitWave: "later",
    });
    expect(result).toEqual({
      ok: false,
      reason: "Required by Orders, Admin Panel, and Invoices",
    });
    expect(decisionStatus(db, "D-roles")).toBe("open");
  });

  it("allows deferrals inside the mvp 20% budget and rejects the next one", () => {
    const db = seedPool(10);
    const { deferral } = services(db);
    expect(deferral.defer({ workItemId: "W1", decisionId: "D-1", deferredReason: "polish", revisitWave: "later", stage: "mvp" }).ok).toBe(true);
    expect(deferral.defer({ workItemId: "W1", decisionId: "D-2", deferredReason: "polish", revisitWave: "later", stage: "mvp" }).ok).toBe(true);
    const third = deferral.defer({
      workItemId: "W1",
      decisionId: "D-3",
      deferredReason: "polish",
      revisitWave: "later",
      stage: "mvp",
    });
    expect(third).toEqual({
      ok: false,
      reason: "Deferral exceeds the mvp safe budget (20% of non-must-ask criteria)",
    });
    expect(decisionStatus(db, "D-3")).toBe("open");
  });

  it("uses the production 5% budget from the stage port", () => {
    const db = seedPool(20);
    const policy = services(db, { stage: { getStage: () => "production" } }).deferral;
    expect(policy.defer({ workItemId: "W1", decisionId: "D-1", deferredReason: "polish", revisitWave: "later" }).ok).toBe(true);
    const second = policy.defer({ workItemId: "W1", decisionId: "D-2", deferredReason: "polish", revisitWave: "later" });
    expect(second).toEqual({
      ok: false,
      reason: "Deferral exceeds the production safe budget (5% of non-must-ask criteria)",
    });
  });

  it("writes a deferral through the knowledge-graph port", () => {
    const db = createDb();
    seedWorkItem(db);
    for (let index = 1; index <= 5; index += 1) {
      addDecision(db, "W1", { id: `D-${index}`, title: `Optional ${index}`, status: "open" });
    }
    let patched = false;
    const result = services(db, {
      knowledge: {
        patchNodeFields(input) {
          patched = true;
          patchNodeFields(db, input);
        },
      },
    }).deferral.defer({
      workItemId: "W1",
      decisionId: "D-1",
      deferredReason: "polish",
      revisitWave: "later",
      stage: "mvp",
    });
    expect(patched).toBe(true);
    expect(result.ok).toBe(true);
    expect(decisionStatus(db, "D-1")).toBe("deferred");
  });
});
