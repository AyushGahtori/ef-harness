import { afterEach, describe, expect, it } from "vitest";
import {
  DeterministicArchConsistencyGate,
  FakeModelAdapter,
  SkeletonLockEnforcer,
  SystemArchitectureSynthesizer,
  openArchitectureStore,
  type ArchitectureStore,
} from "../../src/system-arch/index.js";
import { kitchenInput, kitchenJson } from "./kitchen-fixture.js";

describe("Kitchen system skeleton", () => {
  let store: ArchitectureStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  it("persists a lean skeleton with one owner per contract", async () => {
    store = openArchitectureStore();
    const model = new FakeModelAdapter([kitchenJson()]);
    const result = await new SystemArchitectureSynthesizer({ model, store, now: () => 1_700_000_000_000 }).synthesize(
      kitchenInput(),
    );

    expect(result.started).toBe(true);
    expect(result.accepted).toBe(true);
    expect(result.repairPasses).toBe(0);
    expect(result.wordCount).toBeGreaterThan(0);
    expect(result.wordCount).toBeLessThanOrEqual(2500);
    expect(result.diagnostic).toBeNull();
    expect(model.calls[0]?.contractId).toBe("system-architect@1");
    expect(result.owners["entity:MenuItem"]).toBe("F-Menu");
    expect(result.owners["entity:Order"]).toBe("F-Orders");
    expect(result.owners["contract:menu-read"]).toBe("F-Menu");
    expect(result.owners["event:order.locked"]).toBe("F-Orders");

    expect(store.getNode("component:api")?.fields.arch_role).toBe("module");
    expect(store.getNode("arch:topology")?.fields.arch_role).toBe("topology");
    expect(store.getNode("arch:auth")?.text).toMatch(/restaurant/);
    expect(store.getNode("seam:menu-orders")?.fields.arch_role).toBe("seam");
    expect(store.getNode("adr:postgres")?.fields.adr).toBe(true);
    expect(store.getNode("diagram:context")?.text).toMatch(/flowchart/);

    const edges = store.listEdges();
    expect(edges).toContainEqual({ src: "F-Orders", type: "depends_on", dst: "F-Menu" });
    expect(edges).toContainEqual({ src: "F-Orders", type: "implements", dst: "REQ-01" });
    expect(edges).toContainEqual({ src: "F-Menu", type: "produces_contract", dst: "contract:menu-read" });
    expect(edges).toContainEqual({ src: "F-Orders", type: "consumes_contract", dst: "contract:menu-read" });
    expect(edges).toContainEqual({ src: "adr:postgres", type: "justified_by", dst: "D-0001" });
    expect(edges).toContainEqual({ src: "adr:postgres", type: "justified_by", dst: "RF-01" });

    const names = store.listNames();
    expect(names).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "db_table", value: "orders", ownerNode: "entity:Order" }),
        expect.objectContaining({ kind: "db_column", value: "orders.total_cents" }),
        expect.objectContaining({ kind: "env_var", value: "DATABASE_URL" }),
        expect.objectContaining({ kind: "event", value: "order.locked" }),
        expect.objectContaining({ kind: "http_route", value: "/api/orders", ownerNode: "F-Orders" }),
        expect.objectContaining({ kind: "page_route", value: "/kitchen", ownerNode: "F-Orders" }),
      ]),
    );
    expect(store.relationsInFields()).toEqual([]);
    expect(store.countContradicts()).toBe(0);

    const report = await new DeterministicArchConsistencyGate().run(store);
    expect(report.blocking).toEqual([]);
    expect(report.violations).toEqual([]);

    const enforcer = new SkeletonLockEnforcer();
    enforcer.lock(store, 1_700_000_000_000);
    expect(store.getNode("entity:Order")?.fields.skeleton_locked).toBe(true);
    expect(store.getNode("contract:auth-session")?.fields.skeleton_locked).toBe(true);
    expect(store.getNode("arch:topology")?.fields.skeleton_locked).toBe(true);
    expect(store.getNode("arch:conventions")?.fields.skeleton_locked).toBe(true);
  }, 60_000);
});
