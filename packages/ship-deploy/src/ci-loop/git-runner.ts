import { execGit } from "@ef-harness/git-engine";

export async function runGit(
  cwd: string,
  args: string[],
): Promise<{ readonly ok: boolean; readonly stdout: string; readonly stderr: string }> {
  const result = await execGit({
    cwd,
    args,
    developerCheckout: false,
  });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function runGitOrThrow(cwd: string, args: string[]): Promise<string> {
  const result = await runGit(cwd, args);
  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

export async function twoStepCaseRename(cwd: string, fromPath: string, toPath: string): Promise<void> {
  const tmp = `${fromPath}.__tmp`;
  await runGitOrThrow(cwd, ["mv", fromPath, tmp]);
  await runGitOrThrow(cwd, ["mv", tmp, toPath]);
}
