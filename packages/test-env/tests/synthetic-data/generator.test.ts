import { createRequire } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DST_FALL_INSTANTS,
  DST_SPRING_INSTANTS,
  ProductionDataLeakError,
  RecipeValidationError,
  SchemaCycleDiagnostic,
  SeedRecipeSchema,
  SyntheticDataGenerator,
  UniqueDomainExhaustedError,
  computeTableChecksums,
  measureText,
  planInsertion,
} from "../../src/synthetic-data/index.js";
import {
  categorySchema,
  cycleSchema,
  demoSchema,
  lockedCycleSchema,
  recipe,
} from "./fixture.js";

const generator = new SyntheticDataGenerator();
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("synthetic data generator", () => {
  it("sorts foreign keys and breaks nullable cycles", () => {
    const plan = planInsertion(cycleSchema);
    expect(plan.deferredEdges).toHaveLength(1);
    expect(plan.deferredEdges[0]?.nullable).toBe(true);
    const users = plan.order.indexOf("users");
    const teams = plan.order.indexOf("teams");
    expect(users).toBeGreaterThanOrEqual(0);
    expect(teams).toBeGreaterThanOrEqual(0);
    expect(users).not.toBe(teams);
  });

  it("rejects a cycle with no nullable edge", () => {
    expect(() => generator.generateDataset(lockedCycleSchema, recipe())).toThrow(SchemaCycleDiagnostic);
    expect(() =>
      generator.generateDataset(
        {
          tables: [
            {
              name: "categories",
              columns: [
                { name: "id", type: "integer", primaryKey: true, nullable: false },
                {
                  name: "parent_id",
                  type: "integer",
                  nullable: false,
                  references: { table: "categories", column: "id" },
                },
              ],
            },
          ],
        },
        recipe(),
      ),
    ).toThrow(SchemaCycleDiagnostic);
  });

  it("loads a nullable self-reference and a mutual cycle with a second pass", () => {
    const categories = generator.generateDataset(categorySchema, recipe());
    expect(categories.load.updates.length).toBeGreaterThan(0);
    expect(categories.tables[0]?.rows[0]?.parent_id).toBeNull();
    const cycle = generator.generateDataset(cycleSchema, recipe());
    expect(cycle.load.updates.length).toBeGreaterThan(0);
    expect(cycle.coverage.orphanLooking).toBe(true);
  });

  it("injects every required boundary without breaking constraints", () => {
    const dataset = generator.generateDataset(demoSchema, recipe());
    expect(dataset.tables.every((table) => table.rows.length >= 3)).toBe(true);
    expect(dataset.coverage).toMatchObject({
      maxLength: true,
      unicode: true,
      emoji: true,
      rtlArabic: true,
      rtlHebrew: true,
      cutoffBefore: true,
      cutoffAt: true,
      cutoffAfter: true,
      dstSpring: true,
      dstFall: true,
      zeroChildren: true,
      oneChild: true,
      manyChildren: true,
      softDeleted: true,
      nullFields: true,
      duplicateValues: true,
      orphanLooking: true,
    });
    const users = dataset.tables.find((table) => table.name === "users");
    const orders = dataset.tables.find((table) => table.name === "orders");
    expect(users).toBeDefined();
    expect(orders).toBeDefined();
    for (const row of users?.rows ?? []) {
      expect(measureText(String(row.name), "code_points")).toBeLessThanOrEqual(32);
      expect(measureText(String(row.badge), "utf8_bytes")).toBeLessThanOrEqual(8);
      expect(measureText(String(row.units), "utf16_code_units")).toBeLessThanOrEqual(4);
      expect(String(row.email).endsWith("@example.test") || String(row.email).endsWith("@env.test")).toBe(
        true,
      );
    }
    expect(users?.rows.some((row) => measureText(String(row.name), "code_points") === 32)).toBe(true);
    expect(users?.rows.some((row) => measureText(String(row.badge), "utf8_bytes") === 8)).toBe(true);
    expect(users?.rows.some((row) => String(row.name).includes("🍜") && String(row.name).includes("Ümlaut"))).toBe(
      true,
    );
    const quantities = (orders?.rows ?? []).map((row) => row.quantity);
    expect(quantities.every((value) => typeof value === "number" && value >= 1 && value <= 20)).toBe(true);
    const stamps = (orders?.rows ?? []).map((row) => String(row.happened_at));
    expect(stamps).toEqual(expect.arrayContaining([...DST_SPRING_INSTANTS, ...DST_FALL_INSTANTS]));
    const cities = (users?.rows ?? []).map((row) => row.city);
    expect(cities.filter((city) => city === cities[0]).length).toBeGreaterThanOrEqual(2);
    const counts = new Map<number, number>();
    for (const row of orders?.rows ?? []) {
      if (typeof row.user_id === "number") counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
    }
    expect(counts.has(1)).toBe(false);
    expect([...counts.values()].some((count) => count === 1)).toBe(true);
    expect([...counts.values()].some((count) => count >= 3)).toBe(true);
  });

  it("keeps unique values collision-free when a vocabulary would repeat", () => {
    const dataset = generator.generateDataset(
      {
        tables: [
          {
            name: "dishes",
            columns: [
              { name: "id", type: "integer", primaryKey: true, nullable: false },
              { name: "label", type: "text", nullable: false, unique: true, hint: "dish_name" },
            ],
          },
        ],
      },
      { seed: 7, profile: "functional", vocabularies: { dish_name: ["Ramen"] } },
    );
    const labels = dataset.tables[0]?.rows.map((row) => String(row.label)) ?? [];
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.some((label) => label !== "Ramen")).toBe(true);
  });

  it("refuses an impossible unique domain before bulk load", () => {
    expect(() =>
      generator.generateDataset(
        {
          tables: [
            {
              name: "slots",
              columns: [
                { name: "id", type: "integer", primaryKey: true, nullable: false },
                {
                  name: "code",
                  type: "integer",
                  nullable: false,
                  unique: true,
                  check: "code BETWEEN 1 AND 3",
                },
              ],
            },
          ],
        },
        recipe(),
      ),
    ).toThrow(UniqueDomainExhaustedError);
  });

  it("reproduces checksums for the same seed and changes them when a value changes", () => {
    const first = generator.generateDataset(demoSchema, recipe(42));
    const second = generator.generateDataset(demoSchema, recipe(42));
    expect(JSON.stringify(first.tables)).toBe(JSON.stringify(second.tables));
    expect(first.checksums).toEqual(second.checksums);
    const third = generator.generateDataset(demoSchema, recipe(43));
    expect(first.checksums).not.toEqual(third.checksums);
    const reordered = computeTableChecksums({
      tables: first.tables.map((table) => ({
        ...table,
        rows: [...table.rows].reverse(),
      })),
    });
    expect(reordered).toEqual(first.checksums);
  });

  it("stays byte-identical across process timezones", () => {
    const utc = checksumsFor("UTC");
    const kiritimati = checksumsFor("Pacific/Kiritimati");
    const newYork = checksumsFor("America/New_York");
    expect(kiritimati).toBe(utc);
    expect(newYork).toBe(utc);
  });

  it("uses the discovery locale without leaving synthetic email domains", () => {
    const english = generator.generateDataset(demoSchema, recipe(42));
    const german = generator.generateDataset(demoSchema, { ...recipe(42), locale: "de" });
    const englishName = english.tables[0]?.rows[0]?.name;
    const germanName = german.tables[0]?.rows[0]?.name;
    expect(englishName).not.toBe(germanName);
    expect(german.checksums).toEqual(generator.generateDataset(demoSchema, { ...recipe(42), locale: "de" }).checksums);
  });

  it("rejects production-looking emails and accepts explicit sanitized brownfield rows", () => {
    expect(() =>
      generator.generateDataset(demoSchema, {
        ...recipe(),
        sanitizedBrownfield: { users: [{ id: 500, email: "person@gmail.com", name: "Pat", city: "X", badge: "M", units: "MM" }] },
      }),
    ).toThrow(ProductionDataLeakError);
    const dataset = generator.generateDataset(demoSchema, {
      ...recipe(),
      sanitizedBrownfield: {
        users: [
          {
            id: 500,
            email: "archive@example.test",
            name: "Archive",
            city: "Sample",
            badge: "MMMMMMMM",
            units: "MMMM",
          },
        ],
      },
    });
    expect(dataset.tables[0]?.rows.some((row) => row.email === "archive@example.test")).toBe(true);
  });

  it("builds a predecessor fixture at the previous schema", () => {
    const fixture = generator.generateMigrationPredecessorFixture(demoSchema, recipe(), "abc123");
    expect(fixture.commit).toBe("abc123");
    expect(fixture.purpose).toBe("migration-predecessor");
    expect(fixture.dataset.purpose).toBe("migration-predecessor");
    expect(fixture.dataset.coverage.duplicateValues).toBe(true);
    expect(fixture.dataset.coverage.orphanLooking).toBe(true);
    expect(fixture.notes.length).toBeGreaterThan(0);
  });

  it("keeps a singleton table to one row", () => {
    const dataset = generator.generateDataset(
      {
        tables: [
          {
            name: "settings",
            maxRows: 1,
            columns: [
              { name: "id", type: "integer", primaryKey: true, nullable: false },
              { name: "name", type: "text", nullable: false },
            ],
          },
        ],
      },
      recipe(),
    );
    expect(dataset.tables[0]?.rows).toHaveLength(1);
  });

  it("validates seed recipes", () => {
    expect(SeedRecipeSchema.parse({ seed: 42 }).seed).toBe(42);
    expect(SeedRecipeSchema.parse({ seed: 42 }).performanceRowCount).toBe(10000);
    const parsed = SeedRecipeSchema.safeParse({ seed: 1.5 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error).toBeInstanceOf(RecipeValidationError);
  });

  it("returns dataset rows synchronously", () => {
    const dataset = generator.generateDataset(demoSchema, recipe());
    expect(typeof (dataset as { then?: unknown }).then).not.toBe("function");
  });
});

function checksumsFor(timeZone: string): string {
  const require = createRequire(import.meta.url);
  const tsx = pathToFileURL(require.resolve("tsx")).href;
  const script = `
    import { SyntheticDataGenerator } from "./src/synthetic-data/index.ts";
    const generator = new SyntheticDataGenerator();
    const dataset = generator.generateDataset(${JSON.stringify(demoSchema)}, ${JSON.stringify(recipe(42))});
    process.stdout.write(JSON.stringify(dataset.checksums));
  `;
  const result = spawnSync(
    process.execPath,
    ["--import", tsx, "--input-type=module", "-e", script],
    {
      cwd: packageRoot,
      env: { ...process.env, TZ: timeZone },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "timezone child failed");
  }
  return result.stdout;
}
