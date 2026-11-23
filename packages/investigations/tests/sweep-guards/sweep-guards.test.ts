import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  HistoricalMigrationWriteBlockedError,
  MAX_SYMBOL_MAP_HEADER_TOKENS,
  PersistedNameBoundaryGate,
  PostSweepBriefSymbolUpdater,
  PostSweepResyncPlanner,
  RiskyAstTransformDetector,
  SweepAuditScorecardRecorder,
  SweepLeftoverScanner,
  VariantExpandedReferenceInventory,
  expandNamingVariants,
  uniqueVariants,
} from "../../src/sweep-guards/index.js";
import { seedOrderItemSweepFixture, tempRepo, writeFile } from "./fixtures.js";

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
  }
});

function track(dir: string): string {
  cleanup.push(dir);
  return dir;
}

describe("sweep-guards", () => {
  it("expands all six casing/plural variants for MealOrder", () => {
    const expanded = expandNamingVariants("MealOrder");
    const casings = expanded.map((e) => e.casing);
    expect(casings).toEqual([
      "pascal",
      "camel",
      "snake",
      "screaming_snake",
      "kebab",
      "plural_snake",
    ]);
    const variants = uniqueVariants("MealOrder");
    expect(variants).toContain("MealOrder");
    expect(variants).toContain("mealOrder");
    expect(variants).toContain("meal_order");
    expect(variants).toContain("MEAL_ORDER");
    expect(variants).toContain("meal-order");
    expect(variants).toContain("meal_orders");
  });

  it("classifies Zone 1 code vs Zone 2 persisted names and immutable migrations", () => {
    const root = track(tempRepo("zones"));
    seedOrderItemSweepFixture(root);
    const inventory = new VariantExpandedReferenceInventory();
    const scan = inventory.scan({ repoRoot: root, targetSymbol: "OrderItem" });

    expect(scan.variants.length).toBeGreaterThanOrEqual(6);
    const zone1 = scan.hitsByZone.zone1_internal;
    const zone2 = scan.hitsByZone.zone2_persisted;
    const immutable = scan.hitsByZone.immutable_migration;

    expect(zone1.some((h) => h.filePath.includes("order-item.ts"))).toBe(true);
    expect(zone2.some((h) => h.persistedKind === "json_wire_key")).toBe(true);
    expect(zone2.some((h) => h.persistedKind === "local_storage_key")).toBe(true);
    expect(immutable.length).toBeGreaterThan(0);

    const gate = new PersistedNameBoundaryGate();
    const evaluation = gate.evaluate(scan);
    expect(evaluation.defaultDecision).toBe("preserve");
    expect(evaluation.requiresExplicitApproval).toBe(true);

    const { preserved, codemodTargets } = gate.partitionForCodemod(scan);
    expect(preserved.length).toBeGreaterThan(0);
    expect(codemodTargets.some((h) => h.zone === "zone1_internal")).toBe(true);
    expect(preserved.every((h) => h.zone === "zone2_persisted")).toBe(true);
  });

  it("blocks writes to historical migration files", () => {
    const inventory = new VariantExpandedReferenceInventory();
    expect(() => inventory.assertCodemodAllowed("migrations/20261110_create_orders.sql")).toThrow(
      HistoricalMigrationWriteBlockedError,
    );
  });

  it("detects variable shadowing, dynamic reflection, and unmapped ORM fields", () => {
    const detector = new RiskyAstTransformDetector();

    const shadowFlags = detector.scan({
      diffs: [
        {
          filePath: "src/checkout.ts",
          beforeSource: `export function processRefund(user: string, account: string) { return user; }`,
          afterSource: `export function processRefund(account: string, account: string) { return account; }\n`,
          renamedFrom: "user",
          renamedTo: "account",
        },
      ],
    });
    expect(shadowFlags.some((f) => f.kind === "variable_shadowing")).toBe(true);

    const dynamicFlags = detector.scan({
      diffs: [
        {
          filePath: "src/route.ts",
          beforeSource: `const key = 'orderItem'; router.push('/order-item/' + id);`,
          afterSource: `const key = 'orderItem'; obj[key]();`,
          renamedFrom: "orderItem",
          renamedTo: "mealOrderItem",
        },
      ],
    });
    expect(dynamicFlags.some((f) => f.kind === "dynamic_property_access")).toBe(true);

    const ormFlags = detector.scan({
      diffs: [
        {
          filePath: "prisma/schema.prisma",
          beforeSource: `model Cart { orderItem String @map("order_item") }`,
          afterSource: `model Cart { mealOrderItem String }`,
          renamedFrom: "orderItem",
          renamedTo: "mealOrderItem",
        },
      ],
    });
    expect(ormFlags.some((f) => f.kind === "orm_column_drift")).toBe(true);
    expect(detector.suggestOrmMap("order_item")).toBe('@map("order_item")');
  });

  it("catches Zone 1 leftovers while allowing accounted Zone 2 exclusions", () => {
    const root = track(tempRepo("leftover"));
    writeFile(
      root,
      "src/app.tsx",
      `import { MealOrderItem } from './meal';
export const legacy = () => router.push('/meals/' + id);
// leftover OrderItem type reference
export type Stale = OrderItem;
`,
    );
    writeFile(root, "src/api/body.json", `{ "order_item_id": "1" }`);

    const scanner = new SweepLeftoverScanner();
    const result = scanner.scanAfterSweep({
      repoRoot: root,
      targetSymbol: "OrderItem",
      renamedFrom: "OrderItem",
      zone2AccountedVariants: ["order_item_id", "order-item"],
    });

    expect(result.accountedZone2.length).toBeGreaterThan(0);
    expect(result.unaccountedZone1Leftovers.some((h) => h.filePath === "src/app.tsx")).toBe(true);
    expect(result.passed).toBe(false);
  });

  it("updates queued tasks write_scope and injects compact symbol map header", () => {
    const updater = new PostSweepBriefSymbolUpdater();
    const entry = {
      sweepId: "sweep-meal-order",
      pathMappings: {
        "src/components/OrderCard.tsx": "src/components/MealOrderCard.tsx",
      },
      symbolMappings: {
        OrderCard: "MealOrderCard",
        getUser: "getAccount",
      },
      persistedExclusions: ["order_item_id", "order_items"],
    };
    updater.persistSymbolMap(entry);
    const header = updater.buildCompactHeader(entry);
    expect(header).toContain("[RECENT SWEEP SYMBOL MAP]");
    expect(header.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(MAX_SYMBOL_MAP_HEADER_TOKENS);

    const tasks = [
      {
        taskId: "Task-201",
        writeScope: ["src/components/OrderCard.tsx"],
        compiledBrief: "MUST: edit OrderCard",
        status: "queued" as const,
      },
      {
        taskId: "Task-202",
        writeScope: ["src/other.ts"],
        compiledBrief: "MUST: unrelated",
        status: "active" as const,
      },
    ];
    const { updated, count } = updater.updateQueuedTasks(tasks, entry);
    expect(count).toBe(1);
    expect(updated[0]?.writeScope[0]).toBe("src/components/MealOrderCard.tsx");
    expect(updated[0]?.compiledBrief).toContain("[RECENT SWEEP SYMBOL MAP]");
    expect(updated[1]).toEqual(tasks[1]);
  });

  it("records sweep audit scorecard and recomputes checklist globs", () => {
    const recorder = new SweepAuditScorecardRecorder();
    recorder.record({
      sweepId: "s1",
      filesChanged: 42,
      codemodCount: 3,
      tailShardCount: 2,
      zone2ExcludedCount: 5,
      riskyAstFlagsCleared: 0,
      leftoverCount: 0,
      queuedBriefsUpdatedCount: 12,
    });
    expect(recorder.get("s1")?.queuedBriefsUpdatedCount).toBe(12);

    const resync = new PostSweepResyncPlanner();
    const rewrites = resync.recomputeChecklistGlobs(
      { "src/old_path": "src/new_path" },
      [{ taskId: "Task-088", writeScope: ["src/old_path/**"] }],
    );
    expect(rewrites[0]?.globs[0]).toBe("src/new_path/**");
    expect(resync.planFullResync({}).codeIndexRefreshed).toBe(true);
  });
});