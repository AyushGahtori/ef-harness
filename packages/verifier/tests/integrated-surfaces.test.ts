import { describe, expect, it } from "vitest";
import { CleanVerifierRunner } from "../src/runner/clean-verifier-runner.js";
import type { CleanVerifierDeps, SurfaceCollectInput } from "../src/runner/ports.js";
import type { CheckSurface, RequiredCheckRef } from "../src/runner/types.js";
import {
  integratedSurfaceAdapters,
  registerIntegratedSurfaceVerifiers,
} from "../src/integrated-surfaces.js";

const columns = [
  { name: "id", type: "integer" as const, nullable: false, primaryKey: true },
  { name: "name", type: "text" as const, nullable: false, maxLength: 32 },
  { name: "note", type: "text" as const, nullable: true, maxLength: 80 },
  { name: "owner_id", type: "integer" as const, nullable: true },
  { name: "created_at", type: "timestamp" as const, nullable: false },
];

const createSql = `
CREATE TABLE dishes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  note TEXT,
  owner_id INTEGER,
  created_at TEXT NOT NULL
)`;

const copySql = `
CREATE TABLE IF NOT EXISTS dishes_next (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  note TEXT,
  owner_id INTEGER,
  created_at TEXT NOT NULL,
  sku TEXT
);
INSERT INTO dishes_next (id, name, note, owner_id, created_at, sku)
SELECT id, name, note, owner_id, created_at, 'SKU-' || id FROM dishes
WHERE NOT EXISTS (SELECT 1 FROM dishes_next WHERE dishes_next.id = dishes.id);
CREATE INDEX IF NOT EXISTS dishes_next_owner_idx ON dishes_next(owner_id);`;

function ref(surface: CheckSurface): RequiredCheckRef {
  return {
    checkId: `check-${surface}`,
    checkVersion: 1,
    requirementId: "R-1",
    visibility: "visible",
    ruleId: null,
    surface,
    flaky: false,
  };
}

function collectInput(surface: CheckSurface, input: unknown): SurfaceCollectInput {
  return {
    checkoutPath: "/tmp/clean",
    commitSha: "a".repeat(40),
    attemptId: "attempt-c24",
    env: {
      id: "env-c24",
      tier: 3,
      isolatedFromAttemptId: "worker-1",
      vars: () => ({ APP_URL: "http://127.0.0.1" }),
      destroy: async () => {},
    },
    checks: [{ checkId: "migration.dishes", surface, input }],
    replay: false,
  };
}

function deps(): CleanVerifierDeps {
  const unused = (): never => {
    throw new Error("unused");
  };
  return {
    slots: {
      checkoutImmutable: async () => unused(),
      attachLockedDependencies: async () => unused(),
      release: async () => unused(),
    },
    environments: { provision: async () => unused() },
    engine: { runPinned: async () => unused() },
    gate: { runLeafStaticAudit: async () => unused() },
    cas: {
      get: async () => null,
      put: async () => "digest",
    },
    state: {
      listRequiredChecks: async () => [],
      readAttemptLease: async () => unused(),
      insertCheckResult: async () => {},
    },
  };
}

describe("integrated surface verifiers", () => {
  const adapters = integratedSurfaceAdapters({
    ui: {
      cas: {
        put: async () => "digest",
        promote: async () => {},
      },
    },
  });

  it("registers UI, API, CLI, and migration on the clean runner under one adapter contract", () => {
    const runner = new CleanVerifierRunner(deps());
    registerIntegratedSurfaceVerifiers(runner, {
      ui: {
        cas: {
          put: async () => "digest",
          promote: async () => {},
        },
      },
    });
    expect(adapters.map((adapter) => adapter.id)).toEqual([
      "ui-interaction-contract",
      "api-contract",
      "auth-callback",
      "time-boundary",
      "background-job",
      "cli-surface",
      "migration-preservation",
    ]);
    const ui = adapters[0];
    const api = adapters[1];
    const cli = adapters[5];
    const migration = adapters[6];
    expect(ui?.supports(ref("browser"))).toBe(true);
    expect(ui?.supports(ref("unit"))).toBe(false);
    expect(api?.supports(ref("api"))).toBe(true);
    expect(api?.supports(ref("cli"))).toBe(false);
    expect(cli?.supports(ref("cli"))).toBe(true);
    expect(migration?.supports(ref("migration"))).toBe(true);
    expect(migration?.supports(ref("api"))).toBe(false);
  });

  it("reports a dropped migration row through the runner adapter", async () => {
    const migration = adapters.find((adapter) => adapter.id === "migration-preservation");
    const collected = await migration?.collect(
      collectInput("migration", {
        checkId: "migration.dishes",
        dialect: "sqlite",
        table: "dishes",
        postTable: "dishes_next",
        primaryKey: "id",
        predecessor: { createSql, columns, seed: 7 },
        unchangedColumns: ["name", "note", "owner_id", "created_at"],
        upSql: `DELETE FROM dishes WHERE id = (SELECT MIN(id) FROM dishes);\n${copySql}`,
        downSql: "DROP TABLE IF EXISTS dishes_next;",
        statementTimeoutMs: 2_000,
        transformations: [
          {
            description: "sku from id",
            sql: "SELECT id, sku FROM dishes_next WHERE id = 1",
            expect: { id: 1, sku: "SKU-1" },
          },
        ],
        readSql: "SELECT id, name, sku FROM dishes_next ORDER BY id",
        expectedIndexes: ["dishes_next_owner_idx"],
      }),
    );
    expect(collected).toHaveLength(1);
    expect(collected?.[0]?.checkId).toBe("migration.dishes");
    expect(collected?.[0]?.reporterStatus).toBe("fail");
    expect(new TextDecoder().decode(collected?.[0]?.log)).toContain("row count");
  });
});
