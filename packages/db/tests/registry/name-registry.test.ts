import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import {
  CodeNameAuditError,
  DanglingRelationError,
  DuplicateLogicalNameError,
  ForeignPrefixError,
  InvalidNameKindError,
  NAME_KINDS,
  PrefixOverlapError,
  RelationsInFieldsError,
  RelationsNormalizer,
  RouteSegmentParser,
  RouteShadowError,
  UnallocatedPrefixError,
  WildcardOverlapError,
  detectRouteShadowing,
  detectWildcardOverlap,
  openMemoryStateDb,
  relationsInFieldsSql,
  type NameRegistryService,
} from "../../src/registry/index.js";
import { createNameRegistryService } from "../../src/registry/index.js";

const open: DatabaseSync[] = [];

function setup(): { db: DatabaseSync; service: NameRegistryService } {
  const db = openMemoryStateDb();
  open.push(db);
  return { db, service: createNameRegistryService(db) };
}

afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

function count(db: DatabaseSync, sql: string, ...params: (string | number)[]): number {
  const row = db.prepare(sql).get(...params);
  const value = row?.["c"];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return 0;
}

function insertRaw(
  db: DatabaseSync,
  id: string,
  fields: Record<string, unknown>,
  status = "active",
): void {
  const rev = count(db, "SELECT COALESCE(MAX(rev), 0) AS c FROM change_sets") + 1;
  const changeSet = `RAW-${String(rev)}`;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES (?, ?, 'kernel', 'test', 0)",
    ).run(changeSet, rev);
    db.prepare(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, status, change_set, created_rev, updated_rev)
       VALUES (?, 'task', 1, ?, ?, '', ?, ?, ?, ?, ?)`,
    ).run(id, `h-${id}`, id, JSON.stringify(fields), status, changeSet, rev, rev);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

describe("NAME_KINDS", () => {
  it("lists every logical name kind from the resource registry", () => {
    expect(NAME_KINDS).toEqual([
      "http_route",
      "page_route",
      "db_table",
      "db_column",
      "db_index",
      "db_constraint",
      "env_var",
      "storage_key",
      "cookie_name",
      "cache_prefix",
      "event",
      "queue",
      "job",
      "permission",
      "feature_flag",
      "i18n_namespace",
      "cli_command",
    ]);
  });
});

describe("allocateFeaturePrefix", () => {
  it("canonicalizes route prefixes and rejects cross-feature overlap", () => {
    const { db, service } = setup();
    expect(
      service.allocateFeaturePrefix({ kind: "http_route", prefix: "/api/kitchen/", feature: "F12" }),
    ).toEqual({ kind: "http_route", prefix: "/api/kitchen", feature: "F12" });
    expect(
      service.allocateFeaturePrefix({ kind: "http_route", prefix: "/api/kitchen", feature: "F12" }),
    ).toEqual({ kind: "http_route", prefix: "/api/kitchen", feature: "F12" });
    expect(count(db, "SELECT count(*) AS c FROM name_prefixes")).toBe(1);

    expect(() =>
      service.allocateFeaturePrefix({
        kind: "http_route",
        prefix: "/api/kitchen/export/",
        feature: "F13",
      }),
    ).toThrow(PrefixOverlapError);
    expect(count(db, "SELECT count(*) AS c FROM name_prefixes")).toBe(1);

    service.allocateFeaturePrefix({ kind: "http_route", prefix: "/api/kitch", feature: "F99" });
    service.allocateFeaturePrefix({ kind: "http_route", prefix: "/api/kitchen/export", feature: "F12" });
    expect(count(db, "SELECT count(*) AS c FROM name_prefixes WHERE feature = 'F12'")).toBe(2);
  });

  it("rejects overlapping storage and env prefixes across features, including case", () => {
    const { service } = setup();
    service.allocateFeaturePrefix({ kind: "storage_key", prefix: "kitchen:", feature: "F12" });
    expect(() =>
      service.allocateFeaturePrefix({ kind: "storage_key", prefix: "kitchen:export:", feature: "F13" }),
    ).toThrow(PrefixOverlapError);
    service.allocateFeaturePrefix({ kind: "storage_key", prefix: "kitchenette:", feature: "F13" });

    service.allocateFeaturePrefix({ kind: "env_var", prefix: "stripe_", feature: "project_integrator" });
    expect(() =>
      service.allocateFeaturePrefix({ kind: "env_var", prefix: "STRIPE_WEBHOOK_", feature: "F12" }),
    ).toThrow(PrefixOverlapError);
  });
});

describe("names triggers, duplicates, prefixes, and retirement", () => {
  it("wraps the names primary key in DuplicateLogicalNameError and keeps the transaction empty", () => {
    const { db, service } = setup();
    service.allocateFeaturePrefix({ kind: "http_route", prefix: "/api/kitchen/", feature: "F12" });
    service.publishNode({
      id: "T03",
      nodeKind: "task",
      title: "Totals",
      feature: "F12",
      names: [{ kind: "http_route", value: "/api/Kitchen/totals" }],
    });
    expect(db.prepare("SELECT value FROM names WHERE owner_node = 'T03'").get()?.["value"]).toBe(
      "/api/kitchen/totals",
    );

    let caught: unknown;
    try {
      service.publishNode({
        id: "T04",
        nodeKind: "task",
        title: "Again",
        feature: "F12",
        names: [{ kind: "http_route", value: "/API/kitchen/totals/" }],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DuplicateLogicalNameError);
    if (caught instanceof DuplicateLogicalNameError) {
      expect(caught.kind).toBe("http_route");
      expect(caught.value).toBe("/api/kitchen/totals");
      expect(caught.existingOwner).toBe("T03");
      expect(caught.attemptedOwner).toBe("T04");
      expect(caught.cause).toBeInstanceOf(Error);
      expect((caught.cause as Error).message).toContain(
        "UNIQUE constraint failed: names.kind, names.value",
      );
    }
    expect(count(db, "SELECT count(*) AS c FROM nodes WHERE id = 'T04'")).toBe(0);
    expect(count(db, "SELECT count(*) AS c FROM names")).toBe(1);
  });

  it("rejects a legacy differently cased route before the primary key can miss it", () => {
    const { db, service } = setup();
    service.allocateFeaturePrefix({ kind: "http_route", prefix: "/api/kitchen", feature: "F12" });
    insertRaw(db, "T03", {
      feature: "F12",
      names: [{ kind: "http_route", value: "/api/Kitchen/totals" }],
    });
    expect(() =>
      service.validatePublishedNames({
        id: "T04",
        nodeKind: "task",
        title: "Again",
        feature: "F12",
        names: [{ kind: "http_route", value: "/api/kitchen/totals" }],
      }),
    ).toThrow(DuplicateLogicalNameError);
    expect(count(db, "SELECT count(*) AS c FROM nodes WHERE id = 'T04'")).toBe(0);
  });

  it("rejects foreign prefixes and names outside the feature prefix before commit", () => {
    const { db, service } = setup();
    service.allocateFeaturePrefix({ kind: "http_route", prefix: "/api/kitchen/", feature: "F12" });
    service.allocateFeaturePrefix({ kind: "env_var", prefix: "STRIPE_", feature: "project_integrator" });
    service.publishNode({
      id: "INT-1",
      nodeKind: "task",
      title: "Integrator",
      feature: "project_integrator",
      names: [{ kind: "env_var", value: "DATABASE_URL" }],
    });

    expect(() =>
      service.validateNamePrefixOwnership({
        feature: "F12",
        names: [{ kind: "http_route", value: "/api/billing/totals" }],
      }),
    ).toThrow(UnallocatedPrefixError);
    expect(() =>
      service.publishNode({
        id: "T12",
        nodeKind: "task",
        title: "Outside",
        feature: "F12",
        names: [{ kind: "http_route", value: "/api/billing/totals" }],
      }),
    ).toThrow(UnallocatedPrefixError);
    expect(() =>
      service.publishNode({
        id: "T13",
        nodeKind: "task",
        title: "Stolen env",
        feature: "F12",
        names: [{ kind: "env_var", value: "STRIPE_SECRET" }],
      }),
    ).toThrow(ForeignPrefixError);
    expect(() =>
      service.publishNode({
        id: "INT-2",
        nodeKind: "task",
        title: "Stolen route",
        feature: "project_integrator",
        names: [{ kind: "http_route", value: "/api/kitchen/totals" }],
      }),
    ).toThrow(ForeignPrefixError);
    expect(count(db, "SELECT count(*) AS c FROM nodes")).toBe(1);
    service.allocateFeaturePrefix({ kind: "db_column", prefix: "orders.", feature: "F12" });
    service.publishNode({
      id: "T03",
      nodeKind: "task",
      title: "Totals",
      feature: "F12",
      names: [
        { kind: "http_route", value: "/api/kitchen/totals" },
        { kind: "db_column", value: "Orders.Pickup_Slot" },
      ],
    });
    expect(db.prepare("SELECT value FROM names WHERE kind = 'db_column'").get()?.["value"]).toBe(
      "orders.pickup_slot",
    );
  });

  it("requires a column prefix when the feature is not the integrator", () => {
    const { service } = setup();
    expect(() =>
      service.publishNode({
        id: "T03",
        nodeKind: "task",
        title: "Column",
        feature: "F12",
        names: [{ kind: "db_column", value: "orders.pickup_slot" }],
      }),
    ).toThrow(UnallocatedPrefixError);
    service.allocateFeaturePrefix({ kind: "db_column", prefix: "orders.", feature: "F12" });
    service.publishNode({
      id: "T03",
      nodeKind: "task",
      title: "Column",
      feature: "F12",
      names: [{ kind: "db_column", value: "Orders.Pickup_Slot" }],
    });
    expect(() =>
      service.publishNode({
        id: "T04",
        nodeKind: "task",
        title: "Column again",
        feature: "F13",
        names: [{ kind: "db_column", value: "ORDERS.PICKUP_SLOT" }],
      }),
    ).toThrow(ForeignPrefixError);
  });

  it("releases names through nodes_au on retire so a forward node can reuse the route", () => {
    const { db, service } = setup();
    service.allocateFeaturePrefix({ kind: "http_route", prefix: "/api/kitchen", feature: "F12" });
    service.allocateFeaturePrefix({ kind: "page_route", prefix: "/kitchen", feature: "F12" });
    service.publishNode({
      id: "T03",
      nodeKind: "task",
      title: "Totals",
      feature: "F12",
      names: [
        { kind: "http_route", value: "/api/kitchen/totals" },
        { kind: "page_route", value: "/kitchen/" },
      ],
    });
    expect(count(db, "SELECT count(*) AS c FROM names WHERE owner_node = 'T03'")).toBe(2);
    expect(service.retireNode("T03")).toEqual({ id: "T03", releasedNames: 2 });
    expect(db.prepare("SELECT status FROM nodes WHERE id = 'T03'").get()?.["status"]).toBe("retired");
    expect(count(db, "SELECT count(*) AS c FROM names")).toBe(0);

    service.publishNode({
      id: "T05",
      nodeKind: "task",
      title: "Forward",
      feature: "F12",
      names: [{ kind: "http_route", value: "/api/kitchen/totals" }],
    });
    expect(db.prepare("SELECT owner_node FROM names WHERE value = '/api/kitchen/totals'").get()?.["owner_node"]).toBe(
      "T05",
    );
  });

  it("replaces names on a new version so the previous route can be claimed", () => {
    const { db, service } = setup();
    service.allocateFeaturePrefix({ kind: "http_route", prefix: "/api/kitchen", feature: "F12" });
    service.publishNode({
      id: "T03",
      nodeKind: "task",
      title: "Totals",
      feature: "F12",
      names: [{ kind: "http_route", value: "/api/kitchen/a" }],
    });
    service.publishNode({
      id: "T03",
      nodeKind: "task",
      title: "Totals",
      feature: "F12",
      names: [{ kind: "http_route", value: "/api/kitchen/b" }],
    });
    expect(count(db, "SELECT count(*) AS c FROM names WHERE value = '/api/kitchen/a'")).toBe(0);
    service.publishNode({
      id: "T04",
      nodeKind: "task",
      title: "Reuse",
      feature: "F12",
      names: [{ kind: "http_route", value: "/api/kitchen/a" }],
    });
    expect(count(db, "SELECT count(*) AS c FROM names WHERE owner_node = 'T04'")).toBe(1);
  });

  it("rejects an unknown name kind and a duplicate inside one node", () => {
    const { service } = setup();
    service.allocateFeaturePrefix({ kind: "storage_key", prefix: "kitchen:", feature: "F12" });
    expect(() =>
      service.publishNode({
        id: "T03",
        nodeKind: "task",
        title: "Bad kind",
        feature: "F12",
        names: [{ kind: "route", value: "/kitchen" }],
      }),
    ).toThrow(InvalidNameKindError);
    expect(() =>
      service.publishNode({
        id: "T03",
        nodeKind: "task",
        title: "Twice",
        feature: "F12",
        names: [
          { kind: "storage_key", value: "kitchen:lastView" },
          { kind: "storage_key", value: "kitchen:lastView" },
        ],
      }),
    ).toThrow(DuplicateLogicalNameError);
  });
});

describe("route shadowing", () => {
  const parser = new RouteSegmentParser();

  it("normalizes Express, Next, and OpenAPI params into one segment shape", () => {
    expect(parser.parse("/api/orders/:id").segments.at(-1)).toEqual({
      type: "param",
      name: "id",
      optional: false,
    });
    expect(parser.parse("/api/orders/[id]").canonical).toBe("/api/orders/:id");
    expect(parser.parse("/api/orders/{id}").canonical).toBe("/api/orders/:id");
    expect(parser.parse("/api/[...all]").segments.at(-1)).toEqual({
      type: "catchall",
      name: "all",
      optional: false,
    });
    expect(parser.parse("/api/orders/*").segments.at(-1)).toEqual({ type: "wildcard" });
    expect(parser.canonicalize("/kitchen/")).toBe("/kitchen");
    expect(parser.canonicalize("/api/Kitchen")).toBe("/api/kitchen");
  });

  it("catches equivalent params, catch-all shadows, and case or slash collisions", () => {
    const equivalent = detectRouteShadowing([
      { kind: "http_route", value: "/api/orders/[id]", feature: "F12", ownerNode: "T03" },
      { kind: "http_route", value: "/api/orders/:orderId", feature: "F13", ownerNode: "T04" },
    ]);
    expect(equivalent).toHaveLength(1);
    expect(equivalent[0]?.code).toBe("equivalent");
    expect([equivalent[0]?.left.value, equivalent[0]?.right.value].sort()).toEqual([
      "/api/orders/:orderId",
      "/api/orders/[id]",
    ]);

    const syntax = detectRouteShadowing([
      { kind: "http_route", value: "/api/orders/{id}", feature: "F12", ownerNode: "A" },
      { kind: "http_route", value: "/api/orders/:id", feature: "F12", ownerNode: "B" },
    ]);
    expect(syntax.map((conflict) => conflict.code)).toEqual(["equivalent"]);

    const catchall = detectRouteShadowing([
      { kind: "http_route", value: "/api/[...all]", feature: "F12", ownerNode: "A" },
      { kind: "http_route", value: "/api/kitchen/export", feature: "F13", ownerNode: "B" },
    ]);
    expect(catchall).toHaveLength(1);
    expect(catchall[0]?.code).toBe("shadow");
    expect(catchall[0]?.message).toContain("/api/[...all]");
    expect(catchall[0]?.message).toContain("/api/kitchen/export");

    const dynamic = detectRouteShadowing([
      { kind: "http_route", value: "/api/:section/export", feature: "F12", ownerNode: "A" },
      { kind: "http_route", value: "/api/kitchen/export", feature: "F13", ownerNode: "B" },
    ]);
    expect(dynamic.map((conflict) => conflict.code)).toEqual(["shadow"]);

    const slash = detectRouteShadowing([
      { kind: "page_route", value: "/kitchen/", feature: "F12", ownerNode: "A" },
      { kind: "page_route", value: "/kitchen", feature: "F12", ownerNode: "B" },
    ]);
    expect(slash.map((conflict) => conflict.code)).toEqual(["case_or_slash"]);

    const casing = detectRouteShadowing([
      { kind: "http_route", value: "/api/Kitchen", feature: "F12", ownerNode: "A" },
      { kind: "http_route", value: "/api/kitchen", feature: "F13", ownerNode: "B" },
    ]);
    expect(casing.map((conflict) => conflict.code)).toEqual(["case_or_slash"]);
  });

  it("lets the same feature order a static route ahead of a dynamic one, and still rejects cross-feature catch-alls", () => {
    expect(
      detectRouteShadowing([
        {
          kind: "http_route",
          value: "/api/orders/export",
          feature: "F12",
          ownerNode: "T03",
          explicitOrder: true,
        },
        { kind: "http_route", value: "/api/orders/:id", feature: "F12", ownerNode: "T04" },
      ]),
    ).toEqual([]);

    expect(
      detectRouteShadowing([
        { kind: "http_route", value: "/api/orders/export", feature: "F12", ownerNode: "T03" },
        { kind: "http_route", value: "/api/orders/:id", feature: "F12", ownerNode: "T04" },
      ]),
    ).toHaveLength(1);

    expect(
      detectRouteShadowing([
        {
          kind: "http_route",
          value: "/api/[...all]",
          feature: "F12",
          ownerNode: "A",
          explicitOrder: true,
        },
        { kind: "http_route", value: "/api/kitchen/export", feature: "F13", ownerNode: "B" },
      ]),
    ).toHaveLength(1);

    expect(
      detectRouteShadowing([
        { kind: "http_route", value: "/kitchen", feature: "F12", ownerNode: "A" },
        { kind: "page_route", value: "/kitchen", feature: "F13", ownerNode: "B" },
      ]),
    ).toEqual([]);
  });

  it("enforces shadowing when publishing, including explicit same-feature order", () => {
    const { service } = setup();
    service.allocateFeaturePrefix({ kind: "http_route", prefix: "/api/orders", feature: "F12" });
    service.publishNode({
      id: "T03",
      nodeKind: "task",
      title: "Order",
      feature: "F12",
      names: [{ kind: "http_route", value: "/api/orders/:orderId" }],
    });
    expect(() =>
      service.publishNode({
        id: "T04",
        nodeKind: "task",
        title: "Bracket",
        feature: "F12",
        names: [{ kind: "http_route", value: "/api/orders/[id]" }],
      }),
    ).toThrow(RouteShadowError);

    const ordered = setup();
    ordered.service.allocateFeaturePrefix({ kind: "http_route", prefix: "/api/orders", feature: "F12" });
    ordered.service.publishNode({
      id: "T05",
      nodeKind: "task",
      title: "Ordered",
      feature: "F12",
      names: [
        { kind: "http_route", value: "/api/orders/export", explicitOrder: true },
        { kind: "http_route", value: "/api/orders/:id" },
      ],
    });
    expect(ordered.service.detectRouteShadowing()).toEqual([]);

    const unordered = setup();
    unordered.service.allocateFeaturePrefix({ kind: "http_route", prefix: "/api/orders", feature: "F12" });
    expect(() =>
      unordered.service.publishNode({
        id: "T06",
        nodeKind: "task",
        title: "Unordered",
        feature: "F12",
        fields: {
          names: [
            { kind: "http_route", value: "/api/orders/export" },
            { kind: "http_route", value: "/api/orders/:id" },
          ],
        },
      }),
    ).toThrow(RouteShadowError);
  });

  it("rejects a catch-all that shadows another feature even when that route bypassed prefix allocation", () => {
    const { db, service } = setup();
    service.allocateFeaturePrefix({ kind: "http_route", prefix: "/api", feature: "F12" });
    insertRaw(db, "T13", {
      feature: "F13",
      names: [{ kind: "http_route", value: "/api/kitchen/export" }],
    });
    let caught: unknown;
    try {
      service.publishNode({
        id: "T12",
        nodeKind: "task",
        title: "Catch all",
        feature: "F12",
        names: [{ kind: "http_route", value: "/api/[...all]", explicitOrder: true }],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RouteShadowError);
    if (caught instanceof RouteShadowError) {
      expect(caught.conflicts.some((conflict) => conflict.code === "shadow")).toBe(true);
    }
    expect(count(db, "SELECT count(*) AS c FROM nodes WHERE id = 'T12'")).toBe(0);
  });
});

describe("validateNamePrefixOwnership", () => {
  it("accepts names inside the feature prefix and shared integrator names", () => {
    const { service } = setup();
    service.allocateFeaturePrefix({ kind: "storage_key", prefix: "kitchen:", feature: "F12" });
    service.validateNamePrefixOwnership({
      feature: "F12",
      names: [{ kind: "storage_key", value: "kitchen:lastView" }],
    });
    service.validateNamePrefixOwnership({
      feature: "project_integrator",
      names: [{ kind: "env_var", value: "DATABASE_URL" }],
    });
    service.validateNamePrefixOwnership({
      feature: "shared",
      names: [{ kind: "env_var", value: "SHARED_FLAG" }],
    });
    expect(() =>
      service.validateNamePrefixOwnership({
        feature: "F12",
        names: [{ kind: "storage_key", value: "billing:last" }],
      }),
    ).toThrow(UnallocatedPrefixError);
    expect(() =>
      service.validateNamePrefixOwnership({
        feature: "F13",
        names: [{ kind: "storage_key", value: "kitchen:lastView" }],
      }),
    ).toThrow(ForeignPrefixError);
  });
});

describe("wildcard overlap", () => {
  it("flags cache, permission, and i18n patterns across features and ignores the same feature", () => {
    expect(
      detectWildcardOverlap([
        { kind: "cache_prefix", value: "kitchen:*", feature: "F12", ownerNode: "A" },
        { kind: "cache_prefix", value: "kitchen:lastView", feature: "F13", ownerNode: "B" },
      ]),
    ).toHaveLength(1);
    expect(
      detectWildcardOverlap([
        { kind: "permission", value: "orders.*", feature: "F12", ownerNode: "A" },
        { kind: "permission", value: "orders.edit", feature: "F13", ownerNode: "B" },
      ]),
    ).toHaveLength(1);
    expect(
      detectWildcardOverlap([
        { kind: "i18n_namespace", value: "app.*", feature: "F12", ownerNode: "A" },
        { kind: "i18n_namespace", value: "app.nav.title", feature: "F13", ownerNode: "B" },
      ]),
    ).toHaveLength(1);
    expect(
      detectWildcardOverlap([
        { kind: "permission", value: "orders.*", feature: "F12", ownerNode: "A" },
        { kind: "permission", value: "orders.edit", feature: "F12", ownerNode: "B" },
      ]),
    ).toEqual([]);
    expect(
      detectWildcardOverlap([
        { kind: "permission", value: "orders.*", feature: "F12", ownerNode: "A" },
        { kind: "permission", value: "billing.edit", feature: "F13", ownerNode: "B" },
      ]),
    ).toEqual([]);
  });

  it("rejects a glob that escapes a disjoint prefix into another feature's name", () => {
    const { service } = setup();
    service.allocateFeaturePrefix({ kind: "cache_prefix", prefix: "kit", feature: "F12" });
    service.allocateFeaturePrefix({ kind: "cache_prefix", prefix: "kitchen", feature: "F13" });
    service.publishNode({
      id: "T13",
      nodeKind: "task",
      title: "Kitchen cache",
      feature: "F13",
      names: [{ kind: "cache_prefix", value: "kitchen" }],
    });
    expect(() =>
      service.publishNode({
        id: "T12",
        nodeKind: "task",
        title: "Glob",
        feature: "F12",
        names: [{ kind: "cache_prefix", value: "kit*en" }],
      }),
    ).toThrow(WildcardOverlapError);
  });
});

describe("auditCodeNamesAgainstRegistry", () => {
  it("flags unregistered env reads and foreign routes, and allows owned and shared names", () => {
    const { service } = setup();
    service.allocateFeaturePrefix({ kind: "http_route", prefix: "/api/kitchen", feature: "F12" });
    service.allocateFeaturePrefix({ kind: "http_route", prefix: "/api/billing", feature: "F13" });
    service.allocateFeaturePrefix({ kind: "env_var", prefix: "STRIPE_", feature: "F12" });
    service.publishNode({
      id: "T03",
      nodeKind: "task",
      title: "Kitchen",
      feature: "F12",
      names: [
        { kind: "http_route", value: "/api/kitchen/totals" },
        { kind: "env_var", value: "stripe_key" },
      ],
    });
    service.publishNode({
      id: "T13",
      nodeKind: "task",
      title: "Billing",
      feature: "F13",
      names: [{ kind: "http_route", value: "/api/billing/export" }],
    });
    service.publishNode({
      id: "INT-1",
      nodeKind: "task",
      title: "Shared",
      feature: "project_integrator",
      names: [{ kind: "env_var", value: "DATABASE_URL" }],
    });
    service.publishNode({
      id: "SHARED-1",
      nodeKind: "task",
      title: "Shared owner",
      feature: "shared",
      names: [{ kind: "env_var", value: "SHARED_FLAG" }],
    });

    expect(
      service.auditCodeNamesAgainstRegistry({
        feature: "F12",
        names: [
          { kind: "http_route", value: "/api/kitchen/totals", access: "read" },
          { kind: "env_var", value: "STRIPE_key", access: "read" },
          { kind: "env_var", value: "DATABASE_URL", access: "read" },
          { kind: "env_var", value: "SHARED_FLAG", access: "read" },
        ],
      }),
    ).toEqual({ ok: true, feature: "F12", checked: 4 });

    let caught: unknown;
    try {
      service.auditCodeNamesAgainstRegistry({
        feature: "F12",
        names: [
          { kind: "env_var", value: "SECRET_X", access: "read", source: "process.env.SECRET_X" },
          { kind: "env_var", value: "SECRET_X", access: "define", source: "process.env.SECRET_X" },
          { kind: "http_route", value: "/api/billing/export", access: "read" },
          { kind: "env_var", value: "DATABASE_URL", access: "write" },
          { kind: "db_index", value: "idx_orders_day", access: "read" },
          { kind: "storage_key", value: "kitchen:lastView", access: "read" },
          { kind: "cookie_name", value: "kitchen_session", access: "read" },
        ],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CodeNameAuditError);
    if (caught instanceof CodeNameAuditError) {
      expect(caught.failures.map((failure) => failure.code)).toEqual([
        "unregistered",
        "unregistered",
        "foreign_owned",
        "foreign_owned",
        "unregistered",
        "unregistered",
        "unregistered",
      ]);
      expect(caught.failures[0]?.source).toBe("process.env.SECRET_X");
      expect(caught.message).toContain("process.env.SECRET_X");
      expect(caught.failures[2]?.ownerFeature).toBe("F13");
      expect(caught.failures[3]?.ownerFeature).toBe("project_integrator");
    }
  });
});

describe("relations_in_fields", () => {
  it("loads the canonical query and flags stray relation fields", () => {
    const { db, service } = setup();
    expect(relationsInFieldsSql()).toContain("fields ->> '$.depends_on'");
    expect(relationsInFieldsSql()).toContain("fields ->> '$.implements'");
    expect(relationsInFieldsSql()).toContain("fields ->> '$.verifies'");
    expect(relationsInFieldsSql()).toContain("fields ->> '$.consumes'");
    service.publishNode({ id: "T03", nodeKind: "task", title: "Dep", feature: "F12" });
    insertRaw(db, "T80", { feature: "F12", depends_on: ["T03"] });
    expect(() => service.assertNoRelationsInFields()).toThrow(RelationsInFieldsError);
    try {
      service.assertNoRelationsInFields();
    } catch (error) {
      expect(error).toBeInstanceOf(RelationsInFieldsError);
      if (error instanceof RelationsInFieldsError) expect(error.nodeIds).toContain("T80");
    }
    expect(() =>
      service.publishNode({ id: "T81", nodeKind: "task", title: "Clean", feature: "F12" }),
    ).toThrow(RelationsInFieldsError);
    expect(count(db, "SELECT count(*) AS c FROM nodes WHERE id = 'T81'")).toBe(0);
  });

  it("strips relation lists into edges without mutating the submitted object", () => {
    const fields = Object.freeze({
      feature: "F12",
      names: [{ kind: "http_route", value: "/api/kitchen/totals" }],
      depends_on: ["T03"],
      implements: [{ id: "SI-212" }],
      verifies: "SI-212",
      consumes: ["C-014"],
      keep: true,
    });
    const normalized = new RelationsNormalizer().normalize(fields);
    expect(fields).toHaveProperty("depends_on");
    expect(normalized.fields).not.toHaveProperty("depends_on");
    expect(normalized.fields).not.toHaveProperty("implements");
    expect(normalized.fields).not.toHaveProperty("verifies");
    expect(normalized.fields).not.toHaveProperty("consumes");
    expect(normalized.fields["keep"]).toBe(true);
    expect(normalized.edges).toEqual([
      { field: "depends_on", type: "depends_on", dst: "T03" },
      { field: "implements", type: "implements", dst: "SI-212" },
      { field: "verifies", type: "verifies", dst: "SI-212" },
      { field: "consumes", type: "consumes_contract", dst: "C-014" },
    ]);
  });

  it("publishes names and relations together, then repairs a stray node", () => {
    const { db, service } = setup();
    service.allocateFeaturePrefix({ kind: "http_route", prefix: "/api/kitchen", feature: "F12" });
    service.publishNode({ id: "T03", nodeKind: "task", title: "Dep", feature: "F12" });
    service.publishNode({ id: "SI-212", nodeKind: "spec_item", title: "Spec", feature: "F12" });
    service.publishNode({ id: "C-014", nodeKind: "contract", title: "Contract", feature: "F12" });
    const published = service.publishNode({
      id: "T07",
      nodeKind: "task",
      title: "Page",
      feature: "F12",
      fields: {
        names: [{ kind: "http_route", value: "/api/kitchen/totals" }],
        depends_on: ["T03"],
        implements: ["SI-212"],
        verifies: ["SI-212"],
        consumes: ["C-014"],
      },
    });
    expect(published.edges.map((edge) => edge.type)).toEqual([
      "depends_on",
      "implements",
      "verifies",
      "consumes_contract",
    ]);
    expect(service.assertNoRelationsInFields()).toBeUndefined();
    const stored = db.prepare("SELECT fields FROM nodes WHERE id = 'T07'").get()?.["fields"];
    expect(typeof stored).toBe("string");
    const parsed = JSON.parse(String(stored)) as Record<string, unknown>;
    expect(parsed["depends_on"]).toBeUndefined();
    expect(parsed["names"]).toEqual([{ kind: "http_route", value: "/api/kitchen/totals" }]);
    expect(count(db, "SELECT count(*) AS c FROM edges WHERE src = 'T07' AND valid_to_rev IS NULL")).toBe(4);

    insertRaw(db, "T80", { feature: "F12", depends_on: ["T03"], implements: ["SI-212"] });
    service.publishNode({
      id: "T80",
      nodeKind: "task",
      title: "Repaired",
      feature: "F12",
      fields: { depends_on: ["T03"], implements: ["SI-212"] },
    });
    expect(service.assertNoRelationsInFields()).toBeUndefined();
    expect(count(db, "SELECT count(*) AS c FROM edges WHERE src = 'T80' AND type = 'depends_on'")).toBe(1);
  });

  it("rejects a relation whose target node does not exist", () => {
    const { db, service } = setup();
    expect(() =>
      service.publishNode({
        id: "T07",
        nodeKind: "task",
        title: "Dangling",
        feature: "F12",
        fields: { depends_on: ["MISSING"] },
      }),
    ).toThrow(DanglingRelationError);
    expect(count(db, "SELECT count(*) AS c FROM nodes WHERE id = 'T07'")).toBe(0);
  });
});

describe("empty and omitted fields.names", () => {
  it("lets the trigger accept omitted and empty names, and the service defaults null", () => {
    const { db, service } = setup();
    expect(() => insertRaw(db, "T-OMIT", { feature: "F12" })).not.toThrow();
    expect(() => insertRaw(db, "T-EMPTY", { feature: "F12", names: [] })).not.toThrow();
    expect(count(db, "SELECT count(*) AS c FROM names")).toBe(0);

    expect(() => insertRaw(db, "T-NULL", { feature: "F12", names: null })).toThrow(/NOT NULL/i);
    expect(count(db, "SELECT count(*) AS c FROM nodes WHERE id = 'T-NULL'")).toBe(0);

    service.publishNode({
      id: "T-SERVICE-NULL",
      nodeKind: "task",
      title: "Null names",
      feature: "F12",
      fields: { names: null },
    });
    expect(count(db, "SELECT count(*) AS c FROM names WHERE owner_node = 'T-SERVICE-NULL'")).toBe(0);
    const fields = String(db.prepare("SELECT fields FROM nodes WHERE id = 'T-SERVICE-NULL'").get()?.["fields"]);
    expect(JSON.parse(fields)).toEqual({ feature: "F12" });
  });
});
