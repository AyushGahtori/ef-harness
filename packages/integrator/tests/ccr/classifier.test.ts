import { describe, expect, it } from "vitest";

import { DeterministicSchemaDiffClassifier } from "../../src/ccr/classifier.js";
import type { DiffOpKind, SchemaBundle } from "../../src/ccr/types.js";

const classifier = new DeterministicSchemaDiffClassifier();

interface Case {
  readonly name: string;
  readonly before: SchemaBundle;
  readonly after: SchemaBundle;
  readonly expected: "ADDITIVE" | "BREAKING";
  readonly kind: DiffOpKind;
  readonly claimAdditive?: boolean;
}

const orders = (body: string) => `CREATE TABLE orders ( ${body} );`;
const table = (name: string, body: string) => `CREATE TABLE ${name} ( ${body} );`;

function api(mutate: (doc: Record<string, unknown>) => void): string {
  const doc: Record<string, unknown> = {
    openapi: "3.0.3",
    "x-tenant": "org",
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
      schemas: {
        Order: {
          type: "object",
          properties: { id: { type: "string" }, note: { type: "string" } },
          required: ["id"],
        },
        Error: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
        OrderStatus: { type: "string", enum: ["open"], "x-output-only": true },
        IntakeStatus: { type: "string", enum: ["new", "done"] },
      },
    },
    paths: {
      "/api/orders": {
        get: {
          security: [{ bearer: [] }],
          responses: {
            "200": { description: "ok" },
            "400": { description: "bad" },
          },
        },
      },
    },
  };
  mutate(doc);
  return JSON.stringify(doc);
}

const baseApi = api(() => undefined);

function schema(properties: Record<string, unknown>, required: string[] = []): string {
  return JSON.stringify({ title: "Order", type: "object", properties, required });
}

