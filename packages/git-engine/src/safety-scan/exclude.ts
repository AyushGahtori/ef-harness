import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveGitPath, createDefaultGitRunner } from "./git-runner.js";
import { GitSafetyError, HARNESS_EXCLUDE_ENTRIES } from "./types.js";
import type { EnsureExcludeResult, GitRunner } from "./types.js";

export interface EnsureExcludeOptions {
  readonly git?: GitRunner;
  readonly skillFolders?: readonly string[];
}

function normalizeEntry(entry: string): string {
  return entry.trim().replaceAll("\\", "/").replace(/\/+$/, "");
}

export function normalizeSkillFolder(folder: string): string {
  const normalized = folder.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.includes("..") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new GitSafetyError("skill folder must stay inside the repository");
  }
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

async function resolveExcludePath(repoRoot: string, git: GitRunner): Promise<string> {
  const fromGit = await resolveGitPath(git, repoRoot, "info/exclude");
  if (fromGit) return fromGit;
  const gitMeta = path.join(repoRoot, ".git");
  let stat;
  try {
    stat = await lstat(gitMeta);
  } catch {
    throw new GitSafetyError("repository has no .git directory");
  }
  if (stat.isSymbolicLink()) {
    throw new GitSafetyError("refusing to follow a .git symlink");
  }
  if (stat.isFile()) {
    const text = await readFile(gitMeta, "utf8");
    const match = /^gitdir:\s*(.+)$/m.exec(text);
    const gitdir = match?.[1]?.trim();
    if (!gitdir) throw new GitSafetyError("unreadable gitdir pointer");
    return path.join(path.resolve(repoRoot, gitdir), "info", "exclude");
  }
  if (!stat.isDirectory()) {
    throw new GitSafetyError("repository has no .git directory");
  }
  return path.join(gitMeta, "info", "exclude");
}

export async function ensureGitInfoExclude(
  repoRoot: string,
  options: EnsureExcludeOptions = {},
): Promise<EnsureExcludeResult> {
  const root = path.resolve(repoRoot);
  const git = options.git ?? createDefaultGitRunner();
  const excludePath = await resolveExcludePath(root, git);
  const wanted = [
    ...HARNESS_EXCLUDE_ENTRIES,
    ...(options.skillFolders ?? []).map((folder) => normalizeSkillFolder(folder)),
  ];
  let existing = "";
  try {
    const stat = await lstat(excludePath);
    if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024 * 1024) {
      existing = await readFile(excludePath, "utf8");
    }
  } catch {
    existing = "";
  }
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];
  const present = new Set(lines.map((line) => normalizeEntry(line)).filter((line) => line.length > 0 && !line.startsWith("#")));
  const added: string[] = [];
  const alreadyPresent: string[] = [];
  for (const entry of wanted) {
    const key = normalizeEntry(entry);
    if (present.has(key)) {
      alreadyPresent.push(entry.endsWith("/") ? entry : `${entry}/`);
      continue;
    }
    const stored = entry.endsWith("/") ? entry : `${entry}/`;
    added.push(stored);
    present.add(key);
  }
  if (added.length === 0) {
    return { excludePath, added, alreadyPresent };
  }
  await mkdir(path.dirname(excludePath), { recursive: true });
  let next = existing.replaceAll("\r\n", "\n");
  if (next.length === 0) {
    next = `# ef-harness local exclude\n${added.join("\n")}\n`;
  } else {
    if (!next.endsWith("\n")) next += "\n";
    next += `${added.join("\n")}\n`;
  }
  await writeFile(excludePath, next, "utf8");
  return { excludePath, added, alreadyPresent };
}
