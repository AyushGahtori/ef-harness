import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  FeaturePlanDatabase,
  FeaturePlanError,
  RELATIONS_IN_FIELDS_SQL,
  RelationsToEdgesNormalizer,
} from "../../src/feature-plan/index.js";

describe("RelationsToEdgesNormalizer", () => {
  it("rejects a dangling requirement id before commit and leaves the database unchanged", () => {
    const db = FeaturePlanDatabase.memory();
    db.upsertNode({
      id: "REQ-1",
      kind: "spec_item",
      title: "Real",
      text: "A real requirement.",
      featureId: "F-orders",
      fields: { ears: "A real requirement." },
    });
    const normalizer = new RelationsToEdgesNormalizer(db);
    expect(() =>
      normalizer.commit([
        {
          id: "T-1",
          kind: "task",
          title: "Leaf",
          text: "One behavior",
          featureId: "F-orders",
          fields: {
            goal: "Leaf",
            implements: ["REQ-1", "REQ-999"],
            depends_on: [],
            belongs_to: ["F-orders"],
          },
        },
      ]),
    ).toThrow(FeaturePlanError);
    try {
      normalizer.commit([
        {
          id: "T-1",
          kind: "task",
          title: "Leaf",
          text: "One behavior",
          featureId: "F-orders",
          fields: { implements: ["REQ-999"] },
        },
      ]);
    } catch (error) {
      expect(error).toBeInstanceOf(FeaturePlanError);
      expect((error as FeaturePlanError).code).toBe("dangling_node");
      expect((error as FeaturePlanError).message).toContain("REQ-999");
    }
    expect(db.getNode("T-1")).toBeNull();
    expect(db.listEdges()).toEqual([]);
    expect(db.getNode("REQ-1")?.version).toBe(1);
  });

  it("persists canonical edges and strips relation lists from fields", () => {
    const db = FeaturePlanDatabase.memory();
    const normalizer = new RelationsToEdgesNormalizer(db);
    const result = normalizer.commit([
      {
        id: "F-orders",
        kind: "feature",
        title: "Orders",
        text: "Orders",
        featureId: "F-orders",
        fields: { title: "Orders" },
      },
      {
        id: "REQ-1",
        kind: "spec_item",
        title: "Cutoff",
        text: "Accept at 11:00.",
        featureId: "F-orders",
        fields: { belongs_to: ["F-orders"], ears: "Accept at 11:00." },
      },
      {
        id: "C-orders",
        kind: "contract",
        title: "Orders",
        text: "/api/orders",
        featureId: "F-orders",
        fields: { route: "/api/orders" },
      },
      {
        id: "ENT-order",
        kind: "arch_node",
        title: "Order",
        text: "Order",
        featureId: "F-orders",
        fields: { touches: ["personal_data"] },
      },
      {
        id: "T-1",
        kind: "task",
        title: "Leaf",
        text: "One behavior",
        featureId: "F-orders",
        fields: {
          goal: "Leaf",
          write_scope: ["src/f-orders/REQ-1.ts"],
          implements: ["REQ-1"],
          depends_on: [],
          belongs_to: ["F-orders"],
          consumes_contract: ["C-orders"],
          consumes: ["C-orders"],
          touches_entity: ["ENT-order"],
        },
      },
      {
        id: "CHK-1",
        kind: "check",
        title: "Visible",
        text: "expect(res.status).toBe(201)",
        featureId: "F-orders",
        fields: {
          visibility: "visible",
          verifies: ["REQ-1"],
          belongs_to: ["F-orders"],
        },
      },
    ]);
    expect(result.edges).toEqual(
      expect.arrayContaining([
        { src: "T-1", type: "implements", dst: "REQ-1" },
        { src: "T-1", type: "belongs_to", dst: "F-orders" },
        { src: "T-1", type: "consumes_contract", dst: "C-orders" },
        { src: "T-1", type: "touches_entity", dst: "ENT-order" },
        { src: "CHK-1", type: "verifies", dst: "REQ-1" },
        { src: "REQ-1", type: "belongs_to", dst: "F-orders" },
      ]),
    );
    const task = db.getNode("T-1");
    expect(task?.fields).not.toHaveProperty("implements");
    expect(task?.fields).not.toHaveProperty("depends_on");
    expect(task?.fields).not.toHaveProperty("consumes");
    expect(task?.fields).not.toHaveProperty("consumes_contract");
    expect(task?.fields).not.toHaveProperty("touches_entity");
    expect(task?.fields).not.toHaveProperty("belongs_to");
    expect(task?.fields).toMatchObject({ goal: "Leaf" });
    expect(db.relationsInFields()).toEqual([]);
    expect(db.extendedRelationsInFields()).toEqual([]);
  });

  it("runs the canonical relations_in_fields query from schema/queries.sql", () => {
    const queries = readFileSync(new URL("../../../../schema/queries.sql", import.meta.url), "utf8");
    const match = queries.match(/-- name: relations_in_fields[\s\S]*?\n(SELECT[\s\S]*?;)/);
    expect(match?.[1]).toBeDefined();
    const canonical = match?.[1]?.replace(/;\s*$/, "").replace(/\s+/g, " ").trim();
    const local = RELATIONS_IN_FIELDS_SQL.replace(/\s+/g, " ").trim();
    expect(local).toBe(canonical);
  });
});
