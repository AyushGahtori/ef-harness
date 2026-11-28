import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetGitInvocationJournal } from "../../src/landing/git-runner.js";

let cachedGit: string | null = null;

export function systemGit(): string {
  if (cachedGit) return cachedGit;
  if (process.platform === "win32") {
    const output = execFileSync("where.exe", ["git"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const found = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.toLowerCase().endsWith("git.exe"));
    if (!found) throw new Error("System Git was not found on PATH.");
    cachedGit = found;
    return found;
  }
  cachedGit = "git";
  return cachedGit;
}

export interface Sandbox {
  readonly root: string;
  readonly env: NodeJS.ProcessEnv;
  readonly git: string;
}

export function makeSandbox(): Sandbox {
  resetGitInvocationJournal();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-task-172-"));
  const globalConfig = path.join(root, "global.gitconfig");
  const systemConfig = path.join(root, "system.gitconfig");
  fs.writeFileSync(globalConfig, "[user]\n\tname = Test User\n\temail = test@example.com\n");
  fs.writeFileSync(systemConfig, "");
  const ceiling = fs.realpathSync.native(path.dirname(root));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: root,
    USERPROFILE: root,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_SYSTEM: systemConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "0",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    GIT_CEILING_DIRECTORIES: ceiling,
    OneDrive: "",
    OneDriveCommercial: "",
    OneDriveConsumer: "",
  };
  return { root, env, git: systemGit() };
}

export function removeSandbox(root: string): void {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 });
}

export function rawGit(
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  input?: string,
): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync(systemGit(), ["-c", "core.longpaths=true", ...args], {
    cwd,
    env,
    input,
    encoding: "utf8",
    windowsHide: true,
  });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function initRepo(sandbox: Sandbox): string {
  const repo = path.join(sandbox.root, "repo");
  fs.mkdirSync(repo, { recursive: true });
  rawGit(repo, ["init", "-b", "main"], sandbox.env);
  rawGit(repo, ["config", "user.email", "test@example.com"], sandbox.env);
  rawGit(repo, ["config", "user.name", "Test User"], sandbox.env);
  writeAndCommit(repo, sandbox, "README.md", "# base\n");
  return repo;
}

export function writeAndCommit(repo: string, sandbox: Sandbox, file: string, body: string, message = "commit"): string {
  const full = path.join(repo, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  rawGit(repo, ["add", file], sandbox.env);
  rawGit(repo, ["commit", "-m", message], sandbox.env);
  return rawGit(repo, ["rev-parse", "HEAD"], sandbox.env).stdout.trim();
}

export function ensureHarnessIntegration(repo: string, sandbox: Sandbox): void {
  const head = rawGit(repo, ["rev-parse", "HEAD"], sandbox.env).stdout.trim();
  rawGit(repo, ["branch", "harness/integration", head], sandbox.env);
}

export function advanceHarness(repo: string, sandbox: Sandbox, file: string, body: string): string {
  rawGit(repo, ["checkout", "harness/integration"], sandbox.env);
  writeAndCommit(repo, sandbox, file, body);
  const sha = rawGit(repo, ["rev-parse", "HEAD"], sandbox.env).stdout.trim();
  rawGit(repo, ["checkout", "main"], sandbox.env);
  return sha;
}

export function stashListEmpty(repo: string, sandbox: Sandbox): boolean {
  return rawGit(repo, ["stash", "list"], sandbox.env).stdout.trim().length === 0;
}