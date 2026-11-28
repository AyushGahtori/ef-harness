import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { CombinedRegressionGate } from "../merge-queue/gate.js";
import { LLM_TOKENS } from "./constants.js";
import { featureIdFromPath } from "./scan.js";
import type { RegressionReport, StaticAuditReport } from "./types.js";

/**
 * Undo regression runs the shared merge-queue gate inside HarnessRunEngine.
 * The undone feature's files are already gone, so its tests are not executed.
 */
export class CombinedRegressionGatePort {
  async run(worktree: string, undone: readonly string[], audit: StaticAuditReport): Promise<RegressionReport> {
    const skipped = new Set(undone);
    const scripts = listFeatureTests(worktree).filter((script) => !skipped.has(featureIdFromPath(script)));
    const remaining = new Set<string>();
    for (const script of scripts) {
      const feature = featureIdFromPath(script);
      if (feature) remaining.add(feature);
    }
    const failed: string[] = [];
    const passed: string[] = [];
    if (!audit.ok) failed.push("STATIC_AUDIT");
    const gate = new CombinedRegressionGate();
    try {
      const result = await gate.run({
        repo: worktree,
        worktree,
        baseSha: "HEAD",
        headSha: "HEAD",
      });
      if (result.ok) passed.push(...scripts);
      else {
        for (const check of result.failingChecks) failed.push(`${check.id}: ${check.trace}`.trim());
      }
      return {
        ok: failed.length === 0 && result.ok,
        remainingFeatures: [...remaining].sort(),
        failed,
        passed,
        llmTokens: LLM_TOKENS,
        audit,
      };
    } finally {
      gate.close();
    }
  }
}

function listFeatureTests(root: string): string[] {
  const featuresDir = path.join(root, "features");
  if (!statSync(featuresDir, { throwIfNoEntry: false })?.isDirectory()) return [];
  const found: string[] = [];
  function visit(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.test\.(mjs|cjs|js|ts|mts|cts)$/.test(entry.name)) found.push(path.relative(root, full).replaceAll("\\", "/"));
    }
  }
  visit(featuresDir);
  return found.sort();
}
