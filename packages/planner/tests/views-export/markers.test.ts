import { describe, expect, it } from "vitest";
import { LocalArchDocumentSharder, nodeTokenCost } from "../../src/views-export/arch-document-sharder.js";
import {
  EfNodeMarkerFormatter,
  parseEfNodeBlocks,
  unescapeMarkerText,
} from "../../src/views-export/ef-node-marker.js";
import { renderViewTree } from "../../src/views-export/render-views.js";
import { sampleSource, viewNode } from "./fixtures.js";

describe("ef:node markers", () => {
  const formatter = new EfNodeMarkerFormatter();

  it("writes ef:node markers and ef-fields for status, basis, owner, touches, bounds, and links", () => {
    const block = formatter.formatBlock({
      id: "R17",
      anchor: "r17",
      version: 3,
      baseHash: "sha256:" + "ab".repeat(32),
      title: "Cutoff",
      prose: "Cutoff is 11:00.",
      kind: "rule",
      status: "active",
      basis: "explicit",
      owner: "planner",
      touches: ["orders", "billing"],
      bounds: { max: 11, min: 0 },
      links: [{ type: "implements", dst: "F-Orders", pin: 1 }],
      extraFields: {},
      markdownLinks: [],
    });
    expect(block.block.startsWith("<!-- ef:node id=R17 rev=3 base_hash=sha256:")).toBe(true);
    expect(block.block.trimEnd().endsWith("<!-- /ef:node -->")).toBe(true);
    expect(block.fieldsYaml).toContain('status: "active"');
    expect(block.fieldsYaml).toContain('basis: "explicit"');
    expect(block.fieldsYaml).toContain('owner: "planner"');
    expect(block.fieldsYaml).toContain('"billing"');
    expect(block.fieldsYaml).toContain('"orders"');
    expect(block.fieldsYaml).toContain("max: 11");
    expect(block.fieldsYaml).toContain("min: 0");
    expect(block.fieldsYaml).toContain('type: "implements"');
    expect(block.fieldsYaml).toContain('dst: "F-Orders"');
    expect(block.fieldsYaml).toContain("pin: 1");
    expect(block.fieldsYaml.includes("&")).toBe(false);
    const parsed = parseEfNodeBlocks(block.block);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe("R17");
    expect(parsed[0]?.rev).toBe(3);
    expect(unescapeMarkerText(parsed[0]?.prose ?? "")).toBe("Cutoff is 11:00.");
  });

  it("keeps a literal closer inside prose from ending the block", () => {
    const block = formatter.formatBlock({
      id: "R17",
      anchor: "r17",
      version: 1,
      baseHash: "sha256:" + "cd".repeat(32),
      title: "Cutoff",
      prose: "Keep <!-- /ef:node --> in the prose and also <!-- ef:node id=fake rev=1 base_hash=sha256:00 -->",
      kind: "rule",
      status: "active",
      basis: null,
      owner: null,
      touches: [],
      bounds: null,
      links: [],
      extraFields: { note: "visible <!-- /ef:node -->" },
      markdownLinks: [],
    });
    const closers = block.block.split("\n").filter((line) => line === "<!-- /ef:node -->");
    expect(closers).toHaveLength(1);
    const parsed = parseEfNodeBlocks(block.block);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe("R17");
    expect(unescapeMarkerText(parsed[0]?.prose ?? "")).toContain("<!-- /ef:node -->");
    expect(unescapeMarkerText(parsed[0]?.fieldsYaml ?? "")).toContain("<!-- /ef:node -->");
  });
});

describe("view projection", () => {
  it("is byte-identical for the same graph and orders nodes by display order", () => {
    const source = sampleSource();
    const first = renderViewTree(source);
    const second = renderViewTree(source);
    expect(second.map((file) => file.content)).toEqual(first.map((file) => file.content));
    const decisions = first.find((file) => file.relativePath === "decisions.md");
    expect(decisions).toBeTruthy();
    const text = decisions?.content ?? "";
    expect(text.indexOf("id=D2")).toBeLessThan(text.indexOf("id=D0"));
    expect(text.indexOf("id=D0")).toBeLessThan(text.indexOf("id=D1"));
    const orders = first.find((file) => file.relativePath === "features/orders.md");
    expect(orders?.content).toContain("```ef-fields");
    expect(orders?.content).toContain('touches:');
    expect(orders?.content).toContain("implements [F-Orders](");
    const ids = first.flatMap((file) => parseEfNodeBlocks(file.content).map((block) => block.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["R17", "F-Orders", "C014", "S-Orders", "A-SYS", "X1", "D1"]));
    expect(first.some((file) => file.relativePath === "architecture/system.md")).toBe(true);
    expect(first.some((file) => file.relativePath === "architecture/contracts/c014.md")).toBe(true);
    expect(first.some((file) => file.relativePath === "architecture/screens/orders.md")).toBe(true);
    expect(first.some((file) => file.relativePath === "rules/cross-cutting.md")).toBe(true);
    expect(first.some((file) => file.relativePath === "overview.mmd")).toBe(true);
    expect(first.find((file) => file.relativePath === "overview.mmd")?.content).toContain("flowchart LR");
  });
});

describe("ArchDocumentSharder port", () => {
  it("puts each architectural node in one shard and keeps feature shards within 3000 tokens", () => {
    const words = Array.from({ length: 80 }, () => "alpha").join(" ");
    const nodes = [
      viewNode({ id: "SYS", kind: "arch_node", title: "System", text: "Root.", fields: { scope: "system" } }),
      viewNode({ id: "C1", kind: "contract", title: "API", text: "Contract." }),
      viewNode({ id: "SCREEN", kind: "arch_node", title: "Home", text: "Screen.", fields: { role: "screen" } }),
      viewNode({ id: "DEC", kind: "decision", title: "Not architecture", text: "Skip." }),
    ];
    for (let index = 0; index < 40; index += 1) {
      nodes.push(
        viewNode({
          id: `A${String(index).padStart(2, "0")}`,
          kind: "arch_node",
          title: `Part ${String(index)}`,
          text: words,
          feature: "orders",
        }),
      );
    }
    const assignments = new LocalArchDocumentSharder().assign(nodes);
    const ids = assignments.map((assignment) => assignment.nodeId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("DEC");
    expect(assignments.find((assignment) => assignment.nodeId === "C1")?.relativePath).toBe(
      "architecture/contracts/c1.md",
    );
    expect(assignments.find((assignment) => assignment.nodeId === "SCREEN")?.relativePath).toBe(
      "architecture/screens/screen.md",
    );
    expect(assignments.find((assignment) => assignment.nodeId === "SYS")?.relativePath).toBe("architecture/system.md");
    const byPath = new Map<string, typeof nodes>();
    for (const assignment of assignments) {
      const node = nodes.find((item) => item.id === assignment.nodeId);
      if (!node) continue;
      const group = byPath.get(assignment.relativePath);
      if (group) group.push(node);
      else byPath.set(assignment.relativePath, [node]);
    }
    const featurePaths = [...byPath.keys()].filter((file) => file.startsWith("architecture/features/"));
    expect(featurePaths.length).toBeGreaterThan(1);
    for (const [file, group] of byPath) {
      if (!file.startsWith("architecture/features/")) continue;
      const tokens = group.reduce((sum, node) => sum + nodeTokenCost(node), 0);
      expect(tokens).toBeLessThanOrEqual(3000);
    }
  });
});
