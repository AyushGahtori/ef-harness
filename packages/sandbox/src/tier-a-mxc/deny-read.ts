import fs from "node:fs";
import path from "node:path";
import { SandboxUnavailableError } from "./errors.js";

const MAX_SNAPSHOT_ENTRIES = 4096;
const MAX_SNAPSHOT_DEPTH = 8;

const FILE_SNAPSHOT_RULES = new Set([
  "deny_read_ssh",
  "deny_read_aws",
  "deny_read_azure",
  "deny_read_gnupg",
  "deny_read_npmrc",
]);

export interface FrozenDenyReadSnapshot {
  readonly paths: readonly string[];
  readonly evaluatedAt: "process_start";
  readonly postStartCreatesAreOutsideSnapshot: true;
}

export interface LaunchDenyReadFreeze {
  readonly files: readonly string[];
  readonly prefixes: readonly string[];
  readonly evaluatedAt: "process_start";
  readonly postStartCreatesAreOutsideSnapshot: true;
}

/**
 * Expand deny-read roots to the concrete files that exist at process start.
 * MXC freezes that list: a file created after the snapshot is not in it.
 * Callers pass a small root. Browser profiles stay prefix rules.
 */
export function expandDenyReadFiles(roots: readonly string[]): FrozenDenyReadSnapshot {
  const matched: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_SNAPSHOT_DEPTH) {
      throw new SandboxUnavailableError("deny_read_snapshot_too_deep");
    }
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (matched.length >= MAX_SNAPSHOT_ENTRIES) {
        throw new SandboxUnavailableError("deny_read_snapshot_too_large");
      }
      const full = path.join(dir, entry.name);
      matched.push(full);
      if (entry.isDirectory()) walk(full, depth + 1);
    }
  };
  for (const root of roots) {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(root);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (matched.length >= MAX_SNAPSHOT_ENTRIES) {
      throw new SandboxUnavailableError("deny_read_snapshot_too_large");
    }
    matched.push(root);
    if (stat.isDirectory()) walk(root, 1);
  }
  matched.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return {
    paths: Object.freeze(matched),
    evaluatedAt: "process_start",
    postStartCreatesAreOutsideSnapshot: true,
  };
}

/**
 * Freeze deny-read rules at launch. Small secret roots become a file list.
 * Browser profiles, harness data, the checkout, and other worktrees stay
 * directory prefixes so the launcher does not walk those trees.
 */
export function freezeDenyReadAtStart(
  rules: readonly { readonly id: string; readonly kind: string; readonly path: string }[],
): LaunchDenyReadFreeze {
  const small: string[] = [];
  const prefixes: string[] = [];
  for (const rule of rules) {
    if (rule.kind !== "deny_read") continue;
    prefixes.push(rule.path);
    if (FILE_SNAPSHOT_RULES.has(rule.id)) small.push(rule.path);
  }
  const expanded = expandDenyReadFiles(small);
  return {
    files: expanded.paths,
    prefixes: Object.freeze(prefixes),
    evaluatedAt: "process_start",
    postStartCreatesAreOutsideSnapshot: true,
  };
}

export function isInsideFrozenSnapshot(snapshot: FrozenDenyReadSnapshot, target: string): boolean {
  const needle = path.normalize(target);
  return snapshot.paths.some((entry) => path.normalize(entry) === needle);
}
