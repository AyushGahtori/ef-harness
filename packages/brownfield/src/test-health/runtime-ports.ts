import type { WorktreeSlotPool } from "@ef-harness/git-engine";
import type { HarnessRunEngine } from "@ef-harness/sandbox";
import type { BrownfieldL0RepoScanner } from "../l0-scan/brownfield-l0-repo-scanner.js";
import type {
  BrownfieldL0RepoScannerPort,
  HarnessRunEnginePort,
  WorktreeSlotPoolPort,
} from "./ports.js";

export interface WorktreePoolBinding {
  readonly pool: WorktreeSlotPool;
  readonly projectId: string;
  readonly mainRepoPath: string;
  readonly taskId: string;
}

export function adaptWorktreeSlotPool(binding: WorktreePoolBinding): WorktreeSlotPoolPort {
  return {
    async checkoutIsolated(baselineCommitSha) {
      const handle = await binding.pool.acquireSlot({
        projectId: binding.projectId,
        mainRepoPath: binding.mainRepoPath,
        baseCommit: baselineCommitSha,
        taskId: binding.taskId,
        attempt: 1,
      });
      return { slotId: handle.slotId, rootPath: handle.slotPath };
    },
    async release(slotId) {
      await binding.pool.releaseSlot({
        projectId: binding.projectId,
        mainRepoPath: binding.mainRepoPath,
        slotId,
        outcome: "abandoned",
      });
    },
  };
}

export function adaptHarnessRunEngine(engine: HarnessRunEngine): HarnessRunEnginePort {
  return {
    async runInSandbox(slot, argv) {
      const started = Date.now();
      const result = await engine.executeSandboxedCommand({
        attemptId: slot.slotId,
        worktreePath: slot.rootPath,
        command: argv,
      });
      return {
        exitCode: result.exitCode,
        stdout: result.stdoutSummary,
        stderr: result.stderrSummary,
        durationMs: result.durationMs || Date.now() - started,
      };
    },
  };
}

export function adaptL0ScriptDetector(scanner: BrownfieldL0RepoScanner): BrownfieldL0RepoScannerPort {
  return {
    async detectScripts(repoRoot) {
      const result = scanner.scan({ repoRoot });
      const scripts = result.stack.scripts[0]?.scripts ?? {};
      const argv = (name: string): readonly string[] | null => {
        const value = scripts[name];
        return value ? value.split(/\s+/) : null;
      };
      return {
        typecheck: argv("typecheck"),
        lint: argv("lint"),
        build: argv("build"),
        test: argv("test"),
        testFileCount: result.files.filter((file) => /\.(test|spec)\./.test(file.path)).length,
      };
    },
  };
}
