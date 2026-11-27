import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
  const output = execFileSync("which", ["git"], {
    encoding: "utf8",
  });
  const found = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!found) throw new Error("System Git was not found on PATH.");
  cachedGit = found;
  return found;
}

export interface Sandbox {
  readonly root: string;
  readonly env: NodeJS.ProcessEnv;
  readonly git: string;
}

export function makeSandbox(options?: { readonly identity?: boolean }): Sandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-task-035-"));
  const identity = options?.identity !== false;
  const globalConfig = path.join(root, "global.gitconfig");
  const systemConfig = path.join(root, "system.gitconfig");
  fs.writeFileSync(
    globalConfig,
    identity ? "[user]\n\tname = Test User\n\temail = test@example.com\n" : "",
  );
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
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_NAMESPACE", "GIT_PREFIX"]) {
    delete env[key];
  }
  return { root, env, git: systemGit() };
}

export function removeSandbox(root: string): void {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 });
}

export interface RawGitResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export function rawGit(
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  input?: string,
): RawGitResult {
  const result = spawnSync(systemGit(), [...args], {
    cwd,
    env,
    input,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  return {
    code: result.status,
    stdout: result.stdout ?? "",
    stderr: `${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`,
  };
}

export function gitOk(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv, input?: string): RawGitResult {
  const result = rawGit(cwd, args, env, input);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${result.code}): ${result.stderr || result.stdout}`);
  }
  return result;
}

export function initRepo(cwd: string, env: NodeJS.ProcessEnv): void {
  fs.mkdirSync(cwd, { recursive: true });
  gitOk(cwd, ["init", "-b", "main"], env);
}

export function commitFile(
  cwd: string,
  env: NodeJS.ProcessEnv,
  fileName: string,
  contents: string,
  message: string,
): void {
  fs.mkdirSync(path.dirname(path.join(cwd, fileName)), { recursive: true });
  fs.writeFileSync(path.join(cwd, fileName), contents);
  gitOk(cwd, ["add", "--", fileName], env);
  gitOk(cwd, ["commit", "-m", message], env);
}

export function seedRepo(cwd: string, env: NodeJS.ProcessEnv): void {
  initRepo(cwd, env);
  commitFile(cwd, env, "README.md", "hello\n", "init");
}

export function gitPath(cwd: string, env: NodeJS.ProcessEnv, name: string): string {
  const printed = gitOk(cwd, ["rev-parse", "--git-path", name], env);
  return path.resolve(cwd, printed.stdout.trim().replaceAll('"', ""));
}
