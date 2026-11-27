import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MemoryContentStore } from "../../src/phase0/cas.js";
import { LocalGitleaksScanner } from "../../src/phase0/gitleaks.js";
import { GitIntegrationRepo, writeTree } from "../../src/phase0/git-repo.js";
import { canonicalLockfile, lockfileHash } from "../../src/phase0/lockfile.js";
import type { Phase0TaskWorker, TaskExecutionContext } from "../../src/phase0/ports.js";
import { createPhase0Stack, stackPaths, type Phase0Stack, type Phase0StackOptions } from "../../src/phase0/runtime.js";
import { LocalTemplateDbSeeder } from "../../src/phase0/template-db.js";
import { LocalJobObjectAudit, LocalTestEnvOrchestrator } from "../../src/phase0/test-env.js";
import type { Phase0Plan } from "../../src/phase0/types.js";
import { FoundationGate0Verifier } from "../../src/phase0/verifier.js";
import { DefaultPhase0Worker } from "../../src/phase0/worker.js";
import { filesForTask } from "../../src/phase0/foundation-files.js";
import { NodeCommandRunner } from "../../src/phase0/command-runner.js";

export interface OpenedStack {
  readonly root: string;
  readonly metaRoot: string;
  readonly stack: Phase0Stack;
  cleanup(): Promise<void>;
}

export async function openStack(
  name: string,
  options: Omit<Phase0StackOptions, "root" | "statePath" | "slotsRoot"> = {},
): Promise<OpenedStack> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `ef-p0-${name}-`));
  const paths = stackPaths(root);
  const stack = await createPhase0Stack({ ...paths, ...options, initRepo: options.initRepo !== false });
  return {
    root,
    metaRoot: paths.metaRoot,
    stack,
    async cleanup(): Promise<void> {
      await stack.dispose();
      await rmTemp(root);
      await rmTemp(paths.metaRoot);
      await rmTemp(paths.slotsRoot);
    },
  };
}

export function countingWorker(inner: Phase0TaskWorker = new DefaultPhase0Worker()): {
  readonly calls: { taskId: string; mode: string }[];
  readonly worker: Phase0TaskWorker;
} {
  const calls: { taskId: string; mode: string }[] = [];
  return {
    calls,
    worker: {
      async execute(context: TaskExecutionContext) {
        calls.push({ taskId: context.task.id, mode: context.mode });
        return inner.execute(context);
      },
    },
  };
}

export function subset(plan: Phase0Plan, ids: readonly string[]): Phase0Plan {
  const want = new Set(ids);
  return { ...plan, recipes: plan.recipes.filter((recipe) => want.has(recipe.id)) };
}

export async function seedWebRepo(root: string): Promise<{ repo: GitIntegrationRepo; lockfileHash: string }> {
  const repo = await GitIntegrationRepo.init(root);
  const files: Record<string, string> = {};
  for (const id of ["P0.1", "P0.2", "P0.3", "P0.4", "P0.5", "P0.6", "P0.7", "P0.8"]) {
    Object.assign(files, filesForTask(id, "web_saas"));
  }
  const lockfile = canonicalLockfile([]);
  files["pnpm-lock.yaml"] = lockfile;
  await writeTree(root, files);
  await repo.commitAll(root, "phase0: seed foundation");
  return { repo, lockfileHash: lockfileHash(lockfile) };
}

export function verifierFor(
  repo: GitIntegrationRepo,
  options: { readonly leakTeardowns?: number; readonly exits?: ReadonlyMap<string, number> } = {},
): { verifier: FoundationGate0Verifier; testEnv: LocalTestEnvOrchestrator; cas: MemoryContentStore } {
  const testEnv = new LocalTestEnvOrchestrator(options.leakTeardowns ?? 0);
  const cas = new MemoryContentStore();
  const inner = new NodeCommandRunner();
  const commands = options.exits
    ? new (class {
        async run(request: { id: string; display: string; argv: readonly string[] }, cwd: string) {
          const forced = options.exits?.get(request.id);
          if (forced === undefined) return inner.run(request, cwd);
          return { exitCode: forced, stdout: "", stderr: `${request.id} failed`, durationMs: 1 };
        }
      })()
    : inner;
  const verifier = new FoundationGate0Verifier({
    repo,
    commands,
    testEnv,
    templateDb: new LocalTemplateDbSeeder(),
    gitleaks: new LocalGitleaksScanner(),
    jobs: new LocalJobObjectAudit(),
    cas,
  });
  return { verifier, testEnv, cas };
}

export async function rmTemp(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 7) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}