const cases: Case[] = [
  {
    name: "sql adds a nullable column",
    before: { sql: orders("id INTEGER PRIMARY KEY") },
    after: { sql: orders("id INTEGER PRIMARY KEY, dietary_note TEXT NULL") },
    expected: "ADDITIVE",
    kind: "add_nullable_column",
  },
  {
    name: "sql adds a defaulted column",
    before: { sql: orders("id INTEGER PRIMARY KEY") },
    after: { sql: orders("id INTEGER PRIMARY KEY, priority INTEGER NOT NULL DEFAULT 0") },
    expected: "ADDITIVE",
    kind: "add_defaulted_column",
  },
  {
    name: "sql adds a table",
    before: { sql: orders("id INTEGER PRIMARY KEY") },
    after: { sql: `${orders("id INTEGER PRIMARY KEY")} ${table("receipts", "id INTEGER PRIMARY KEY")}` },
    expected: "ADDITIVE",
    kind: "add_table",
  },
  {
    name: "sql drops a column",
    before: { sql: orders("id INTEGER PRIMARY KEY, note TEXT NULL") },
    after: { sql: orders("id INTEGER PRIMARY KEY") },
    expected: "BREAKING",
    kind: "drop_column",
    claimAdditive: true,
  },
  {
    name: "sql drops a table",
    before: { sql: `${orders("id INTEGER PRIMARY KEY")} ${table("receipts", "id INTEGER PRIMARY KEY")}` },
    after: { sql: orders("id INTEGER PRIMARY KEY") },
    expected: "BREAKING",
    kind: "drop_table",
    claimAdditive: true,
  },
  {
    name: "sql renames a column",
    before: { sql: orders("price_cents INTEGER NOT NULL") },
    after: { sql: orders("price TEXT") },
    expected: "BREAKING",
    kind: "rename_column",
    claimAdditive: true,
  },
  {
    name: "sql renames a table",
    before: { sql: table("orders", "id INTEGER PRIMARY KEY") },
    after: { sql: table("purchases", "id INTEGER PRIMARY KEY") },
    expected: "BREAKING",
    kind: "rename_table",
    claimAdditive: true,
  },
  {
    name: "sql changes integer to text",
    before: { sql: orders("price_cents INTEGER NOT NULL") },
    after: { sql: orders("price_cents TEXT") },
    expected: "BREAKING",
    kind: "type_change",
    claimAdditive: true,
  },
  {
    name: "sql narrows varchar",
    before: { sql: orders("label VARCHAR(40) NULL") },
    after: { sql: orders("label VARCHAR(10) NULL") },
    expected: "BREAKING",
    kind: "narrow_type",
    claimAdditive: true,
  },
  {
    name: "sql makes a nullable column required",
    before: { sql: orders("note TEXT NULL") },
    after: { sql: orders("note TEXT NOT NULL") },
    expected: "BREAKING",
    kind: "add_required",
    claimAdditive: true,
  },
  {
    name: "sql adds a required column without a default",
    before: { sql: orders("id INTEGER PRIMARY KEY") },
    after: { sql: orders("id INTEGER PRIMARY KEY, sku TEXT NOT NULL") },
    expected: "BREAKING",
    kind: "add_required",
    claimAdditive: true,
  },
  {
    name: "sql tightens a check constraint",
    before: { sql: orders("qty INTEGER NULL") },
    after: { sql: orders("qty INTEGER NULL CHECK (qty > 0)") },
    expected: "BREAKING",
    kind: "tighten_constraint",
    claimAdditive: true,
  },
  {
    name: "sql widens integer to bigint",
    before: { sql: orders("qty INTEGER NULL") },
    after: { sql: orders("qty BIGINT NULL") },
    expected: "ADDITIVE",
    kind: "loosen_constraint",
  },
  {
    name: "openapi adds an optional response field",
    before: { openapi: baseApi },
    after: {
      openapi: api((doc) => {
        const schemas = componentSchemas(doc);
        const order = schemas.Order as Record<string, unknown>;
        const properties = order.properties as Record<string, unknown>;
        properties.dietary_note = { type: "string" };
      }),
    },
    expected: "ADDITIVE",
    kind: "add_optional_field",
  },
  {
    name: "openapi adds an endpoint",
    before: { openapi: baseApi },
    after: {
      openapi: api((doc) => {
        const paths = doc.paths as Record<string, unknown>;
        paths["/api/orders/export"] = { post: { responses: { "202": { description: "accepted" } } } };
      }),
    },
    expected: "ADDITIVE",
    kind: "add_endpoint",
  },
  {
    name: "openapi adds an output enum value",
    before: { openapi: baseApi },
    after: {
      openapi: api((doc) => {
        const schemas = componentSchemas(doc);
        schemas.OrderStatus = { type: "string", enum: ["open", "closed"], "x-output-only": true };
      }),
    },
    expected: "ADDITIVE",
    kind: "add_output_enum_value",
  },
  {
    name: "openapi drops an endpoint",
    before: { openapi: baseApi },
    after: {
      openapi: api((doc) => {
        doc.paths = {};
      }),
    },
    expected: "BREAKING",
    kind: "drop_endpoint",
    claimAdditive: true,
  },
  {
    name: "openapi drops a field",
    before: { openapi: baseApi },
    after: {
      openapi: api((doc) => {
        const schemas = componentSchemas(doc);
        const order = schemas.Order as Record<string, unknown>;
        order.properties = { id: { type: "string" } };
      }),
    },
    expected: "BREAKING",
    kind: "drop_field",
    claimAdditive: true,
  },
  {
    name: "openapi makes an optional request field required",
    before: { openapi: withRequest([]) },
    after: { openapi: withRequest(["note"]) },
    expected: "BREAKING",
    kind: "add_required",
    claimAdditive: true,
  },
  {
    name: "openapi changes a success status",
    before: { openapi: baseApi },
    after: {
      openapi: api((doc) => {
        const paths = doc.paths as Record<string, unknown>;
        const ordersPath = paths["/api/orders"] as Record<string, unknown>;
        const get = ordersPath.get as Record<string, unknown>;
        get.responses = { "201": { description: "created" }, "400": { description: "bad" } };
      }),
    },
    expected: "BREAKING",
    kind: "status_change",
    claimAdditive: true,
  },
  {
    name: "openapi changes the error envelope",
    before: { openapi: baseApi },
    after: {
      openapi: api((doc) => {
        const schemas = componentSchemas(doc);
        schemas.Error = {
          type: "object",
          properties: { code: { type: "string" }, detail: { type: "object" } },
          required: ["code", "detail"],
        };
      }),
    },
    expected: "BREAKING",
    kind: "error_envelope_change",
    claimAdditive: true,
  },
  {
    name: "openapi changes auth",
    before: { openapi: baseApi },
    after: {
      openapi: api((doc) => {
        const components = doc.components as Record<string, unknown>;
        components.securitySchemes = { basic: { type: "http", scheme: "basic" } };
      }),
    },
    expected: "BREAKING",
    kind: "auth_change",
    claimAdditive: true,
  },
  {
    name: "openapi changes tenant semantics",
    before: { openapi: baseApi },
    after: {
      openapi: api((doc) => {
        doc["x-tenant"] = "account";
      }),
    },
    expected: "BREAKING",
    kind: "tenant_change",
    claimAdditive: true,
  },
  {
    name: "openapi removes an enum value",
    before: { openapi: baseApi },
    after: {
      openapi: api((doc) => {
        const schemas = componentSchemas(doc);
        schemas.IntakeStatus = { type: "string", enum: ["new"] };
      }),
    },
    expected: "BREAKING",
    kind: "remove_enum_value",
    claimAdditive: true,
  },
  {
    name: "openapi adds an input enum value",
    before: { openapi: baseApi },
    after: {
      openapi: api((doc) => {
        const schemas = componentSchemas(doc);
        schemas.IntakeStatus = { type: "string", enum: ["new", "done", "archived"] };
      }),
    },
    expected: "BREAKING",
    kind: "add_input_enum_value",
    claimAdditive: true,
  },
  {
    name: "json schema adds an optional property",
    before: { jsonSchema: schema({ id: { type: "string" } }, ["id"]) },
    after: { jsonSchema: schema({ id: { type: "string" }, note: { type: "string" } }, ["id"]) },
    expected: "ADDITIVE",
    kind: "add_optional_field",
  },
  {
    name: "json schema narrows maxLength",
    before: { jsonSchema: schema({ label: { type: "string", maxLength: 40 } }, ["label"]) },
    after: { jsonSchema: schema({ label: { type: "string", maxLength: 10 } }, ["label"]) },
    expected: "BREAKING",
    kind: "tighten_constraint",
    claimAdditive: true,
  },
  {
    name: "typescript adds an optional field",
    before: { typescript: "export interface Order { id: string; }" },
    after: { typescript: "export interface Order { id: string; note?: string; }" },
    expected: "ADDITIVE",
    kind: "add_optional_field",
  },
  {
    name: "typescript adds a required field",
    before: { typescript: "export interface Order { id: string; }" },
    after: { typescript: "export interface Order { id: string; sku: string; }" },
    expected: "BREAKING",
    kind: "add_required",
    claimAdditive: true,
  },
  {
    name: "typescript removes a shared export",
    before: { typescript: "export function listOrders(): void { return; }" },
    after: { typescript: "function listOrders(): void { return; }" },
    expected: "BREAKING",
    kind: "drop_export",
    claimAdditive: true,
  },
  {
    name: "typescript adds an optional UI variant",
    before: { typescript: 'export type ButtonVariant = "primary";' },
    after: { typescript: 'export type ButtonVariant = "primary" | "ghost";' },
    expected: "ADDITIVE",
    kind: "add_optional_ui_variant",
  },
  {
    name: "typescript renames a field",
    before: { typescript: "export interface Order { price_cents: number; }" },
    after: { typescript: "export interface Order { price: string; }" },
    expected: "BREAKING",
    kind: "rename_field",
    claimAdditive: true,
  },
  {
    name: "typescript changes number to string",
    before: { typescript: "export interface Order { price_cents: number; }" },
    after: { typescript: "export interface Order { price_cents: string; }" },
    expected: "BREAKING",
    kind: "type_change",
    claimAdditive: true,
  },
];

