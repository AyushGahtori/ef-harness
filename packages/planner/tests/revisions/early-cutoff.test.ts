import { describe, expect, it } from "vitest";

import { edit, engineFor, holdTasks, insertEdge, insertNode, insertTask, openDb, taskRow } from "./fixture.js";

describe("EarlyCutoffReverifier", () => {
  it("halts at an unchanged contract and leaves the 14 downstream tasks untouched", () => {
    const db = openDb();
    insertNode(db, { id: "D1", kind: "decision", title: "Cutoff", text: "Kitchen cutoff is 11:00." });
    insertNode(db, {
      id: "R1",
      kind: "requirement",
      title: "Cutoff rule",
      text: "Orders follow the cutoff.",
      fields: { proseReactive: true, canonical: "r1" },
    });
    insertNode(db, {
      id: "C1",
      kind: "contract",
      title: "Order API",
      text: "Order API",
      fields: { canonical: "order-api-v1" },
    });
    insertEdge(db, { src: "R1", type: "derived_from", dst: "D1" });
    insertEdge(db, { src: "C1", type: "derived_from", dst: "R1" });
    for (let index = 1; index <= 14; index += 1) {
      const id = `T${index.toString().padStart(2, "0")}`;
      insertNode(db, { id, kind: "task", title: id, text: id });
      insertTask(db, { id, state: "WORKING", title: id });
      insertEdge(db, { src: id, type: "depends_on", dst: "C1" });
    }
    const engine = engineFor(db);
    const batch = engine.commitBatch({
      edits: [
        edit({
          nodeId: "D1",
          beforeText: "Kitchen cutoff is 11:00.",
          afterText: "Kitchen cutoff is 10:30.",
        }),
      ],
      triggerSource: "canvas",
      flushReason: "apply",
    });
    expect(batch.changeClass).toBe("breaking");
    expect(batch.earlyCutoffNodeIds).toEqual(["C1"]);
    expect(batch.impactedNodeIds).toEqual(["D1", "R1"]);
    expect(batch.holdTaskIds).toEqual([]);
    expect(holdTasks(db)).toEqual([]);
    expect(batch.reworkTaskIds).toEqual([]);
    for (let index = 1; index <= 14; index += 1) {
      const id = `T${index.toString().padStart(2, "0")}`;
      expect(taskRow(db, id)).toEqual({ state: "WORKING", verified: 0 });
      expect(batch.impactedNodeIds).not.toContain(id);
    }
    db.close();
  });
});
