import { createHash } from "node:crypto";
import { GitCommandFailedError } from "./errors.js";
import type { GitRunner } from "./git-runner.js";
import { LOCKFILE_NAMES } from "./types.js";
import { gitOptions } from "./git-ops.js";

export async function hashLockfilesAtCommit(
  git: GitRunner,
  repo: string,
  commit: string,
  consentToken: string | undefined,
): Promise<string> {
  const parts: string[] = [];
  for (const name of LOCKFILE_NAMES) {
    const spec = `${commit}:${name}`;
    const exists = await git.execGit(["cat-file", "-e", spec], gitOptions(repo, consentToken));
    if (exists.exitCode !== 0) {
      parts.push(`${name} absent`);
      continue;
    }
    const blob = await git.execGit(["cat-file", "blob", spec], gitOptions(repo, consentToken));
    if (blob.exitCode !== 0) {
      throw new GitCommandFailedError(["cat-file", "blob", spec], blob);
    }
    const digest = createHash("sha256").update(blob.stdout).digest("hex");
    parts.push(`${name} ${digest}`);
  }
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}
