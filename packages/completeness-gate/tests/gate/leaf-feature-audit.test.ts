import { describe, expect, it } from "vitest";
import { createCompletenessGateRunner } from "../../src/gate/index.js";
import type { ProducedContract, SchemaFieldPlan } from "../../src/gate/index.js";
import { added, makeFeature, makeLeaf } from "./support.js";

const group = `export function groupKitchenOrders(orders: readonly string[]) {
  const lines: string[] = [];
  for (const order of orders) {
    lines.push(order.trim());
  }
  if (lines.length === 0) {
    throw new Error("no orders to group");
  }
  return lines;
}
`;

const printSource = `import { groupKitchenOrders } from "./group";
export function printRows(orders: readonly string[]) {
  const grouped = groupKitchenOrders(orders);
  return grouped.join("\\n");
}
`;

const produces: ProducedContract[] = [
  { kind: "function", name: "groupKitchenOrders", plannedConsumerTaskId: "T03" },
];

const migration = "CREATE TABLE orders (\n  id TEXT,\n  pickup_slot TEXT\n);\n";

const field: SchemaFieldPlan = {
  name: "pickup_slot",
  declarationFile: "db/migrations/001_orders.sql",
  assignedToLaterTaskId: "T08",
};

describe("leaf and feature static audit", () => {
  const runner = createCompletenessGateRunner();

  it("passes a declared T02 export for T03, fails when the feature never uses it, then passes once T03 consumes it", () => {
    const leaf = runner.runLeafStaticAudit(
      makeLeaf({
        taskId: "T02",
        files: [added("src/kitchen/group.ts", group)],
        produces,
        workspaceFiles: [{ path: "src/kitchen/group.ts", content: group }],
      }),
    );
    expect(leaf.passed).toBe(true);
    expect(leaf.findings).toEqual([]);

    const unused = runner.runFeatureStaticAudit(
      makeFeature({
        taskId: "F12",
        files: [added("src/kitchen/group.ts", group)],
        produces,
        featureFiles: [{ path: "src/kitchen/group.ts", content: group }],
        allFeatureTaskIds: ["T02", "T03"],
        mergedTaskIds: ["T02", "T03"],
      }),
    );
    expect(unused.passed).toBe(false);
    expect(
      unused.findings.some(
        (finding) =>
          finding.ruleId === "check9.dead-export" && finding.message.includes("groupKitchenOrders"),
      ),
    ).toBe(true);

    const consumed = runner.runFeatureStaticAudit(
      makeFeature({
        taskId: "F12",
        files: [added("src/kitchen/print.ts", printSource)],
        produces,
        featureFiles: [
          { path: "src/kitchen/group.ts", content: group },
          { path: "src/kitchen/print.ts", content: printSource },
        ],
        entryPoints: ["src/kitchen/print.ts"],
        allFeatureTaskIds: ["T02", "T03"],
        mergedTaskIds: ["T02", "T03"],
        registry: {
          names: [],
        },
      }),
    );
    expect(consumed.passed).toBe(true);
    expect(consumed.findings).toEqual([]);
  });

  it("defers a schema field to a later task at leaf level and blocks it if the finished feature never reads it", () => {
    const registry = {
      names: [{ kind: "db_table" as const, value: "orders", feature: "F12", owner: "F12" }],
    };
    const leaf = runner.runLeafStaticAudit(
      makeLeaf({
        taskId: "T05",
        files: [added("db/migrations/001_orders.sql", migration)],
        schemaFields: [field],
        registry,
      }),
    );
    expect(leaf.passed).toBe(true);

    const unread = runner.runFeatureStaticAudit(
      makeFeature({
        files: [added("db/migrations/001_orders.sql", migration)],
        schemaFields: [field],
        featureFiles: [{ path: "db/migrations/001_orders.sql", content: migration }],
        allFeatureTaskIds: ["T05", "T08"],
        mergedTaskIds: ["T05", "T08"],
        registry,
      }),
    );
    expect(unread.passed).toBe(false);
    expect(unread.findings.some((finding) => finding.ruleId === "check9.unused-field")).toBe(true);

    const reader = `export function readSlot(row: { pickup_slot: string }) {\n  return row.pickup_slot.trim();\n}\n`;
    const read = runner.runFeatureStaticAudit(
      makeFeature({
        files: [added("src/kitchen/read.ts", reader)],
        schemaFields: [field],
        featureFiles: [
          { path: "db/migrations/001_orders.sql", content: migration },
          { path: "src/kitchen/read.ts", content: reader },
        ],
        entryPoints: ["src/kitchen/read.ts"],
        allFeatureTaskIds: ["T05", "T08"],
        mergedTaskIds: ["T05", "T08"],
        registry,
      }),
    );
    expect(read.passed).toBe(true);
  });
});
