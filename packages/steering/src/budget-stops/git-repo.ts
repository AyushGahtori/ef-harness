import { spawnSync } from "node:child_process";

export interface GitResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const IDENTITY = {
  GIT_AUTHOR_NAME: "EF Harness",
  GIT_AUTHOR_EMAIL: "foundation@ef-harness.local",
  GIT_COMMITTER_NAME: "EF Harness",
  GIT_COMMITTER_EMAIL: "foundation@ef-harness.local",
  GIT_TERMINAL_PROMPT: "0",
};

export function runGit(repo: string, args: readonly string[]): GitResult {
  const result = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    env: { ...process.env, ...IDENTITY },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: `${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`,
  };
}

export function gitOrThrow(repo: string, args: readonly string[]): string {
  const result = runGit(repo, args);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`.trim());
  }
  return result.stdout.trim();
}

export function refExists(repo: string, ref: string): boolean {
  return runGit(repo, ["show-ref", "--verify", "--quiet", ref]).status === 0;
}

export const PROTECTED_HEADS = new Set([
  "main",
  "master",
  "harness/integration",
  "refs/heads/main",
  "refs/heads/master",
  "refs/heads/harness/integration",
]);

export function assertNotProtectedRef(ref: string): void {
  if (PROTECTED_HEADS.has(ref) || ref === "HEAD") {
    throw new Error(`refusing to rewrite protected ref ${ref}`);
  }
}
