import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fixtureAbsolutePath } from "./fixture-paths.js";
import type { MetaLabBenchmarkRegistry } from "./registry.js";
import type { MaterializedBenchmark, SuiteId } from "./types.js";

const activeWorkspaces = new Set<string>();

export async function materializeBenchmarkCase(
  registry: MetaLabBenchmarkRegistry,
  suiteId: SuiteId,
  caseId: string,
): Promise<MaterializedBenchmark> {
  const suite = registry.getSuite(suiteId);
  const benchmarkCase = suite.cases.find((row) => row.id === caseId);
  if (!benchmarkCase) {
    throw new Error(`unknown benchmark case ${caseId}`);
  }
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "ef-metalab-bench-"));
  activeWorkspaces.add(workspacePath);
  const fixtureBytes = fs.readFileSync(fixtureAbsolutePath(benchmarkCase.fixtureRelativePath));
  fs.writeFileSync(path.join(workspacePath, "repo.json"), fixtureBytes);
  const liveCloneSkippedOffline = suiteId === "suite:resume-changer-brownfield";
  return {
    caseId,
    suiteId,
    split: benchmarkCase.split,
    workspacePath,
    pinnedCommitSha: benchmarkCase.pinnedCommitSha ?? null,
    liveCloneSkippedOffline,
    cleanup: async () => {
      await cleanupWorkspace(workspacePath);
    },
  };
}

async function cleanupWorkspace(workspacePath: string): Promise<void> {
  if (!activeWorkspaces.has(workspacePath)) {
    return;
  }
  activeWorkspaces.delete(workspacePath);
  await fs.promises.rm(workspacePath, { recursive: true, force: true });
}

export async function cleanupAllHermeticWorkspaces(): Promise<void> {
  const paths = [...activeWorkspaces];
  await Promise.all(paths.map((workspacePath) => cleanupWorkspace(workspacePath)));
  if (activeWorkspaces.size > 0) {
    throw new Error("hermetic workspace cleanup left stray directories");
  }
}

export function assertGraderScopedToWorkspace(
  builtRepoPath: string,
  workspacePath: string,
): void {
  const normalizedBuilt = path.resolve(builtRepoPath);
  const normalizedWorkspace = path.resolve(workspacePath);
  if (!normalizedBuilt.startsWith(normalizedWorkspace)) {
    throw new Error("grader attempted to read outside materialized benchmark directory");
  }
}