import { afterEach, describe, expect, it } from "vitest";
import { MARKDOWN_ACTOR, writeCanonicalViews, type FieldMap } from "../../src/views-import/index.js";
import { createHarness, markdownCount, readView, writeView, type Harness } from "./support.js";

describe("views-import multi-file batch and round trip", () => {
  let harness: Harness | undefined;
  afterEach(() => {
    harness?.close();
    harness = undefined;
  });

  it("commits five offline field edits in one audited change set", () => {
    harness = createHarness();
    const nodes = [1, 2, 3, 4, 5].map((index) => ({
      id: `N${String(index)}`,
      title: `Note ${String(index)}`,
      filePath: `notes/n${String(index)}.md`,
    }));
    harness.graph.commitChangeSet({
      id: "CS-SEED-BATCH",
      origin: "planner",
      author: "test",
      summary: "seed batch",
      createdAt: 1_700_000_000_000,
      nodes: nodes.map((node) => ({
        op: "create" as const,
        id: node.id,
        kind: "rule",
        title: node.title,
        text: "Original note.",
        fields: { basis: "explicit", note: "original", touches: ["logging"] } satisfies FieldMap,
      })),
    });
    writeCanonicalViews({
      graph: harness.graph,
      viewsRoot: harness.viewsRoot,
      exportedAt: 1_700_000_000_000,
      files: nodes.map((node) => ({
        filePath: node.filePath,
        featureId: null,
        efFile: node.filePath.replace(/\.md$/, ""),
        title: node.title,
        nodeIds: [node.id],
      })),
    });
    for (const node of nodes) {
      writeView(
        harness,
        node.filePath,
        readView(harness, node.filePath).replace('note: "original"', 'note: "updated"'),
      );
    }

    const session = harness.importer.reconcile();

    expect(session.blockedBatch).toBe(false);
    expect(session.conflicts).toHaveLength(0);
    expect(markdownCount(harness.graph)).toBe(1);
    const audit = harness.graph.listChangeSets().filter((changeSet) => changeSet.author === MARKDOWN_ACTOR);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.createdAt).toBe(1_700_000_000_000);
    expect(audit[0]?.summary).toContain('"note":"original"');
    expect(audit[0]?.summary).toContain('"note":"updated"');
    for (const node of nodes) {
      expect(harness.graph.getNode(node.id)?.fields.note).toBe("updated");
      expect(harness.graph.getNode(node.id)?.fields.source).toBe("markdown_direct_edit");
      expect(harness.graph.listNodeVersions(node.id)).toHaveLength(2);
      expect(harness.pause.isHeld(node.filePath)).toBe(false);
    }
    expect(harness.revisions.batches[0]?.mutations).toHaveLength(5);
    expect(harness.importer.reconcile().pendingFiles).toHaveLength(0);
  });

  it("aborts an offline batch when one file has a schema violation", () => {
    harness = createHarness();
    const nodes = [1, 2, 3, 4, 5].map((index) => ({
      id: `B${String(index)}`,
      filePath: `batch/b${String(index)}.md`,
    }));
    harness.graph.commitChangeSet({
      id: "CS-SEED-ABORT",
      origin: "planner",
      author: "test",
      summary: "seed abort",
      createdAt: 1_700_000_000_000,
      nodes: nodes.map((node) => ({
        op: "create" as const,
        id: node.id,
        kind: "rule",
        title: node.id,
        text: "Keep.",
        fields: { basis: "explicit", touches: ["logging"] } satisfies FieldMap,
      })),
    });
    writeCanonicalViews({
      graph: harness.graph,
      viewsRoot: harness.viewsRoot,
      exportedAt: 1_700_000_000_000,
      files: nodes.map((node) => ({
        filePath: node.filePath,
        featureId: null,
        efFile: node.filePath.replace(/\.md$/, ""),
        title: node.id,
        nodeIds: [node.id],
      })),
    });
    const before = harness.graph.listChangeSets().length;
    nodes.forEach((node, index) => {
      const text = readView(harness, node.filePath);
      writeView(
        harness,
        node.filePath,
        index === 2 ? text.replace('touches: ["logging"]', 'touches: ["not_a_tag"]') : text.replace("Keep.", "Keep edited."),
      );
    });

    const session = harness.importer.reconcile();

    expect(session.blockedBatch).toBe(true);
    expect(session.schemaErrors.some((error) => error.message.includes("not_a_tag"))).toBe(true);
    expect(harness.graph.listChangeSets()).toHaveLength(before);
    for (const node of nodes) {
      expect(harness.graph.getNode(node.id)?.text).toBe("Keep.");
      expect(harness.pause.isHeld(node.filePath)).toBe(true);
    }
  });

  it("round-trips export, edit, import, and re-export without a second dirty scan", () => {
    harness = createHarness();
    harness.graph.commitChangeSet({
      id: "CS-SEED-RT",
      origin: "planner",
      author: "test",
      summary: "seed round trip",
      createdAt: 1_700_000_000_000,
      nodes: [
        {
          op: "create",
          id: "R17",
          kind: "rule",
          title: "Cutoff Rule R17",
          text: "Orders close at 11:00.",
          fields: { basis: "explicit", priority: "normal", touches: ["scheduling"] },
        },
      ],
    });
    const plan = {
      filePath: "features/orders.md",
      featureId: null,
      efFile: "features/orders",
      title: "Orders",
      nodeIds: ["R17"],
    };
    const first = writeCanonicalViews({
      graph: harness.graph,
      viewsRoot: harness.viewsRoot,
      exportedAt: 1_700_000_000_000,
      files: [plan],
    });
    const second = writeCanonicalViews({
      graph: harness.graph,
      viewsRoot: harness.viewsRoot,
      exportedAt: 1_700_000_000_000,
      files: [plan],
    });
    expect(readView(harness, plan.filePath)).toContain("<!-- ef:node id=R17 rev=1 base_hash=");
    expect(readView(harness, plan.filePath)).toContain("```ef-fields");
    expect(second.files[0]?.contentSha256).toBe(first.files[0]?.contentSha256);
    writeView(
      harness,
      plan.filePath,
      readView(harness, plan.filePath).replace('priority: "normal"', 'priority: "high"'),
    );
    const session = harness.importer.reconcile();
    expect(session.conflicts).toHaveLength(0);
    expect(harness.model.calls).toHaveLength(0);
    expect(harness.graph.getNode("R17")?.fields.priority).toBe("high");
    const exported = readView(harness, plan.filePath);
    expect(exported).toContain("<!-- ef:node id=R17 rev=2 base_hash=");
    expect(exported).toContain('priority: "high"');
    expect(exported).toContain('source: "markdown_direct_edit"');
    expect(harness.importer.reconcile().pendingFiles).toHaveLength(0);
    expect(harness.pause.heldFiles()).toHaveLength(0);
  });
});
