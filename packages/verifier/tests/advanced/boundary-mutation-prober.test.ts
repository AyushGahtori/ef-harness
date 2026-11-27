import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  TargetedBoundaryMutationProber,
  mutantTimeoutMs,
  type BoundaryProbeReport,
} from "../../src/advanced/index.js";

const prober = new TargetedBoundaryMutationProber();

const cutoffSource = `export type Order = { orderTime: number };
export const sample: Array<Order> = [];
export function accepts(orderTime: number, cutoff: number): boolean {
  return orderTime <= cutoff;
}
`;

const weakCheck = `import { accepts, sample } from "./order-cutoff.mjs";
if (!Array.isArray(sample)) process.exit(2);
if (accepts(10, 11) !== true) process.exit(1);
if (accepts(12, 11) !== false) process.exit(1);
process.exit(0);
`;

const strongCheck = `import { accepts } from "./order-cutoff.mjs";
if (accepts(10, 11) !== true) process.exit(1);
if (accepts(11, 11) !== true) process.exit(1);
if (accepts(12, 11) !== false) process.exit(1);
process.exit(0);
`;

const loopSource = `export function walk(n: number): number {
  let i = 0;
  let steps = 0;
  while (i < n) {
    i = Math.min(i + 1, n);
    steps += 1;
  }
  return steps;
}
`;

const loopCheck = `import { walk } from "./loop.mjs";
if (walk(4) !== 4) process.exit(1);
process.exit(0);
`;

const roleSource = `export function readSecrets(user: { role: string }): string[] {
  if (user.role === "admin") {
    return ["secret"];
  }
  return [];
}
`;

const roleCheck = `import { readSecrets } from "./role.mjs";
const guest = readSecrets({ role: "guest" });
const admin = readSecrets({ role: "admin" });
if (guest.length !== 0) process.exit(1);
if (admin.length !== 1) process.exit(1);
process.exit(0);
`;

const rowsSource = `export function boundaryRows(orderTime: number, cutoff: number): string[] {
  if (orderTime <= cutoff) {
    return ["kept"];
  }
  return [];
}
`;

const rowsCheck = `import { boundaryRows } from "./rows.mjs";
if (boundaryRows(10, 10).length !== 1) process.exit(1);
if (boundaryRows(11, 10).length !== 0) process.exit(1);
process.exit(0);
`;

