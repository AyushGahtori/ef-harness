import { afterEach, describe, expect, it } from "vitest";
import { createHarness, exportOrders, readView, seedOrders, writeView, type Harness } from "./support.js";

describe("views-import secret scan and stale base_hash", () => {
  let harness: Harness | undefined;
  afterEach(() => {
    harness?.close();
    harness = undefined;
  });

  it("refuses a markdown edit that contains a scanned secret", () => {
    harness = createHarness();
    seedOrders(harness.graph);
    exportOrders(harness);
    const token = ["AK", "IA", "ABCD", "EFGH", "IJKL", "MNOP"].join("");
    const filePath = "features/orders.md";
    writeView(
      harness,
      filePath,
      readView(harness, filePath).replace('priority: "normal"', `priority: "${token}"`),
    );
    const before = harness.graph.getNode("R17");

    const session = harness.importer.reconcile();

    expect(session.blockedBatch).toBe(true);
    expect(session.schemaErrors.some((error) => error.message.includes("secret scan"))).toBe(true);
    expect(harness.graph.getNode("R17")?.version).toBe(before?.version);
    expect(harness.graph.getNode("R17")?.fields.priority).toBe("normal");
    expect(harness.pause.isHeld(filePath)).toBe(true);
  });

  it("keeps the node when the opener base_hash does not match the manifest", () => {
    harness = createHarness();
    seedOrders(harness.graph);
    exportOrders(harness);
    const filePath = "features/orders.md";
    const original = readView(harness, filePath);
    const tampered = original.replace(/base_hash=([0-9a-f]{64})/, (_match, hash: string) => {
      const next = hash.startsWith("00000000") ? `11111111${hash.slice(8)}` : `00000000${hash.slice(8)}`;
      return `base_hash=${next}`;
    });
    expect(tampered).not.toBe(original);
    writeView(harness, filePath, tampered);

    const session = harness.importer.reconcile();

    expect(session.conflicts.some((card) => card.field === "base_hash")).toBe(true);
    expect(session.pendingFiles).toContain(filePath);
    expect(harness.graph.getNode("R17")?.text).toBe("Orders close at 11:00.");
    expect(harness.graph.listNodeVersions("R17")).toHaveLength(1);
    expect(harness.pause.isHeld(filePath)).toBe(true);
  });
});
