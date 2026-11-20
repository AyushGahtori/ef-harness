import { describe, expect, it } from "vitest";

import { LocalPremiseSupersessionReopener, MICRO_USD_PER_DELTA_TASK, RevisionImpactPreviewer } from "../../src/revisions/index.js";
import {
  edit,
  engineFor,
  holdTasks,
  insertEdge,
  insertNode,
  insertTask,
  openDb,
  spawnCount,
  taskRow,
} from "./fixture.js";
import { HybridRevisionEngine } from "../../src/revisions/index.js";

describe("hybrid revision engine", () => {
  it("does no downstream work for a cosmetic edit", () => {
    const db = openDb();
    insertNode(db, { id: "D-Copy", kind: "decision", title: "Copy", text: "Recieve the confirmation." });
    insertNode(db, { id: "T-Copy", kind: "task", title: "Copy task", text: "copy" });
    insertTask(db, { id: "T-Copy", state: "WORKING", title: "Copy task" });
    insertEdge(db, { src: "T-Copy", type: "implements", dst: "D-Copy" });
    const engine = engineFor(db);
    const batch = engine.commitBatch({
      edits: [
        edit({
          nodeId: "D-Copy",
          beforeText: "Recieve the confirmation.",
          afterText: "Receive the confirmation.",
        }),
      ],
      triggerSource: "markdown",
      flushReason: "apply",
    });
    expect(batch.changeClass).toBe("cosmetic");
    expect(batch.impactedNodeIds).toEqual([]);
    expect(batch.holdTaskIds).toEqual([]);
    expect(batch.reworkTaskIds).toEqual([]);
    expect(batch.llmCalls).toBe(0);
    expect(engine.walker.combinedCalls).toBe(0);
    expect(holdTasks(db)).toEqual([]);
    expect(taskRow(db, "T-Copy")).toEqual({ state: "WORKING", verified: 0 });
    db.close();
  });

  it("holds only the working cutoff task and leaves the auth worker running", () => {
    const db = openDb();
    insertNode(db, { id: "D-Cutoff", kind: "decision", title: "Cutoff", text: "Kitchen cutoff is 11:00." });
    insertNode(db, {
      id: "R-Cutoff",
      kind: "requirement",
      title: "Cutoff rule",
      text: "Apply the cutoff.",
      fields: { proseReactive: true, canonical: "cutoff" },
    });
    insertNode(db, { id: "T-OrderCutoff", kind: "task", title: "Order cutoff", text: "cutoff task" });
    insertNode(db, { id: "R-Auth", kind: "requirement", title: "Auth", text: "Sign in with email and password." });
    insertNode(db, { id: "T-Auth", kind: "task", title: "Auth", text: "auth task" });
    insertTask(db, { id: "T-OrderCutoff", state: "WORKING", title: "Order cutoff" });
    insertTask(db, { id: "T-Auth", state: "WORKING", title: "Auth" });
    insertEdge(db, { src: "R-Cutoff", type: "derived_from", dst: "D-Cutoff" });
    insertEdge(db, { src: "T-OrderCutoff", type: "implements", dst: "R-Cutoff" });
    insertEdge(db, { src: "T-Auth", type: "implements", dst: "R-Auth" });
    const reopener = new LocalPremiseSupersessionReopener();
    const engine = new HybridRevisionEngine({ db, premiseReopener: reopener });
    const batch = engine.commitBatch({
      edits: [
        edit({
          nodeId: "D-Cutoff",
          beforeText: "Kitchen cutoff is 11:00.",
          afterText: "Kitchen cutoff is 10:30.",
        }),
      ],
      triggerSource: "chat",
      flushReason: "apply",
    });
    expect(batch.changeClass).toBe("breaking");
    expect(batch.holdTaskIds).toEqual(["T-OrderCutoff"]);
    expect(holdTasks(db)).toEqual(["T-OrderCutoff"]);
    expect(taskRow(db, "T-Auth")).toEqual({ state: "WORKING", verified: 0 });
    expect(reopener.calls.map((call) => call.premiseId)).toEqual(["D-Cutoff"]);
    const stored = engine.history.get(batch.revisionId);
    expect(stored).toMatchObject({
      revisionId: batch.revisionId,
      triggerSource: "chat",
      changeClass: "breaking",
      editedNodeIds: ["D-Cutoff"],
      holdTaskIds: ["T-OrderCutoff"],
      reworkTaskIds: [],
      llmCalls: 0,
    });
    db.close();
  });

  it("appends an additive task for a compatible field and leaves an unrelated merged task done", () => {
    const db = openDb();
    const schema = { id: { type: "string", required: true } };
    insertNode(db, {
      id: "C-Order",
      kind: "contract",
      title: "Order API",
      text: "Order API",
      fields: { schema },
    });
    insertNode(db, {
      id: "T-Order",
      kind: "task",
      title: "Order",
      text: "merged",
      fields: { satisfiedChecks: ["CHK-Order"] },
    });
    insertNode(db, { id: "CHK-Order", kind: "check", title: "Id", text: "id is present" });
    insertNode(db, { id: "T-Other", kind: "task", title: "Other", text: "other" });
    insertTask(db, { id: "T-Order", state: "DONE", title: "Order" });
    insertTask(db, { id: "T-Other", state: "DONE", title: "Other" });
    insertEdge(db, { src: "T-Order", type: "implements", dst: "C-Order" });
    insertEdge(db, { src: "CHK-Order", type: "verifies", dst: "C-Order" });
    const batch = engineFor(db).commitBatch({
      edits: [
        edit({
          nodeId: "C-Order",
          nodeKind: "contract",
          beforeText: "Order API",
          afterText: "Order API",
          beforeFields: { schema },
          afterFields: {
            schema: {
              id: { type: "string", required: true },
              notes: { type: "string", required: false },
            },
          },
        }),
      ],
      triggerSource: "markdown",
      flushReason: "apply",
    });
    expect(batch.changeClass).toBe("compatible");
    expect(batch.additiveTaskIds).toEqual(["ADD-RB-000001-1"]);
    expect(batch.reworkTaskIds).toEqual([]);
    expect(batch.holdTaskIds).toEqual([]);
    expect(batch.reverifiedPassedIds).toEqual(["T-Order"]);
    expect(spawnCount(db, "additive")).toBe(1);
    expect(taskRow(db, "T-Order").state).toBe("DONE");
    expect(taskRow(db, "T-Other")).toEqual({ state: "DONE", verified: 0 });
    db.close();
  });

  it("formats the zero-token impact preview for a breaking order-form edit", () => {
    const db = openDb();
    insertNode(db, {
      id: "C-Api",
      kind: "contract",
      title: "Order API",
      text: "Order API",
      fields: {
        schema: {
          id: { type: "string", required: true },
          email: { type: "string", required: true },
        },
      },
    });
    insertNode(db, { id: "T-Active", kind: "task", title: "Order form", text: "form" });
    insertTask(db, { id: "T-Active", state: "WORKING", title: "Order form" });
    insertEdge(db, { src: "T-Active", type: "implements", dst: "C-Api" });
    for (const id of ["T-Fin1", "T-Fin2"]) {
      insertNode(db, { id, kind: "task", title: id, text: id, fields: { satisfiedChecks: ["CHK-Api"] } });
      insertTask(db, { id, state: "DONE", title: id });
      insertEdge(db, { src: id, type: "implements", dst: "C-Api" });
    }
    insertNode(db, { id: "CHK-Api", kind: "check", title: "Id", text: "id remains" });
    insertEdge(db, { src: "CHK-Api", type: "verifies", dst: "C-Api" });
    for (let index = 1; index <= 9; index += 1) {
      const id = `T-U${index}`;
      insertNode(db, { id, kind: "task", title: id, text: id });
      insertTask(db, { id, state: index === 1 ? "WORKING" : "DONE", title: id });
    }
    const previewer = new RevisionImpactPreviewer();
    const started = performance.now();
    const sample = previewer.format({
      contractCount: 1,
      activeTasks: [{ id: "T-Active", title: "Order form" }],
      finishedTaskCount: 2,
      untouchedTaskCount: 9,
      deltaTasks: 2,
      deltaCostMicroUsd: 2 * MICRO_USD_PER_DELTA_TASK,
    });
    expect(performance.now() - started).toBeLessThan(15);
    expect(previewer.llmCalls).toBe(0);
    expect(sample).toBe(
      "Touches 1 contract, pauses 1 active task ('Order form'), re-checks 2 finished tasks, leaves 9 other tasks untouched · Est. delta: +2 tasks, ~$0.35",
    );
    const batch = engineFor(db).commitBatch({
      edits: [
        edit({
          nodeId: "C-Api",
          nodeKind: "contract",
          beforeText: "Order API",
          afterText: "Order API",
          beforeFields: {
            schema: {
              id: { type: "string", required: true },
              email: { type: "string", required: true },
            },
          },
          afterFields: { schema: { id: { type: "string", required: true } } },
        }),
      ],
      triggerSource: "canvas",
      flushReason: "apply",
    });
    expect(batch.preview).toBe(sample);
    expect(batch.llmCalls).toBe(0);
    expect(batch.holdTaskIds).toEqual(["T-Active"]);
    expect(holdTasks(db)).toEqual(["T-Active"]);
    expect(taskRow(db, "T-U1")).toEqual({ state: "WORKING", verified: 0 });
    db.close();
  });
});
