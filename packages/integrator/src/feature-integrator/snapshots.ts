import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { CleanVerifierRunner, WorktreeSlotManagerPort } from "@ef-harness/verifier";
import { snapshotFiles } from "./trees.js";
import type { CleanSnapshotPort, CleanVerifierHarnessPort } from "./types.js";

/** Async reader of commit trees directly from the git object database. */
export const gitSnapshots: CleanSnapshotPort = {
  async read(repo, commit, label) {
    return { label, commit, files: await snapshotFiles(repo, commit) };
  },
};

async function collectDirectoryFiles(rootDir: string, currentDir = rootDir): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectDirectoryFiles(rootDir, full);
      for (const [rel, text] of nested.entries()) {
        files.set(rel, text);
      }
      continue;
    }
    if (!entry.isFile()) continue;
    const text = await readFile(full, "utf8");
    if (text.includes("\u0000")) continue;
    files.set(path.relative(rootDir, full).replaceAll("\\", "/"), text);
  }
  return files;
}

/**
 * Binds `WorktreeSlotManagerPort` (`@ef-harness/verifier` / C23) to check out immutable
 * clean verifier trees separated from worker checkouts, read files, and release the slot.
 */
export function bindSlotSnapshots(
  slots: WorktreeSlotManagerPort,
  options: {
    readonly excludeWorktreePath?: string;
    readonly excludeWorktreeId?: string;
    readonly lockDigest?: string;
  } = {},
): CleanSnapshotPort {
  return {
    async read(repo, commit, label) {
      const slot = await slots.checkoutImmutable({
        commitSha: commit,
        kind: "verifier",
        excludeWorktreePath: options.excludeWorktreePath ?? repo,
        excludeWorktreeId: options.excludeWorktreeId ?? "integrator",
      });
      try {
        if (options.lockDigest !== undefined) {
          await slots.attachLockedDependencies(slot, options.lockDigest);
        }
        const files = await collectDirectoryFiles(slot.worktreePath);
        return { label, commit, files };
      } finally {
        await slots.release(slot);
      }
    },
  };
}

/** Binds `@ef-harness/verifier` `CleanVerifierRunner` (`C23`) into the integrator clean verifier port. */
export function bindCleanVerifierRunner(runner: CleanVerifierRunner): CleanVerifierHarnessPort {
  return {
    verifyCandidate(request) {
      return runner.verifyCandidate(request);
    },
  };
}
