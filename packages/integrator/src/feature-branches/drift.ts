import { diffNameOnly, untrackedFiles } from "./git.js";
import type { DriftWarning, FeatureBranchRecord } from "./types.js";

const SHARED_ALLOWLIST = new Set(["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]);

/**
 * Early warning when two parallel `harness/f/*` branches edit the same helper
 * even though Task 092 gave them disjoint write scopes.
 */
export class SharedFileDriftMonitor {
  scan(input: {
    readonly repo: string;
    readonly branches: readonly FeatureBranchRecord[];
    readonly scopes: Readonly<Record<string, readonly string[]>>;
  }): DriftWarning[] {
    const tracked = new Map<string, Map<string, Set<string>>>();
    const remember = (kind: "tracked" | "untracked", featureId: string, filePath: string): void => {
      if (SHARED_ALLOWLIST.has(filePath)) return;
      const byPath = tracked.get(kind) ?? new Map<string, Set<string>>();
      const features = byPath.get(filePath) ?? new Set<string>();
      features.add(featureId);
      byPath.set(filePath, features);
      tracked.set(kind, byPath);
    };
    for (const branch of input.branches) {
      if (branch.status === "pruned" || branch.status === "landed") continue;
      for (const filePath of diffNameOnly(input.repo, `${branch.baseIntegrationSha}..${branch.headSha}`)) {
        remember("tracked", branch.featureId, filePath.replaceAll("\\", "/"));
      }
      if (branch.worktreePath) {
        for (const filePath of untrackedFiles(branch.worktreePath)) remember("untracked", branch.featureId, filePath);
      }
    }
    const warnings: DriftWarning[] = [];
    for (const [kind, byPath] of tracked) {
      for (const [filePath, features] of byPath) {
        if (features.size < 2) continue;
        const ids = [...features].sort();
        const scoped = ids.filter((featureId) => scopeContains(input.scopes[featureId] ?? [], filePath));
        if (scoped.length === ids.length && ids.length > 1 && sameSharedPrefix(input.scopes, ids, filePath)) {
          continue;
        }
        warnings.push({
          path: filePath,
          featureIds: ids,
          kind: kind === "untracked" ? "untracked" : "tracked",
          message: `Parallel features ${ids.join(" and ")} both change ${filePath}, which is outside a single Task 092 write scope. Stop before both spend more turns on the same helper.`,
        });
      }
    }
    return warnings;
  }
}

function scopeContains(prefixes: readonly string[], filePath: string): boolean {
  return prefixes.some((prefix) => filePath === prefix || filePath.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));
}

function sameSharedPrefix(scopes: Readonly<Record<string, readonly string[]>>, ids: readonly string[], filePath: string): boolean {
  const prefixes = ids.map((id) => (scopes[id] ?? []).find((prefix) => scopeContains([prefix], filePath)) ?? "");
  return prefixes.every((prefix) => prefix.length > 0 && prefix === prefixes[0]);
}
