import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { LLM_TOKENS } from "./constants.js";
import { featureIdFromPath } from "./scan.js";
import type { RegressionReport, StaticAuditReport } from "./types.js";

/**
 * Local port of Task 111 `CombinedRegressionGate`.
 * Runs each remaining feature's `*.test.mjs` / `*.test.js` with node and
 * includes the undo `STATIC_AUDIT`. Zero model calls.
 */
export class CombinedRegressionGatePort {
  run(worktree: string, undone: readonly string[], audit: StaticAuditReport): RegressionReport {
    const skipped = new Set(undone);
    const scripts = listFeatureTests(worktree).filter((script) => !skipped.has(featureIdFromPath(script)));
    const failed: string[] = [];
    const passed: string[] = [];
    const remaining = new Set<string>();
    if (!audit.ok) failed.push("STATIC_AUDIT");
    for (const script of scripts) {
      const feature = featureIdFromPath(script);
      if (feature) remaining.add(feature);
      const result = spawnSync(process.execPath, [script], {
        cwd: worktree,
        encoding: "utf8",
        windowsHide: true,
      });
      if ((result.status ?? 1) === 0) passed.push(script);
      else failed.push(`${script}: ${(result.stderr || result.stdout || "failed").trim()}`);
    }
    return {
      ok: failed.length === 0,
      remainingFeatures: [...remaining].sort(),
      failed,
      passed,
      llmTokens: LLM_TOKENS,
      audit,
    };
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
      else if (/\.test\.(mjs|cjs|js)$/.test(entry.name)) found.push(path.relative(root, full).replaceAll("\\", "/"));
    }
  }
  visit(featuresDir);
  return found.sort();
}
