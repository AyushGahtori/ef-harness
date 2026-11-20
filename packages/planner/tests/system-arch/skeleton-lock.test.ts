import { describe, expect, it } from "vitest";
import { SkeletonLockEnforcer, openArchitectureStore } from "../../src/system-arch/index.js";

describe("SkeletonLockEnforcer", () => {
  it("allows Wave 2 additive changes and blocks destructive edits without a CCR", () => {
    const store = openArchitectureStore();
    try {
      store.commitChangeSet({
        author: "test",
        summary: "skeleton",
        nodes: [
          {
            id: "entity:Order",
            kind: "arch_node",
            title: "orders",
            text: "orders",
            fields: {
              feature: "F-Orders",
              basis: "derived",
              arch_role: "entity",
              owner: "F-Orders",
              table: "orders",
              columns: [{ name: "total_cents", type: "integer", nullable: false }],
            },
          },
          {
            id: "contract:auth-session",
            kind: "contract",
            title: "auth",
            text: "session",
            fields: { feature: "phase0-foundation", basis: "derived", owner: "phase0-foundation", auth_contract: true },
          },
          {
            id: "arch:topology",
            kind: "arch_node",
            title: "layout",
            text: "apps/api",
            fields: { feature: "phase0-foundation", basis: "derived", arch_role: "topology" },
          },
          {
            id: "arch:conventions",
            kind: "arch_node",
            title: "conventions",
            text: "shared errors",
            fields: { feature: "phase0-foundation", basis: "derived", arch_role: "convention" },
          },
        ],
      });
      const enforcer = new SkeletonLockEnforcer();
      const before = enforcer.evaluate(store, {
        kind: "change_type",
        table: "orders",
        column: "total_cents",
        fromType: "INTEGER",
        toType: "TEXT",
        wave: 2,
      });
      expect(before.allowed).toBe(true);
      expect(before.classification).toBe("unlocked");

      enforcer.lock(store, 1_700_000_000_000);
      expect(store.getMeta("skeleton_locked")).toBe("true");
      expect(store.getNode("entity:Order")?.fields.skeleton_locked).toBe(true);
      expect(store.getNode("contract:auth-session")?.fields.skeleton_locked).toBe(true);
      expect(store.getNode("arch:topology")?.fields.skeleton_locked).toBe(true);
      expect(store.getNode("arch:conventions")?.fields.skeleton_locked).toBe(true);

      expect(
        enforcer.evaluate(store, {
          kind: "add_column",
          table: "orders",
          column: "note",
          columnType: "text",
          nullable: true,
          hasDefault: false,
          wave: 2,
        }).allowed,
      ).toBe(true);
      expect(
        enforcer.evaluate(store, { kind: "add_table", table: "invoices", owner: "F-Billing", wave: 2 }).classification,
      ).toBe("additive");
      expect(enforcer.evaluate(store, { kind: "add_endpoint", path: "/api/orders", wave: 2 }).allowed).toBe(true);
      expect(enforcer.evaluate(store, { kind: "add_event", name: "order.refunded", wave: 2 }).allowed).toBe(true);

      const typeChange = enforcer.evaluate(store, {
        kind: "change_type",
        table: "orders",
        column: "total_cents",
        fromType: "INTEGER",
        toType: "TEXT",
        wave: 2,
      });
      expect(typeChange.allowed).toBe(false);
      expect(typeChange.classification).toBe("breaking");
      expect(typeChange.route).toBe("ccr");
      expect(typeChange.reason).toMatch(/Task-112/);
      expect(typeChange.reason).toMatch(/Task-087/);
      expect(typeChange.ccrTask).toBe("Task-112");
      expect(typeChange.revisionTask).toBe("Task-087");

      expect(
        enforcer.evaluate(store, {
          kind: "rename",
          target: "entity:Order",
          fromName: "orders",
          toName: "purchases",
          wave: 2,
        }).allowed,
      ).toBe(false);
      expect(enforcer.evaluate(store, { kind: "delete", target: "entity:Order", wave: 2 }).allowed).toBe(false);
      expect(
        enforcer.evaluate(store, {
          kind: "add_column",
          table: "orders",
          column: "required_note",
          columnType: "text",
          nullable: false,
          hasDefault: false,
          wave: 2,
        }).allowed,
      ).toBe(false);

      const approved = enforcer.evaluate(store, {
        kind: "change_type",
        table: "orders",
        column: "total_cents",
        fromType: "INTEGER",
        toType: "TEXT",
        wave: 2,
        ccrId: "CCR-09",
      });
      expect(approved.allowed).toBe(true);
      expect(approved.route).toBe("ccr");
    } finally {
      store.close();
    }
  });
});
