import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { errorCode, errorMessage } from "./fs-error.js";

export const GIT_EXCLUDE_ENTRY = ".harness/views/";

const ACCEPTED_ENTRIES = new Set([
  ".harness/views/",
  ".harness/views",
  "/.harness/views/",
  "/.harness/views",
]);

export type GitRunner = (projectRoot: string, args: readonly string[]) => Promise<string>;

/**
 * Ensures `.harness/views/` is listed in the repo-local exclude file.
 * Resolves the path with `git rev-parse --git-path info/exclude` so linked
 * worktrees and normal clones share the same rule. Never edits `.gitignore`.
 */
export class GitExcludeGuard {
  constructor(private readonly runGit: GitRunner = defaultGit) {}

  async ensure(projectRoot: string): Promise<string> {
    let printed: string;
    try {
      printed = (await this.runGit(projectRoot, ["rev-parse", "--git-path", "info/exclude"])).trim();
    } catch (error) {
      throw new Error(`GitExcludeGuard could not resolve info/exclude: ${errorMessage(error)}`);
    }
    if (printed.length === 0) {
      throw new Error("GitExcludeGuard could not resolve info/exclude: git returned an empty path");
    }
    const excludePath = path.isAbsolute(printed) ? printed : path.resolve(projectRoot, printed);
    await mkdir(path.dirname(excludePath), { recursive: true });
    let existing = "";
    try {
      existing = await readFile(excludePath, "utf8");
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    if (hasExcludeEntry(existing)) return excludePath;
    const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
    await writeFile(excludePath, `${existing}${prefix}${GIT_EXCLUDE_ENTRY}\n`, "utf8");
    return excludePath;
  }
}

export function hasExcludeEntry(text: string): boolean {
  return text.split(/\r?\n/).some((line) => ACCEPTED_ENTRIES.has(line.trim()));
}

async function defaultGit(projectRoot: string, args: readonly string[]): Promise<string> {
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      "git",
      [...args],
      { cwd: projectRoot, windowsHide: true, encoding: "utf8" },
      (error, out) => {
        if (error) reject(error);
        else resolve(out);
      },
    );
  });
  return stdout;
}
