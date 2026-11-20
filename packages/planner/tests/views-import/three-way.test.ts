import { afterEach, describe, expect, it } from "vitest";
import { parseViewFile, renderViewFile, ThreeWayNodeMerger } from "../../src/views-import/index.js";
import {
  breakTouchesOnLine42,
  createHarness,
  exportOrders,
  markdownCount,
  readView,
  remoteFields,
  replaceLine,
  seedOrders,
  writeView,
  type Harness,
} from "./support.js";

describe("views-import three-way merge, conflicts, and export pause", () => {
  let harness: Harness | undefined;
  afterEach(() => {
    harness?.close();
    harness = undefined;
  });

  it("merges disjoint field edits with zero model calls and keeps both values", () => {
    harness = createHarness();
    seedOrders(harness.graph);
    exportOrders(harness);
    remoteFields(harness.graph, "R17", { status: "in_progress" }, "CS-CHAT-STATUS");
    writeView(
      harness,
      "features/orders.md",
      replaceLine(readView(harness, "features/orders.md"), "priority:", 'priority: "high"'),
    );

    const session = harness.importer.reconcile();

    expect(harness.model.calls).toHaveLength(0);
    expect(session.conflicts).toHaveLength(0);
    expect(session.blockedBatch).toBe(false);
    expect(harness.pause.isHeld("features/orders.md")).toBe(false);
    const node = harness.graph.getNode("R17");
    expect(node?.fields.priority).toBe("high");
    expect(node?.fields.status).toBe("in_progress");
    expect(node?.fields.basis).toBe("explicit");
    expect(node?.fields.source).toBe("markdown_direct_edit");
    expect(node?.fields.cutoff_time).toBe("11:00");
    expect(harness.graph.taskRuntime("T-Order")).toMatchObject({ state: "READY", epoch: 0 });
    expect(readView(harness, "features/orders.md")).toContain('priority: "high"');
    expect(readView(harness, "features/orders.md")).toContain('status: "in_progress"');
    expect(harness.importer.reconcile().pendingFiles).toHaveLength(0);
  });

  it("emits a three-way conflict card and does not pick a same-field winner", () => {
    harness = createHarness();
    seedOrders(harness.graph);
    exportOrders(harness);
    remoteFields(harness.graph, "R17", { cutoff_time: "11:30" }, "CS-CHAT-CUTOFF");
    writeView(
      harness,
      "features/orders.md",
      replaceLine(readView(harness, "features/orders.md"), "cutoff_time:", 'cutoff_time: "10:30"'),
    );
    const before = harness.graph.getNode("R17");

    const session = harness.importer.reconcile();

    expect(harness.model.calls).toHaveLength(0);
    expect(session.conflicts).toHaveLength(1);
    expect(session.conflicts[0]?.summary).toBe(
      "Base: 11:00, Your Markdown Edit: 10:30, Current Chat Value: 11:30",
    );
    expect(session.conflicts[0]?.actions).toEqual(["keep_mine", "keep_current", "edit_merged"]);
    expect(session.conflicts[0]?.field).toBe("cutoff_time");
    expect(harness.pause.isHeld("features/orders.md")).toBe(true);
    expect(harness.pause.reason("features/orders.md")).toBe("disk_delta");
    expect(harness.graph.getNode("R17")?.fields.cutoff_time).toBe(before?.fields.cutoff_time);
    expect(markdownCount(harness.graph)).toBe(0);

    const cardId = session.conflicts[0]?.cardId ?? "";
    const kept = harness.importer.commitResolved(session.id, [{ cardId, action: "keep_mine" }]);
    expect(kept.conflicts).toHaveLength(0);
    expect(harness.pause.isHeld("features/orders.md")).toBe(false);
    expect(harness.graph.getNode("R17")?.fields.cutoff_time).toBe("10:30");
    expect(harness.graph.getNode("R17")?.fields.source).toBe("markdown_direct_edit");
    expect(readView(harness, "features/orders.md")).toContain('cutoff_time: "10:30"');
  });

  it("keeps the current database value or an edited merge when the user says so", () => {
    harness = createHarness();
    seedOrders(harness.graph);
    exportOrders(harness);
    remoteFields(harness.graph, "R17", { cutoff_time: "11:30" }, "CS-CHAT-CUTOFF");
    writeView(
      harness,
      "features/orders.md",
      replaceLine(readView(harness, "features/orders.md"), "cutoff_time:", 'cutoff_time: "10:30"'),
    );
    const session = harness.importer.reconcile();
    const cardId = session.conflicts[0]?.cardId ?? "";
    harness.importer.commitResolved(session.id, [{ cardId, action: "keep_current" }]);
    expect(harness.graph.getNode("R17")?.fields.cutoff_time).toBe("11:30");
    expect(harness.pause.isHeld("features/orders.md")).toBe(false);
    expect(readView(harness, "features/orders.md")).toContain('cutoff_time: "11:30"');
  });

  it("writes an explicit merged value when the user edits the conflict", () => {
    harness = createHarness();
    seedOrders(harness.graph);
    exportOrders(harness);
    remoteFields(harness.graph, "R17", { cutoff_time: "11:30" }, "CS-CHAT-CUTOFF");
    writeView(
      harness,
      "features/orders.md",
      replaceLine(readView(harness, "features/orders.md"), "cutoff_time:", 'cutoff_time: "10:30"'),
    );
    const session = harness.importer.reconcile();
    const cardId = session.conflicts[0]?.cardId ?? "";
    harness.importer.commitResolved(session.id, [{ cardId, action: "edit_merged", value: "10:45" }]);
    expect(harness.graph.getNode("R17")?.fields.cutoff_time).toBe("10:45");
    expect(harness.pause.isHeld("features/orders.md")).toBe(false);
    expect(readView(harness, "features/orders.md")).toContain('cutoff_time: "10:45"');
  });

  it("holds the export lock on broken YAML and reports the exact line", () => {
    harness = createHarness();
    seedOrders(harness.graph);
    exportOrders(harness);
    const beforeSets = harness.graph.listChangeSets().length;
    const beforeVersion = harness.graph.getNode("R17")?.version;
    writeView(harness, "features/orders.md", breakTouchesOnLine42(readView(harness, "features/orders.md")));

    const session = harness.importer.reconcile();

    expect(session.syntaxErrors.map((error) => error.banner)).toContain("Fix YAML syntax on line 42 to import");
    expect(session.blockedBatch).toBe(true);
    expect(harness.pause.isHeld("features/orders.md")).toBe(true);
    expect(harness.graph.listChangeSets()).toHaveLength(beforeSets);
    expect(harness.graph.getNode("R17")?.version).toBe(beforeVersion);
    expect(readView(harness, "features/orders.md")).toContain("touches: [auth,");
  });

  it("rejects anchors and unknown touches tags without writing a partial change set", () => {
    harness = createHarness();
    seedOrders(harness.graph);
    exportOrders(harness);
    const beforeSets = harness.graph.listChangeSets().length;
    const clean = readView(harness, "features/orders.md");
    writeView(
      harness,
      "features/orders.md",
      replaceLine(clean, "cutoff_time:", 'cutoff_time: &a "11:00"'),
    );
    const unsafe = harness.importer.reconcile();
    expect(unsafe.syntaxErrors.some((error) => error.message.includes("anchors"))).toBe(true);
    expect(harness.pause.isHeld("features/orders.md")).toBe(true);
    expect(harness.graph.listChangeSets()).toHaveLength(beforeSets);

    writeView(harness, "features/orders.md", replaceLine(clean, "touches:", 'touches: ["auth"]'));
    const invalid = harness.importer.reconcile();
    expect(invalid.schemaErrors.some((error) => error.message.includes('unknown touches tag "auth"'))).toBe(true);
    expect(invalid.blockedBatch).toBe(true);
    expect(harness.pause.isHeld("features/orders.md")).toBe(true);
    expect(markdownCount(harness.graph)).toBe(0);
    expect(harness.graph.getNode("R17")?.version).toBe(1);
  });

  it("discards a disk edit by restoring the canonical file and releasing the lock", () => {
    harness = createHarness();
    seedOrders(harness.graph);
    exportOrders(harness);
    remoteFields(harness.graph, "R17", { cutoff_time: "11:30" }, "CS-CHAT-CUTOFF");
    writeView(
      harness,
      "features/orders.md",
      replaceLine(readView(harness, "features/orders.md"), "cutoff_time:", 'cutoff_time: "10:30"'),
    );
    const session = harness.importer.reconcile();
    const discarded = harness.importer.discard(session.id);
    expect(discarded.conflicts).toHaveLength(0);
    expect(harness.pause.isHeld("features/orders.md")).toBe(false);
    expect(harness.graph.getNode("R17")?.fields.cutoff_time).toBe("11:30");
    expect(readView(harness, "features/orders.md")).toContain('cutoff_time: "11:30"');
    expect(readView(harness, "features/orders.md")).not.toContain("10:30");
  });

  it("plans a pure field disagreement without calling a model", () => {
    const merger = new ThreeWayNodeMerger();
    const plan = merger.plan({
      baseFields: { priority: "normal", status: "draft" },
      localFields: { priority: "high", status: "draft" },
      remoteFields: { priority: "normal", status: "in_progress" },
      baseProse: "same",
      localProse: "same",
      remoteProse: "same",
      baseTitle: "Title",
      localTitle: "Title",
      remoteTitle: "Title",
    });
    expect(plan.hasConflict).toBe(false);
    expect(plan.prose).toBe("unchanged");
    const merged = merger.mergedFields(plan, { priority: "normal", status: "in_progress" });
    expect(merged).toMatchObject({ priority: "high", status: "in_progress" });
  });

  it("round-trips a literal closer inside prose without splitting the block", () => {
    const closer = "<!-- /ef:node -->";
    const rendered = renderViewFile({
      efFile: "features/orders",
      featureId: "F-Orders",
      efRevision: 1,
      title: "Orders",
      nodes: [
        {
          id: "R17",
          kind: "rule",
          version: 1,
          contentHash: "sha256:abc",
          title: "Cutoff Rule R17",
          text: `Keep this literal ${closer} in the note.`,
          fields: { basis: "explicit", touches: ["scheduling"] },
          status: "active",
          feature: "F-Orders",
          basis: "explicit",
          changeSetId: "CS-1",
          createdRev: 1,
          updatedRev: 1,
        },
      ],
    });
    expect(rendered.text).toContain("<!-- ef:escaped /ef:node -->");
    expect(rendered.text.match(/<!-- \/ef:node -->/g)).toHaveLength(1);
    const parsed = parseViewFile(rendered.text);
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.prose).toContain(closer);
    expect(parsed.syntaxErrors).toHaveLength(0);
  });
});