describe("TargetedBoundaryMutationProber", () => {
  it("caps each mutant at three times the baseline and at most 10 seconds", () => {
    expect(mutantTimeoutMs(100)).toBe(300);
    expect(mutantTimeoutMs(10_000)).toBe(10_000);
    expect(mutantTimeoutMs(4_000, 10_000)).toBe(10_000);
  });

  it("flips <= to < through the TypeScript AST and leaves Array<Order> untouched", async () => {
    const report = await probeCheckout(
      { "order-cutoff.ts": cutoffSource, "check.mjs": weakCheck },
      "order-cutoff.ts",
      "check.mjs",
    );
    expect(report.checkoutUntouched).toBe(true);
    expect(report.mutants).toHaveLength(1);
    const mutant = report.mutants[0];
    expect(mutant?.syntaxOk).toBe(true);
    expect(mutant?.mutatedSource).toContain("Array<Order>");
    expect(mutant?.mutatedSource).toContain("orderTime < cutoff");
    expect(mutant?.mutatedSource).not.toContain("orderTime <= cutoff");
    expect(mutant?.operator).toBe("flip_comparison");
    expect(report.surviving).toHaveLength(1);
    expect(report.weakCheckGaps[0]?.routeTo).toBe("oracle-author@1");
    for (const scratch of report.deletedScratchDirectories) {
      expect(existsSync(scratch)).toBe(false);
    }
  }, 20_000);

  it("kills the cutoff mutant once the equality case is part of the acceptance check", async () => {
    const report = await probeCheckout(
      { "order-cutoff.ts": cutoffSource, "check.mjs": strongCheck },
      "order-cutoff.ts",
      "check.mjs",
    );
    expect(report.surviving).toHaveLength(0);
    expect(report.mutants[0]?.killed).toBe(true);
    expect(report.mutants[0]?.killReason).toBe("failed_check");
    expect(report.mutants[0]?.timedOut).toBe(false);
    expect(report.weakCheckGaps).toHaveLength(0);
  }, 20_000);

  it("terminates an infinite-loop mutant on the per-mutant timeout and marks it killed", async () => {
    const report = await probeCheckout(
      { "loop.ts": loopSource, "check.mjs": loopCheck },
      "loop.ts",
      "check.mjs",
    );
    expect(report.timeoutMs).toBe(3_000);
    expect(report.mutants).toHaveLength(1);
    expect(report.mutants[0]?.timedOut).toBe(true);
    expect(report.mutants[0]?.killed).toBe(true);
    expect(report.mutants[0]?.survived).toBe(false);
    expect(report.mutants[0]?.killReason).toBe("timeout");
    expect(report.surviving).toHaveLength(0);
    for (const scratch of report.deletedScratchDirectories) {
      expect(existsSync(scratch)).toBe(false);
    }
  }, 20_000);

  it("inverts and drops a role-check guard without editing the checkout", async () => {
    const report = await probeCheckout(
      { "role.ts": roleSource, "check.mjs": roleCheck },
      "role.ts",
      "check.mjs",
    );
    const inverted = report.mutants.find((mutant) => mutant.operator === "invert_role_guard");
    const dropped = report.mutants.find((mutant) => mutant.operator === "drop_role_guard");
    expect(inverted?.mutatedSource).toContain('!(user.role === "admin")');
    expect(dropped?.mutatedSource).toContain('return ["secret"]');
    expect(dropped?.mutatedSource).not.toContain("user.role");
    expect(inverted?.killed).toBe(true);
    expect(dropped?.killed).toBe(true);
    expect(report.checkoutUntouched).toBe(true);

    const guardSource = `export function readSecretsGuarded(user: { role: string }): string[] {
  if (user.role !== "admin") {
    return [];
  }
  return ["secret"];
}
`;
    const guardCheck = `import { readSecretsGuarded } from "./guard.mjs";
const guest = readSecretsGuarded({ role: "guest" });
const admin = readSecretsGuarded({ role: "admin" });
if (guest.length !== 0) process.exit(1);
if (admin.length !== 1) process.exit(1);
process.exit(0);
`;
    const guardReport = await probeCheckout(
      { "guard.ts": guardSource, "check.mjs": guardCheck },
      "guard.ts",
      "check.mjs",
    );
    const guardDropped = guardReport.mutants.find((mutant) => mutant.operator === "drop_role_guard");
    expect(guardDropped?.mutatedSource).toContain("{}");
    expect(guardDropped?.mutatedSource).toContain('return ["secret"]');
    expect(guardDropped?.mutatedSource).not.toContain("return []");
    expect(guardDropped?.killed).toBe(true);
  }, 20_000);

  it("returns empty on a boundary branch and still flips the cutoff comparison", async () => {
    const report = await probeCheckout(
      { "rows.ts": rowsSource, "check.mjs": rowsCheck },
      "rows.ts",
      "check.mjs",
    );
    const flipped = report.mutants.find((mutant) => mutant.operator === "flip_comparison");
    const emptied = report.mutants.find((mutant) => mutant.operator === "empty_boundary_return");
    expect(flipped?.mutatedSource).toContain("orderTime < cutoff");
    expect(flipped?.mutatedSource).toContain('return ["kept"]');
    expect(emptied?.mutatedSource).toContain("orderTime <= cutoff");
    expect(emptied?.mutatedSource).toContain("return []");
    expect(emptied?.mutatedSource).not.toContain('return ["kept"]');
    expect(flipped?.killed).toBe(true);
    expect(emptied?.killed).toBe(true);
    expect(flipped?.syntaxOk).toBe(true);
    expect(emptied?.syntaxOk).toBe(true);
  }, 20_000);
});

async function probeCheckout(
  files: Readonly<Record<string, string>>,
  relativeFile: string,
  acceptanceEntry: string,
): Promise<BoundaryProbeReport> {
  const checkout = await mkdtemp(path.join(tmpdir(), "ef-checkout-"));
  try {
    for (const [name, contents] of Object.entries(files)) {
      const full = path.join(checkout, name);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, contents);
    }
    const before = await readFile(path.join(checkout, relativeFile), "utf8");
    const report = await prober.probe({
      checkoutDir: checkout,
      relativeFile,
      acceptanceEntry,
      baselineMs: 1_000,
    });
    const after = await readFile(path.join(checkout, relativeFile), "utf8");
    expect(after).toBe(before);
    return report;
  } finally {
    await rm(checkout, { recursive: true, force: true });
  }
}
