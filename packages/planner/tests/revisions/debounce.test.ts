import { describe, expect, it } from "vitest";

import {
  DebouncedRevisionPropagator,
  HybridRevisionEngine,
  ManualScheduler,
  ScriptedContradictionEngine,
  type ContradictionFinding,
} from "../../src/revisions/index.js";
import { edit, insertNode, openDb } from "./fixture.js";

describe("DebouncedRevisionPropagator", () => {
  it("coalesces 4 edits inside 1500 ms into one batch and one contradiction check", () => {
    const db = openDb();
    const contradictions = new ScriptedContradictionEngine(() => []);
    const clock = new ManualScheduler();
    const engine = new HybridRevisionEngine({ db, contradictionEngine: contradictions, now: () => clock.now() });
    const propagator = new DebouncedRevisionPropagator(engine, clock);
    for (let index = 1; index <= 4; index += 1) {
      const id = `R-${index}`;
      insertNode(db, { id, kind: "requirement", title: id, text: "Send an order confirmation email." });
      propagator.submit(clarifying(id));
      if (index < 4) clock.advance(100);
    }
    expect(propagator.batches).toHaveLength(0);
    clock.advance(1_500);
    expect(propagator.batches).toHaveLength(1);
    expect(propagator.batches[0]?.editedNodeIds).toEqual(["R-1", "R-2", "R-3", "R-4"]);
    expect(propagator.batches[0]?.changeClass).toBe("clarifying");
    expect(contradictions.calls).toBe(1);
    expect(engine.walker.combinedCalls).toBe(1);
    expect(propagator.batches[0]?.conflictCard).toBeNull();
    db.close();
  });

  it("merges 3 canvas edits that arrive within 800 ms", () => {
    const db = openDb();
    const clock = new ManualScheduler();
    const engine = new HybridRevisionEngine({ db, now: () => clock.now() });
    const propagator = new DebouncedRevisionPropagator(engine, clock);
    for (let index = 1; index <= 3; index += 1) {
      const id = `R-${index}`;
      insertNode(db, { id, kind: "requirement", title: id, text: "Send an order confirmation email." });
      propagator.submit(clarifying(id, "canvas"));
      if (index < 3) clock.advance(200);
    }
    expect(propagator.batches).toHaveLength(0);
    clock.advance(1_500);
    expect(propagator.batches).toHaveLength(1);
    expect(propagator.batches[0]?.editedNodeIds).toHaveLength(3);
    expect(propagator.batches[0]?.triggerSource).toBe("canvas");
    db.close();
  });

  it("flushes immediately on Apply and Start", () => {
    const db = openDb();
    const clock = new ManualScheduler();
    const engine = new HybridRevisionEngine({ db, now: () => clock.now() });
    const propagator = new DebouncedRevisionPropagator(engine, clock);
    insertNode(db, { id: "R-1", kind: "requirement", title: "R-1", text: "Send an order confirmation email." });
    insertNode(db, { id: "R-2", kind: "requirement", title: "R-2", text: "Send an order confirmation email." });
    propagator.submit(clarifying("R-1"));
    propagator.submit(clarifying("R-2"));
    const applied = propagator.apply();
    expect(applied?.triggerSource).toBe("apply");
    expect(applied?.editedNodeIds).toEqual(["R-1", "R-2"]);
    clock.advance(5_000);
    expect(propagator.batches).toHaveLength(1);
    propagator.submit(clarifying("R-1", "chat"));
    const started = propagator.start();
    expect(started?.triggerSource).toBe("start");
    expect(propagator.batches).toHaveLength(2);
    db.close();
  });

  it("pauses the single coalesced batch when the contradiction engine reports a conflict", () => {
    const db = openDb();
    const contradictions = new ScriptedContradictionEngine((edits) => {
      if (!edits.some((item) => item.nodeId === "R-Bad")) return [];
      const finding: ContradictionFinding = {
        src: "R-Bad",
        dst: "R-Settled",
        edgeType: "contradicts",
        summary: "cutoff disagrees with the settled rule",
      };
      return [finding];
    });
    const clock = new ManualScheduler();
    const engine = new HybridRevisionEngine({ db, contradictionEngine: contradictions, now: () => clock.now() });
    const propagator = new DebouncedRevisionPropagator(engine, clock);
    for (const id of ["R-1", "R-2", "R-Bad", "R-4"]) {
      insertNode(db, { id, kind: "requirement", title: id, text: "Send an order confirmation email." });
      propagator.submit(clarifying(id));
      clock.advance(50);
    }
    clock.advance(1_500);
    expect(contradictions.calls).toBe(1);
    expect(propagator.batches).toHaveLength(1);
    const batch = propagator.batches[0];
    expect(batch?.conflictCard?.kind).toBe("conflict_card");
    expect(batch?.reworkTaskIds).toEqual([]);
    expect(batch?.holdTaskIds).toEqual([]);
    expect(engine.walker.combinedCalls).toBe(1);
    const text = db.prepare(`SELECT text FROM nodes WHERE id = 'R-Bad'`).get();
    expect(text?.text).toBe("Send an order confirmation email.");
    db.close();
  });
});

function clarifying(nodeId: string, triggerSource = "chat") {
  return edit({
    nodeId,
    nodeKind: "requirement",
    triggerSource,
    beforeText: "Send an order confirmation email.",
    afterText: "Order confirmation email must include order number.",
  });
}
