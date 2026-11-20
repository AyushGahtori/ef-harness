import { execGit } from "./exec-git.js";
import { GitCommandError, type CaseCollisionReport, type DetectCaseCollisionsOptions } from "./types.js";

export async function detectCaseCollisions(options: DetectCaseCollisionsOptions): Promise<CaseCollisionReport> {
  const revision = options.revision ?? "HEAD";
  const result = await execGit({
    args: ["ls-tree", "-r", "--name-only", revision],
    cwd: options.cwd,
    developerCheckout: options.developerCheckout ?? true,
    ...(options.gitBinary !== undefined ? { gitBinary: options.gitBinary } : {}),
    ...(options.resourcesRoot !== undefined ? { resourcesRoot: options.resourcesRoot } : {}),
    ...(options.settingsGitPath !== undefined ? { settingsGitPath: options.settingsGitPath } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
  if (result.exitCode !== 0) {
    throw new GitCommandError(
      `git ls-tree failed for ${revision}`,
      result.exitCode,
      result.stderr,
    );
  }
  const paths = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const groups = new Map<string, string[]>();
  for (const filePath of paths) {
    const key = filePath.replaceAll("\\", "/").toLocaleLowerCase("en-US");
    const existing = groups.get(key);
    if (existing) existing.push(filePath.replaceAll("\\", "/"));
    else groups.set(key, [filePath.replaceAll("\\", "/")]);
  }
  const collisions = [...groups.entries()]
    .map(([key, found]) => ({
      key,
      paths: [...new Set(found)].sort((left, right) => left.localeCompare(right)),
    }))
    .filter((entry) => entry.paths.length > 1)
    .sort((left, right) => left.key.localeCompare(right.key));
  return { collisions };
}
