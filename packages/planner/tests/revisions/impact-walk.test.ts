import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CANONICAL_IMPACT_WALK_SQL, CYCLE_SAFE_IMPACT_WALK_SQL, ReverseImpactWalker } from "../../src/revisions/index.js";
import { insertEdge, insertNode, openDb } from "./fixture.js";

describe("ReverseImpactWalker", () => {
  it("executes the canonical impact_walk statement from schema/queries.sql", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
    const sql = readFileSync(join(root, "schema", "queries.sql"), "utf8");
    const block = sql.split("-- name: impact_walk")[1]?.split("-- name:")[0] ?? "";
    const statement = block.slice(block.indexOf("WITH RECURSIVE"));
    expect(squash(statement)).toBe(squash(CANONICAL_IMPACT_WALK_SQL));
    expect(CYCLE_SAFE_IMPACT_WALK_SQL).toContain("UNION");
    expect(CYCLE_SAFE_IMPACT_WALK_SQL).toContain("instr(");
  });

  it("completes a 500-node reverse walk in under 15 ms", () => {
    const db = openDb();
    insertNode(db, { id: "N0", kind: "decision", title: "Root", text: "root" });
    for (let index = 1; index < 500; index += 1) {
      const id = `N${index}`;
      insertNode(db, { id, kind: "task", title: id, text: id });
      insertEdge(db, { src: id, type: "depends_on", dst: "N0" });
    }
    const walker = new ReverseImpactWalker(db);
    walker.walkCombined(["N0"]);
    const started = performance.now();
    const impact = walker.walkCombined(["N0"]);
    const elapsed = performance.now() - started;
    expect(impact.nodes).toHaveLength(500);
    expect(impact.elapsedMs).toBeLessThan(15);
    expect(elapsed).toBeLessThan(15);
    expect(impact.cycleSafeQueries).toBe(1);
    expect(walker.executeCanonical("N0").nodes).toHaveLength(500);
    db.close();
  });

  it("stops on a cycle and returns each node once at any depth cap", () => {
    const db = openDb();
    for (const id of ["A", "B", "C"]) {
      insertNode(db, { id, kind: "decision", title: id, text: id });
    }
    insertEdge(db, { src: "B", type: "depends_on", dst: "A" });
    insertEdge(db, { src: "A", type: "depends_on", dst: "B" });
    insertEdge(db, { src: "C", type: "depends_on", dst: "A" });
    const walker = new ReverseImpactWalker(db);
    const shallow = walker.executeCycleSafe("A", 5).nodes.map((node) => node.id).sort();
    const deep = walker.executeCycleSafe("A", 50).nodes.map((node) => node.id).sort();
    expect(shallow).toEqual(["A", "B", "C"]);
    expect(deep).toEqual(shallow);
    expect(walker.executeCanonical("A", 50).nodes.map((node) => node.id).sort()).toEqual(["A", "B", "C"]);
    db.close();
  });

  it("includes belongs_to and consumes edges that the invalidates-only walk skips", () => {
    const db = openDb();
    insertNode(db, { id: "F-Orders", kind: "feature", title: "Orders", text: "orders" });
    insertNode(db, { id: "S-Order", kind: "screen", title: "Order screen", text: "screen" });
    insertNode(db, { id: "C-Order", kind: "contract", title: "Order API", text: "api" });
    insertNode(db, { id: "T-Read", kind: "task", title: "Read order", text: "read" });
    insertEdge(db, { src: "S-Order", type: "belongs_to", dst: "F-Orders" });
    insertEdge(db, { src: "T-Read", type: "consumes", dst: "C-Order" });
    const walker = new ReverseImpactWalker(db);
    const feature = walker.walkCombined(["F-Orders"]);
    const canonicalFeature = walker.executeCanonical("F-Orders").nodes.map((node) => node.id);
    expect(feature.affectedScreens).toEqual(["S-Order"]);
    expect(canonicalFeature).not.toContain("S-Order");
    const contract = walker.walkCombined(["C-Order"]);
    const canonicalContract = walker.executeCanonical("C-Order").nodes.map((node) => node.id);
    expect(contract.nodes.map((node) => node.id)).toContain("T-Read");
    expect(canonicalContract).not.toContain("T-Read");
    db.close();
  });

  it("ignores retired edges and nodes outside the walk", () => {
    const db = openDb();
    insertNode(db, { id: "D-Cutoff", kind: "decision", title: "Cutoff", text: "11:00" });
    insertNode(db, { id: "T-OrderCutoff", kind: "task", title: "Order cutoff", text: "cutoff" });
    insertNode(db, { id: "T-Auth", kind: "task", title: "Auth", text: "auth" });
    insertNode(db, { id: "R-Auth", kind: "requirement", title: "Auth", text: "auth" });
    insertEdge(db, { src: "T-OrderCutoff", type: "implements", dst: "D-Cutoff" });
    insertEdge(db, { src: "T-Auth", type: "implements", dst: "R-Auth" });
    insertEdge(db, { src: "T-Old", type: "depends_on", dst: "D-Cutoff", retired: true });
    const walker = new ReverseImpactWalker(db);
    const ids = walker.walkCombined(["D-Cutoff"]).nodes.map((node) => node.id);
    expect(ids).toContain("T-OrderCutoff");
    expect(ids).not.toContain("T-Auth");
    expect(ids).not.toContain("T-Old");
    db.close();
  });
});

function squash(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}