function withRequest(required: string[]): string {
  return api((doc) => {
    const paths = doc.paths as Record<string, unknown>;
    const ordersPath = paths["/api/orders"] as Record<string, unknown>;
    const get = ordersPath.get as Record<string, unknown>;
    get.requestBody = {
      content: {
        "application/json": {
          schema: { type: "object", properties: { note: { type: "string" } }, required },
        },
      },
    };
  });
}

function componentSchemas(doc: Record<string, unknown>): Record<string, unknown> {
  const components = doc.components as Record<string, unknown>;
  return components.schemas as Record<string, unknown>;
}

describe("DeterministicSchemaDiffClassifier", () => {
  it("covers more than 25 additive and breaking diffs", () => {
    expect(cases.length).toBeGreaterThanOrEqual(25);
  });

  for (const item of cases) {
    it(item.name, () => {
      const result = classifier.classify({
        before: item.before,
        after: item.after,
        ...(item.claimAdditive ? { claimedClass: "additive" as const, claimedAdditive: true } : {}),
      });
      expect(result.classification).toBe(item.expected);
      expect(result.ops.some((op) => op.kind === item.kind)).toBe(true);
      if (item.expected === "BREAKING") {
        expect(result.ops.filter((op) => op.kind === item.kind).every((op) => op.breaking)).toBe(true);
      }
      if (item.claimAdditive) {
        expect(result.overridden).toBe(item.expected === "BREAKING");
      }
    });
  }

  it("overrides a false additive label on price_cents integer to price string", () => {
    const result = classifier.classify({
      before: { sql: orders("price_cents INTEGER NOT NULL") },
      after: { sql: orders("price TEXT") },
      claimedClass: "additive",
      claimedAdditive: true,
    });
    expect(result.classification).toBe("BREAKING");
    expect(result.overridden).toBe(true);
    expect(result.reasons.some((reason) => reason.includes("classification_floor") || reason.includes("rename"))).toBe(true);
  });
});
