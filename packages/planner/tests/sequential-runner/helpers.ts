import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  GitWorkspace,
  StateDb,
  type LeafDraft,
  type NativeWorkerLoopPort,
  type WorkerContext,
} from "../../src/sequential-runner/index.js";

export interface Lab {
  root: string;
  repo: string;
  db: StateDb;
  git: GitWorkspace;
  cleanup: () => void;
}

export function lab(): Lab {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef095-"));
  const repo = path.join(root, "repo");
  const git = new GitWorkspace(repo, path.join(root, "slots"));
  git.init();
  const db = StateDb.open(path.join(root, "state.db"));
  return {
    root,
    repo,
    db,
    git,
    cleanup() {
      db.close();
      git.dispose();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export function feature(env: Lab, id: string, wave: number): string {
  const branch = `harness/f/${id}`;
  env.git.branch(branch, "harness/integration");
  env.db.addFeature({ id, title: id, wave, branch });
  return branch;
}

export function task(env: Lab, input: LeafDraft): void {
  env.db.addLeafTask(input);
}

export function writingWorker(
  render: (context: WorkerContext) => string | null = (context) => `export const id = ${JSON.stringify(context.taskId)};\n`,
): NativeWorkerLoopPort {
  return {
    async run(context) {
      if (!context.tools.includes("kb.get_fact") || !context.tools.includes("harness.run")) {
        throw new Error("worker launched without kb pull tools and harness.run");
      }
      if (context.sandbox.network !== "deny" || context.sandbox.owner !== "task-045") {
        throw new Error("worker launched outside the task sandbox");
      }
      const body = render(context);
      if (body !== null) {
        const file = path.join(context.worktree, "src", `${context.taskId}.ts`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, body, "utf8");
      }
      return { ok: true, turns: 2, costMicroUsd: 1_500 };
    },
  };
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
