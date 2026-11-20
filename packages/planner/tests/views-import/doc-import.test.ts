import { afterEach, describe, expect, it } from "vitest";
import { MARKDOWN_ACTOR } from "../../src/views-import/index.js";
import {
  createHarness,
  exportOrders,
  markdownCount,
  readView,
  seedOrders,
  writeView,
  type Harness,
} from "./support.js";

describe("views-import doc-import prose, new sections, and audit", () => {
  let harness: Harness | undefined;
  afterEach(() => {
    harness?.close();
    harness = undefined;
  });

  it("commits a cosmetic typo with zero task invalidation and zero rework", () => {
    harness = createHarness((input) => {
      expect(input.baseProse).toContain("recieve");
      expect(input.editedProse).toContain("receive");
      expect(input.validNodeIds).toContain("R17");
      return { changeClass: "cosmetic", proposals: [] };
    });
    seedOrders(harness.graph, "Please recieve the order.");
    exportOrders(harness);
    writeView(
      harness,
      "features/orders.md",
      readView(harness, "features/orders.md").replace("Please recieve the order.", "Please receive the order."),
    );

    const session = harness.importer.reconcile();

    expect(harness.model.calls).toHaveLength(1);
    expect(session.confirmations).toHaveLength(0);
    expect(session.conflicts).toHaveLength(0);
    expect(harness.graph.getNode("R17")?.text).toBe("Please receive the order.");
    expect(harness.graph.taskRuntime("T-Order")).toMatchObject({ state: "READY", epoch: 0 });
    expect(harness.revisions.invalidated).toHaveLength(0);
    expect(harness.revisions.batches[0]?.mutations[0]?.changeClass).toBe("cosmetic");
    expect(harness.revisions.batches[0]?.mutations[0]?.invalidateTasks).toBe(false);
    const audit = harness.graph.listChangeSets().find((changeSet) => changeSet.author === MARKDOWN_ACTOR);
    expect(audit?.createdAt).toBe(1_700_000_000_000);
    expect(audit?.origin).toBe("markdown_edit");
    expect(audit?.summary).toContain("recieve");
    expect(audit?.summary).toContain("receive");
    expect(harness.graph.listNodeVersions("R17").length).toBeGreaterThan(1);
    expect(harness.pause.isHeld("features/orders.md")).toBe(false);
  });

  it("holds a semantic prose change that edits structured fields until the user confirms", () => {
    harness = createHarness((input) => {
      expect(input.currentFields.cutoff_time).toBe("11:00");
      return {
        changeClass: "semantic",
        proposals: [
          {
            kind: "update",
            target_id: "R17",
            node_type: "rule",
            fields: [{ key: "cutoff_time", value: "10:30" }],
            text: "Cutoff is 10:30 AM.",
            confidence: 0.9,
          },
        ],
      };
    });
    seedOrders(harness.graph, "Cutoff is 11:00 AM.");
    exportOrders(harness);
    writeView(
      harness,
      "features/orders.md",
      readView(harness, "features/orders.md").replace("Cutoff is 11:00 AM.", "Cutoff is 10:30 AM."),
    );

    const session = harness.importer.reconcile();

    expect(session.confirmations).toHaveLength(1);
    expect(session.confirmations[0]?.changeClass).toBe("semantic");
    expect(session.confirmations[0]?.message).toContain("cutoff_time");
    expect(harness.graph.getNode("R17")?.fields.cutoff_time).toBe("11:00");
    expect(harness.graph.getNode("R17")?.text).toBe("Cutoff is 11:00 AM.");
    expect(harness.pause.isHeld("features/orders.md")).toBe(true);
    expect(harness.revisions.batches).toHaveLength(0);

    const cardId = session.confirmations[0]?.cardId ?? "";
    harness.importer.commitResolved(session.id, [{ cardId, action: "confirm" }]);
    expect(harness.graph.getNode("R17")?.text).toBe("Cutoff is 10:30 AM.");
    expect(harness.graph.getNode("R17")?.fields.cutoff_time).toBe("10:30");
    expect(harness.graph.getNode("R17")?.fields.basis).toBe("explicit");
    expect(harness.graph.getNode("R17")?.fields.source).toBe("markdown_direct_edit");
    expect(harness.revisions.invalidated.some((mutation) => mutation.changeClass === "breaking")).toBe(true);
    expect(harness.graph.taskRuntime("T-Order")?.state).toBe("READY");
    expect(harness.pause.isHeld("features/orders.md")).toBe(false);
  });

  it("confirms a new unmarked heading before assigning a canonical id and exporting markers", () => {
    harness = createHarness((input) => {
      expect(input.baseProse).toBe("");
      expect(input.editedProse).toContain("Print Summary Button");
      expect(input.validNodeIds).toContain("R17");
      return {
        changeClass: "semantic",
        proposals: [
          {
            kind: "new_node",
            target_id: null,
            node_type: "spec_item",
            fields: [{ key: "feature", value: "F-Orders" }],
            text: "Print the order summary for the kitchen.",
            confidence: 0.8,
          },
        ],
      };
    });
    seedOrders(harness.graph);
    exportOrders(harness);
    const original = readView(harness, "features/orders.md");
    writeView(
      harness,
      "features/orders.md",
      `${original.replace(/\n$/, "")}\n\n## Print Summary Button\n\nPrint the order summary for the kitchen.\n`,
    );

    const session = harness.importer.reconcile();

    expect(session.confirmations.some((card) => card.kind === "new_node")).toBe(true);
    expect(harness.graph.listNodeIds()).not.toContain("SI-001");
    expect(harness.pause.isHeld("features/orders.md")).toBe(true);

    const card = session.confirmations.find((item) => item.kind === "new_node");
    harness.importer.commitResolved(session.id, [{ cardId: card?.cardId ?? "", action: "confirm" }]);
    const created = harness.graph.getNode("SI-001");
    expect(created?.kind).toBe("spec_item");
    expect(created?.title).toBe("Print Summary Button");
    expect(created?.fields.basis).toBe("explicit");
    expect(created?.fields.source).toBe("markdown_direct_edit");
    expect(created?.text).toContain("Print the order summary");
    const exported = readView(harness, "features/orders.md");
    expect(exported).toContain("<!-- ef:node id=SI-001 ");
    expect(exported).toContain("<!-- /ef:node -->");
    expect(harness.graph.listCurrentEdges().some((edge) => edge.src === "SI-001" && edge.type === "belongs_to")).toBe(true);
    expect(harness.pause.isHeld("features/orders.md")).toBe(false);
    expect(markdownCount(harness.graph)).toBe(1);
  });
});
