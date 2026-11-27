import { describe, expect, it as vitestIt } from "vitest";

const it = (name: string, fn: () => void): void => {
  vitestIt(name, fn, 120_000);
};
import {
  DroppedSideError,
  MergeTreePreflightScanner,
  TestWeakeningError,
  UnrelatedEditError,
  resolveConflictText,
  resolvePreflight,
} from "../../src/feature-integrator/index.js";
import { commitAll, initRepo, removeRepo } from "./git-fixture.js";

const menuModule = 'export function menuRouter(): string {\n  return "menu";\n}\n';
const orderModule = 'export function orderRouter(): string {\n  return "order";\n}\n';
const menuRoutes = [
  'import { menuRouter } from "./menu.js";',
  'export const routes = [{ path: "/api/menu", router: menuRouter }];',
  "",
].join("\n");
const orderRoutes = [
  'import { orderRouter } from "./orders.js";',
  'export const routes = [{ path: "/api/orders", router: orderRouter }];',
  "",
].join("\n");

describe("scoped conflict resolution", () => {
  it("merges both route imports, keeps both paths, and passes typecheck plus route tests", () => {
    const repo = initRepo();
    try {
      const base = commitAll(
        repo,
        "main",
        { "src/routes/index.ts": "export const routes = [] as { path: string; router: () => string }[];\n" },
        "base",
      );
      const menu = commitAll(
        repo,
        "menu",
        { "src/routes/index.ts": menuRoutes, "src/routes/menu.ts": menuModule },
        "menu",
        base,
      );
      const order = commitAll(
        repo,
        "order",
        { "src/routes/index.ts": orderRoutes, "src/routes/orders.ts": orderModule },
        "order",
        base,
      );
      const report = new MergeTreePreflightScanner().scan({ repo, ours: menu, theirs: order });
      expect(report.conflicts.map((conflict) => conflict.path)).toContain("src/routes/index.ts");
      const resolved = resolvePreflight({
        repo,
        report,
        objectives: [
          { taskId: "T-Menu", objective: "Mount /api/menu" },
          { taskId: "T-Order", objective: "Mount /api/orders" },
        ],
      });
      const routes = resolved.files.find((file) => file.path === "src/routes/index.ts")?.text ?? "";
      expect(routes).toContain('import { menuRouter } from "./menu.js";');
      expect(routes).toContain('import { orderRouter } from "./orders.js";');
      expect(routes).toContain('"/api/menu"');
      expect(routes).toContain('"/api/orders"');
      expect(routes.includes("<".repeat(7))).toBe(false);
      expect(resolved.prompt).toContain("T-Menu: Mount /api/menu");
      expect(resolved.prompt).not.toContain(menuModule);
    } finally {
      removeRepo(repo);
    }
  });

  it("rejects a resolution that drops one side or edits an unrelated file", () => {
    const repo = initRepo();
    try {
      const base = commitAll(
        repo,
        "main",
        { "src/routes/index.ts": "export const routes = [] as { path: string; router: () => string }[];\n" },
        "base",
      );
      const menu = commitAll(
        repo,
        "menu",
        { "src/routes/index.ts": menuRoutes, "src/routes/menu.ts": menuModule },
        "menu",
        base,
      );
      const order = commitAll(
        repo,
        "order",
        { "src/routes/index.ts": orderRoutes, "src/routes/orders.ts": orderModule },
        "order",
        base,
      );
      const report = new MergeTreePreflightScanner().scan({ repo, ours: menu, theirs: order });
      expect(() =>
        resolvePreflight({
          repo,
          report,
          objectives: [],
          overrides: [{ path: "src/routes/index.ts", text: menuRoutes }],
        }),
      ).toThrow(DroppedSideError);
      expect(() =>
        resolvePreflight({
          repo,
          report,
          objectives: [],
          overrides: [{ path: "src/unrelated.ts", text: "export const extra = 1;\n" }],
        }),
      ).toThrow(UnrelatedEditError);
    } finally {
      removeRepo(repo);
    }
  });

  it("rejects an integrator patch that skips a conflicted leaf test", () => {
    const repo = initRepo();
    try {
      const base = commitAll(
        repo,
        "main",
        {
          "tests/leaf.test.ts": 'import assert from "node:assert/strict";\nexport function check(): void {\n  assert.equal(1, 1);\n}\n',
        },
        "base",
      );
      const menu = commitAll(
        repo,
        "menu",
        {
          "tests/leaf.test.ts":
            'import assert from "node:assert/strict";\nexport function check(): void {\n  assert.equal("menu", "menu");\n}\n',
        },
        "menu",
        base,
      );
      const order = commitAll(
        repo,
        "order",
        {
          "tests/leaf.test.ts":
            'import assert from "node:assert/strict";\nexport function check(): void {\n  assert.equal("order", "order");\n}\n',
        },
        "order",
        base,
      );
      const report = new MergeTreePreflightScanner().scan({ repo, ours: menu, theirs: order });
      expect(() =>
        resolvePreflight({
          repo,
          report,
          objectives: [],
          overrides: [
            {
              path: "tests/leaf.test.ts",
              text: [
                'import assert from "node:assert/strict";',
                "export function check(): void {",
                '  assert.equal("menu", "menu");',
                '  assert.equal("order", "order");',
                "}",
                'it.skip("hidden", () => { assert.equal(1, 1); });',
                "",
              ].join("\n"),
            },
          ],
        }),
      ).toThrow(TestWeakeningError);
    } finally {
      removeRepo(repo);
    }
  });

  it("unions barrel exports from both sides", () => {
    const ours = 'export { menuRouter } from "./menu.js";\n';
    const theirs = 'export { orderRouter } from "./orders.js";\n';
    const merged = resolveConflictText({
      path: "src/index.ts",
      conflicted: "",
      hunks: [],
      oursText: ours,
      theirsText: theirs,
    });
    expect(merged).toContain("menuRouter");
    expect(merged).toContain("orderRouter");
  });
});
