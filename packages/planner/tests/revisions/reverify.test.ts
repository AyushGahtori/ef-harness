import { describe, expect, it } from "vitest";

import { ReverifyBeforeReworkGate } from "../../src/revisions/index.js";
import { edit, engineFor, insertEdge, insertNode, insertTask, openDb, spawnCount, taskRow } from "./fixture.js";

describe("ReverifyBeforeReworkGate", () => {
  const gate = new ReverifyBeforeReworkGate();

  it("passes when merged code already satisfies the updated check", () => {
    const decision = gate.evaluate(
      "T-Email",
      new Set(["CHK-Email"]),
      [
        {
          id: "CHK-Email",
          title: "Order number",
          text: "confirmation includes the order number",
          requirementId: "R-Email",
        },
      ],
    );
    expect(decision.outcome).toBe("verified_under_rev");
    expect(decision.failingChecks).toEqual([]);
  });

  it("returns the failing check diff and does not spawn from the gate", () => {
    const decision = gate.evaluate("T-Email", new Set(), [
      {
        id: "CHK-Email",
        title: "Order number",
        text: "confirmation includes the order number",
        requirementId: "R-Email",
      },
    ]);
    expect(decision.outcome).toBe("rework_required");
    expect(decision.failingChecks).toEqual([
      {
        checkId: "CHK-Email",
        title: "Order number",
        expected: "confirmation includes the order number",
        actual: "merged code does not satisfy this check",
      },
    ]);
  });
});

describe("re-verify before rework", () => {
  it("marks the merged email task verified and spawns zero rework when the check already passes", () => {
    const db = openDb();
    seedEmail(db, ["CHK-Email"]);
    const batch = engineFor(db).commitBatch({
      edits: [emailEdit()],
      triggerSource: "chat",
      flushReason: "apply",
    });
    expect(batch.changeClass).toBe("clarifying");
    expect(batch.reworkTaskIds).toEqual([]);
    expect(batch.holdTaskIds).toEqual([]);
    expect(batch.reverifiedPassedIds).toEqual(["T-Email"]);
    expect(spawnCount(db, "rework")).toBe(0);
    expect(taskRow(db, "T-Email")).toEqual({ state: "DONE", verified: 1 });
    db.close();
  });

  it("spawns one surgical rework task only after the merged check fails", () => {
    const db = openDb();
    seedEmail(db, []);
    const batch = engineFor(db).commitBatch({
      edits: [emailEdit()],
      triggerSource: "chat",
      flushReason: "apply",
    });
    expect(batch.reverifiedPassedIds).toEqual([]);
    expect(batch.reworkTaskIds).toEqual(["RW-RB-000001-T-Email"]);
    expect(spawnCount(db, "rework")).toBe(1);
    const row = db.prepare(`SELECT payload FROM revision_spawned_tasks WHERE id = :id`).get({
      id: "RW-RB-000001-T-Email",
    });
    const payload = JSON.parse(String(row?.payload)) as { failingChecks: { checkId: string }[] };
    expect(payload.failingChecks.map((check) => check.checkId)).toEqual(["CHK-Email"]);
    expect(taskRow(db, "T-Email")).toEqual({ state: "DONE", verified: 0 });
    db.close();
  });
});

function emailEdit() {
  return edit({
    nodeId: "R-Email",
    nodeKind: "requirement",
    beforeText: "Send an order confirmation email.",
    afterText: "Order confirmation email must include order number.",
  });
}

function seedEmail(db: ReturnType<typeof openDb>, satisfied: readonly string[]): void {
  insertNode(db, {
    id: "R-Email",
    kind: "requirement",
    title: "Confirmation email",
    text: "Send an order confirmation email.",
  });
  insertNode(db, {
    id: "CHK-Email",
    kind: "check",
    title: "Order number",
    text: "confirmation includes the order number",
  });
  insertNode(db, {
    id: "T-Email",
    kind: "task",
    title: "Email",
    text: "merged email sender",
    fields: { satisfiedChecks: [...satisfied] },
  });
  insertTask(db, { id: "T-Email", state: "DONE", title: "Email" });
  insertEdge(db, { src: "CHK-Email", type: "verifies", dst: "R-Email" });
  insertEdge(db, { src: "T-Email", type: "implements", dst: "R-Email" });
}
