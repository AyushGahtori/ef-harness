import { spawnSync } from "node:child_process";

export function runGit(cwd: string, args: string[]): { readonly ok: boolean; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function runGitOrThrow(cwd: string, args: string[]): string {
  const result = runGit(cwd, args);
  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

export function twoStepCaseRename(cwd: string, fromPath: string, toPath: string): void {
  const tmp = `${fromPath}.__tmp`;
  runGitOrThrow(cwd, ["mv", fromPath, tmp]);
  runGitOrThrow(cwd, ["mv", tmp, toPath]);
}