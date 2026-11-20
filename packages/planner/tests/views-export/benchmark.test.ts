import path from "node:path";
import { describe, expect, it } from "vitest";
import { KnowledgeViewExporter } from "../../src/views-export/exporter.js";
import { MemoryKnowledgeViewSource } from "../../src/views-export/knowledge-graph-port.js";
import { fakeGit, tempProject, viewNode } from "./fixtures.js";

describe("300-entity export latency", () => {
  it("exports 1000 nodes under 500 ms and one incremental node under 150 ms", async () => {
    const source = new MemoryKnowledgeViewSource();
    const groups = Array.from({ length: 10 }, (_, index) => `entity-group-${String(index)}`);
    for (let index = 0; index < 300; index += 1) {
      source.upsertNode(
        viewNode({
          id: `E${String(index).padStart(4, "0")}`,
          kind: "spec_item",
          title: `Entity ${String(index)}`,
          text: "Entity record.",
          feature: groups[index % 10] ?? "entity-group-0",
          fields: { entity: true },
        }),
      );
    }
    for (let index = 0; index < 250; index += 1) {
      source.upsertNode(
        viewNode({
          id: `D${String(index).padStart(4, "0")}`,
          kind: "decision",
          title: `Decision ${String(index)}`,
          text: "Decided.",
        }),
      );
    }
    for (let index = 0; index < 200; index += 1) {
      source.upsertNode(
        viewNode({
          id: `X${String(index).padStart(4, "0")}`,
          kind: "rule",
          title: `Rule ${String(index)}`,
          text: "Cross cutting.",
        }),
      );
    }
    for (let index = 0; index < 100; index += 1) {
      source.upsertNode(
        viewNode({
          id: `N${String(index).padStart(4, "0")}`,
          kind: "arch_node",
          title: `Module ${String(index)}`,
          text: "Module.",
          feature: groups[index % 10] ?? "entity-group-0",
        }),
      );
    }
    for (let index = 0; index < 50; index += 1) {
      source.upsertNode(
        viewNode({
          id: `F${String(index).padStart(2, "0")}`,
          kind: "feature",
          title: `Feature ${String(index)}`,
          text: "Feature.",
          feature: groups[index % 10] ?? "entity-group-0",
        }),
      );
    }
    for (let index = 0; index < 10; index += 1) {
      source.upsertNode(viewNode({ id: `C${String(index).padStart(2, "0")}`, kind: "contract", title: `Contract ${String(index)}`, text: "Contract." }));
    }
    for (let index = 0; index < 10; index += 1) {
      source.upsertNode(
        viewNode({
          id: `S${String(index).padStart(2, "0")}`,
          kind: "arch_node",
          title: `Screen ${String(index)}`,
          text: "Screen.",
          fields: { role: "screen" },
        }),
      );
    }
    for (let index = 0; index < 80; index += 1) {
      source.upsertNode(
        viewNode({
          id: `J${String(index).padStart(4, "0")}`,
          kind: "journey",
          title: `Journey ${String(index)}`,
          text: "Journey.",
          feature: groups[index % 10] ?? "entity-group-0",
        }),
      );
    }
    const nodes = source.listNodes();
    expect(nodes).toHaveLength(1000);
    expect(nodes.filter((node) => node.kind === "spec_item" && (node.fields as { entity?: boolean }).entity === true)).toHaveLength(300);
    source.setRevision(1);
    const projectRoot = await tempProject();
    const exporter = new KnowledgeViewExporter({
      projectRoot,
      source,
      git: fakeGit(),
      now: () => "2026-01-01T00:00:00.000Z",
      sleep: async () => {},
      backoff: () => 0,
    });
    const full = await exporter.exportAll();
    expect(full.paused).toEqual([]);
    expect(full.deferred).toEqual([]);
    expect(full.durationMs).toBeLessThan(500);
    const target = nodes.find((node) => node.id === "E0000");
    if (!target) throw new Error("missing entity");
    source.upsertNode(
      viewNode({
        id: target.id,
        kind: target.kind,
        title: target.title,
        text: "Entity record changed.",
        feature: target.feature,
        fields: { entity: true },
        version: 2,
        updatedRev: 2,
      }),
    );
    source.setRevision(2);
    const incremental = await exporter.exportIncremental();
    expect(incremental.durationMs).toBeLessThan(150);
    expect(incremental.written.some((file) => file.startsWith("features/"))).toBe(true);
    expect(incremental.written.length).toBeLessThan(8);
    expect(incremental.written.some((file) => file === path.posix.join("features", "entity-group-0.md") || file.startsWith("features/entity-group-0"))).toBe(true);
  });
});
