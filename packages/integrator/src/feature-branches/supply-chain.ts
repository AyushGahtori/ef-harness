import type { DependencyIntent, SupplyChainGate, VetReport } from "./types.js";

const POPULAR = [
  "react",
  "react-dom",
  "lodash",
  "express",
  "next",
  "vue",
  "zod",
  "date-fns",
  "axios",
  "webpack",
  "vitest",
  "typescript",
  "eslint",
  "pnpm",
];

/**
 * Local port of Task 046 `KernelPackageInstaller.vetDependencyIntent` and `checkTyposquat`.
 * The task text names Task 048; the published allowlist and approval gate live on Task 046.
 */
export class LocalSupplyChainGate implements SupplyChainGate {
  private readonly allowlist: Set<string>;

  constructor(allowlist: readonly string[] = ["zod", "date-fns"]) {
    this.allowlist = new Set(allowlist);
  }

  approve(packageName: string): void {
    this.allowlist.add(packageName);
  }

  vetDependencyIntent(intent: DependencyIntent): VetReport {
    if (!/^[a-z0-9._@/-]+$/i.test(intent.packageName)) {
      return { decision: "deny", reason: "package name is not a registry name" };
    }
    const squat = typosquatOf(intent.packageName);
    if (squat && squat !== intent.packageName) {
      return { decision: "deny", reason: `typosquat of ${squat}` };
    }
    if (!this.allowlist.has(intent.packageName)) {
      return { decision: "deny", reason: "package is not on the supply-chain allowlist" };
    }
    if (!intent.rationale.trim()) {
      return { decision: "deny", reason: "approval rationale is required" };
    }
    if (!intent.versionRange.trim()) {
      return { decision: "deny", reason: "version range is required" };
    }
    return { decision: "allow", reason: "allowlist and approval rationale accepted" };
  }
}

export function typosquatOf(name: string): string | null {
  const folded = name.toLowerCase().replaceAll(/[_-]/g, "");
  for (const popular of POPULAR) {
    if (popular === name) return null;
    const distance = damerau(folded, popular.toLowerCase().replaceAll(/[_-]/g, ""));
    if (distance >= 1 && distance <= 2) return popular;
  }
  return null;
}

function damerau(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix: number[][] = [];
  for (let row = 0; row < rows; row += 1) {
    const line = new Array<number>(cols).fill(0);
    line[0] = row;
    matrix.push(line);
  }
  const header = matrix[0];
  if (!header) return Math.max(left.length, right.length);
  for (let col = 0; col < cols; col += 1) header[col] = col;
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      const current = matrix[row];
      const previous = matrix[row - 1];
      if (!current || !previous) continue;
      const deletion = (previous[col] ?? 0) + 1;
      const insertion = (current[col - 1] ?? 0) + 1;
      const substitution = (previous[col - 1] ?? 0) + cost;
      let best = Math.min(deletion, insertion, substitution);
      if (row > 1 && col > 1 && left[row - 1] === right[col - 2] && left[row - 2] === right[col - 1]) {
        const transpose = matrix[row - 2]?.[col - 2];
        if (transpose !== undefined) best = Math.min(best, transpose + 1);
      }
      current[col] = best;
    }
  }
  return matrix[left.length]?.[right.length] ?? Math.max(left.length, right.length);
}
