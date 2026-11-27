import { describe, expect, it as vitestIt } from "vitest";

const it = (name: string, fn: () => void | Promise<void>): void => {
  vitestIt(name, fn, 120_000);
};
import {
  CONTEXT_RADIUS,
  MERGE_TREE_COMMAND,
  MergeTreePreflightScanner,
  buildScopedConflictPrompt,
} from "../../src/feature-integrator/index.js";
import { revParse } from "../../src/feature-integrator/git.js";
import { commitAll, initRepo, porcelain, removeRepo } from "./git-fixture.js";

function wideFile(value: string): string {
  const lines: string[] = [];
  for (let index = 0; index < 45; index += 1) {
    if (index === 0) lines.push("export const farSentinel = \"FAR_SENTINEL\";");
    else if (index === 38) lines.push("export const nearBefore = \"NEAR_BEFORE\";");
    else if (index === 40) lines.push(`export const value = ${JSON.stringify(value)};`);
    else lines.push(`export const line${index} = ${index};`);
  }
  return `${lines.join("\n")}\n`;
}

describe("MergeTreePreflightScanner", () => {
  it("detects conflicting paths and hunk ranges from the object database without touching the checkout", async () => {
    const repo = await initRepo();
    try {
      const base = await commitAll(repo, "main", { "src/marker.ts": wideFile("base"), "README.md": "UNRELATED_SENTINEL\n" }, "base");
      const menu = await commitAll(repo, "menu", { "src/marker.ts": wideFile("menu") }, "menu", base);
      const order = await commitAll(repo, "order", { "src/marker.ts": wideFile("order") }, "order", base);
      expect(menu).not.toBe(base);
      const head = await revParse(repo, "HEAD");
      const status = await porcelain(repo);
      const scanner = new MergeTreePreflightScanner();
      await scanner.scan({ repo, ours: menu, theirs: order });
      const report = await scanner.scan({ repo, ours: menu, theirs: order });
      expect(report.command).toBe(MERGE_TREE_COMMAND);
      expect(report.clean).toBe(false);
      expect(report.treeOid).toMatch(/^[0-9a-f]{40}$/);
      expect(report.conflicts.map((conflict) => conflict.path)).toEqual(["src/marker.ts"]);
      expect(report.messages.some((message) => message.includes("src/marker.ts"))).toBe(true);
      expect(report.durationMs).toBeLessThan(1000);
      const hunk = report.conflicts[0]?.hunks[0];
      expect(hunk).toBeTruthy();
      expect(hunk && hunk.startLine).toBeGreaterThan(1);
      expect(hunk && hunk.endLine).toBeGreaterThanOrEqual(hunk.startLine);
      expect(hunk && hunk.contextBefore.length).toBeLessThanOrEqual(CONTEXT_RADIUS);
      expect(hunk && hunk.contextAfter.length).toBeLessThanOrEqual(CONTEXT_RADIUS);
      expect(hunk?.ours).toContain("menu");
      expect(hunk?.theirs).toContain("order");
      const prompt = buildScopedConflictPrompt({
        hunks: report.conflicts.flatMap((conflict) => conflict.hunks),
        objectives: [
          { taskId: "T-Menu", objective: "Mount the menu route" },
          { taskId: "T-Order", objective: "Mount the order route" },
        ],
      });
      expect(prompt).toContain("T-Menu: Mount the menu route");
      expect(prompt).toContain("NEAR_BEFORE");
      expect(prompt).not.toContain("FAR_SENTINEL");
      expect(prompt).not.toContain("UNRELATED_SENTINEL");
      expect(await revParse(repo, "HEAD")).toBe(head);
      expect(await porcelain(repo)).toBe(status);
    } finally {
      removeRepo(repo);
    }
  });
});
