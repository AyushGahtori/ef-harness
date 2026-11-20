import { describe, expect, it } from "vitest";
import { DeterministicArchConsistencyGate, openArchitectureStore } from "../../src/system-arch/index.js";

describe("DeterministicArchConsistencyGate", () => {
  it("catches dangling refs, shadowed names, unhoisted rules, orphans, cycles, and bad Mermaid", async () => {
    const store = openArchitectureStore();
    try {
      store.commitChangeSet({
        author: "test",
        summary: "faults",
        nodes: [
          feature("F-Auth"),
          feature("F-Billing"),
          feature("F-Old"),
          requirement("REQ-01"),
          requirement("REQ-14"),
          requirement("REQ-19"),
          requirement("REQ-22"),
          {
            id: "entity:Order",
            kind: "arch_node",
            title: "orders",
            text: "orders",
            fields: {
              feature: "F-Auth",
              basis: "derived",
              arch_role: "entity",
              owner: "F-Auth",
              table: "orders",
              canonical_name: "orders",
              relations: [{ target: "entity:Missing", kind: "fk" }],
            },
          },
          {
            id: "arch:dangling-dep",
            kind: "arch_node",
            title: "dangling",
            text: "dangling dependency",
            fields: { feature: "F-Auth", basis: "derived", arch_role: "module", depends_on: ["F-Gone"] },
          },
          contract("contract:auth-a", "F-Auth", "JWT header uses Authorization Bearer tenant-a."),
          contract("contract:auth-b", "F-Billing", "JWT header uses Authorization Token tenant-b."),
          {
            id: "diagram:context",
            kind: "arch_node",
            title: "context",
            text: "flowchart TD\n  A[User (Admin)]-->B",
            fields: { feature: "F-Auth", basis: "derived", arch_role: "diagram", diagram_kind: "context" },
          },
        ],
        edges: [
          { src: "F-Auth", type: "depends_on", dst: "F-Billing" },
          { src: "F-Billing", type: "depends_on", dst: "F-Auth" },
          { src: "F-Auth", type: "depends_on", dst: "F-Old" },
          { src: "F-Auth", type: "implements", dst: "REQ-01" },
          { src: "entity:Order", type: "belongs_to", dst: "F-Auth" },
        ],
      });
      store.commitChangeSet({
        author: "test",
        summary: "retire F-Old",
        nodes: [
          {
            id: "F-Old",
            kind: "feature",
            title: "Old",
            text: "Old",
            status: "retired",
            fields: { feature: "F-Old", basis: "derived", arch_role: "feature" },
          },
        ],
      });

      const report = await new DeterministicArchConsistencyGate().run(store);
      const codes = new Set(report.violations.map((item) => item.code));
      expect(codes).toEqual(
        new Set([
          "dangling_ref",
          "shadowed_name",
          "unhoisted_duplicated_rule",
          "orphan_requirements",
          "feature_cycle",
          "invalid_mermaid",
        ]),
      );
      expect(report.violations.find((item) => item.code === "orphan_requirements")?.message).toBe(
        "orphan_requirements: ['REQ-14', 'REQ-19', 'REQ-22']",
      );
      expect(report.violations.find((item) => item.code === "feature_cycle")?.message).toBe(
        "Feature dependency cycle: F-Auth -> F-Billing -> F-Auth",
      );
      expect(report.violations.find((item) => item.code === "invalid_mermaid")?.message).toMatch(/Parse error/);
      expect(store.getNode("contract:auth-session")).toBeDefined();

      const again = await new DeterministicArchConsistencyGate().run(store);
      expect(again.violations.some((item) => item.code === "unhoisted_duplicated_rule")).toBe(false);
    } finally {
      store.close();
    }
  }, 60_000);
});

function feature(id: string) {
  const route = id === "F-Auth" ? "/api/Kitchen" : "/api/kitchen";
  return {
    id,
    kind: "feature",
    title: id,
    text: id,
    fields: {
      feature: id,
      basis: "derived" as const,
      arch_role: "feature",
      ...(id === "F-Old" ? {} : { names: [{ kind: "http_route", value: route }] }),
    },
  };
}

function requirement(id: string) {
  return {
    id,
    kind: "spec_item",
    title: id,
    text: id,
    fields: { feature: "F-Auth", basis: "explicit" as const },
  };
}

function contract(id: string, owner: string, text: string) {
  return {
    id,
    kind: "contract",
    title: id,
    text,
    fields: { feature: owner, basis: "derived" as const, owner, schema_text: text },
  };
}
