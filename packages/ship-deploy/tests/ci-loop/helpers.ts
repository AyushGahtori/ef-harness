import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGit } from "../../src/ci-loop/git-runner.js";

export type Sandbox = {
  readonly root: string;
  readonly env: NodeJS.ProcessEnv;
};

export function makeSandbox(): Sandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-ship-178-"));
  return { root, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } };
}

export function removeSandbox(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

export async function initRepo(sandbox: Sandbox): Promise<string> {
  const repo = path.join(sandbox.root, "repo");
  fs.mkdirSync(repo, { recursive: true });
  await runGit(repo, ["init", "-b", "main"]);
  await runGit(repo, ["config", "user.email", "ship@test.local"]);
  await runGit(repo, ["config", "user.name", "Ship Test"]);
  return repo;
}

export async function writeAndCommit(repo: string, relativePath: string, content: string, message: string): Promise<void> {
  const full = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
  await runGit(repo, ["add", relativePath]);
  await runGit(repo, ["commit", "-m", message]);
}
