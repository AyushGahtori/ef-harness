import type { AuditFileInput, DiffFileStatus, GitRunnerPort, PreparedAuditFile } from "./types.js";
import { countLineDiff } from "./line-diff.js";
import { lineCount, normalizePath } from "./paths.js";

export interface NameStatusEntry {
  readonly status: DiffFileStatus;
  readonly path: string;
  readonly oldPath?: string;
}

export function parseNameStatusZ(stdout: string): NameStatusEntry[] {
  const parts = stdout.split("\0").filter((part) => part.length > 0);
  const entries: NameStatusEntry[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const header = parts[index] ?? "";
    const code = header[0];
    if (!code) continue;
    if (code === "R" || code === "C") {
      const oldPath = parts[index + 1];
      const newPath = parts[index + 2];
      index += 2;
      if (oldPath && newPath) {
        entries.push({ status: "M", path: normalizePath(newPath), oldPath: normalizePath(oldPath) });
      }
      continue;
    }
    const filePath = parts[index + 1];
    index += 1;
    if (!filePath) continue;
    if (code === "A") entries.push({ status: "A", path: normalizePath(filePath) });
    else if (code === "D") entries.push({ status: "D", path: normalizePath(filePath) });
    else entries.push({ status: "M", path: normalizePath(filePath) });
  }
  return entries;
}

export function parseNumstatZ(stdout: string): Map<string, { readonly additions: number; readonly deletions: number }> {
  const stats = new Map<string, { readonly additions: number; readonly deletions: number }>();
  for (const record of stdout.split("\0")) {
    if (!record.trim()) continue;
    const [additions, deletions, rawPath] = record.split("\t");
    if (!rawPath || additions === undefined || deletions === undefined) continue;
    const path = normalizeNumstatPath(rawPath);
    const parsed = {
      additions: parseStat(additions),
      deletions: parseStat(deletions),
    };
    stats.set(path, parsed);
  }
  return stats;
}

function parseStat(value: string): number {
  if (value === "-") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeNumstatPath(raw: string): string {
  const brace = /^(.*)\{.* => (.*)\}(.*)$/.exec(raw);
  if (brace) {
    return normalizePath(`${brace[1] ?? ""}${brace[2] ?? ""}${brace[3] ?? ""}`);
  }
  const arrow = / => (.*)$/.exec(raw);
  if (arrow?.[1]) return normalizePath(arrow[1].trim());
  return normalizePath(raw.trim());
}

export function prepareAuditFile(file: AuditFileInput): PreparedAuditFile {
  const status: DiffFileStatus = file.status === "A" || file.status === "D" ? file.status : "M";
  const content = file.content ?? "";
  const previousContent = file.previousContent ?? "";
  const computed = countLineDiff(previousContent, content);
  const additions = file.additions ?? (status === "D" ? 0 : computed.additions || (status === "A" ? lineCount(content) : computed.additions));
  const deletions =
    file.deletions ?? (status === "D" ? Math.max(lineCount(previousContent), lineCount(content)) : computed.deletions);
  return {
    path: normalizePath(file.path),
    status,
    content,
    previousContent,
    additions,
    deletions,
    originalLines: status === "A" ? 0 : lineCount(previousContent),
  };
}

export async function loadDiffFromGit(input: {
  readonly gitRunner: GitRunnerPort;
  readonly repoRoot: string;
  readonly baseRef: string;
  readonly candidateRef: string;
}): Promise<PreparedAuditFile[]> {
  const nameStatus = await input.gitRunner.execGit(
    ["diff", "--name-status", "--find-renames", "-z", input.baseRef, input.candidateRef],
    { cwd: input.repoRoot },
  );
  if (nameStatus.exitCode !== 0) {
    throw new Error(nameStatus.stderr.trim() || "git diff --name-status failed");
  }
  const numstat = await input.gitRunner.execGit(
    ["diff", "--numstat", "--find-renames", "-z", input.baseRef, input.candidateRef],
    { cwd: input.repoRoot },
  );
  const stats = numstat.exitCode === 0 ? parseNumstatZ(numstat.stdout) : new Map();
  const entries = parseNameStatusZ(nameStatus.stdout);
  const files: PreparedAuditFile[] = [];
  for (const entry of entries) {
    if (entry.status === "D") {
      const previousContent = await readGitPath(input.gitRunner, input.repoRoot, input.baseRef, entry.oldPath ?? entry.path);
      const stat = stats.get(entry.path);
      files.push(
        prepareAuditFile({
          path: entry.path,
          status: "D",
          content: "",
          previousContent,
          additions: stat?.additions ?? 0,
          deletions: stat?.deletions ?? lineCount(previousContent),
        }),
      );
      continue;
    }
    const content = await readGitPath(input.gitRunner, input.repoRoot, input.candidateRef, entry.path);
    const previousContent =
      entry.status === "A"
        ? ""
        : await readGitPath(input.gitRunner, input.repoRoot, input.baseRef, entry.oldPath ?? entry.path);
    const stat = stats.get(entry.path);
    const inputFile: AuditFileInput = {
      path: entry.path,
      status: entry.status,
      content,
      previousContent,
    };
    files.push(
      prepareAuditFile(
        stat
          ? { ...inputFile, additions: stat.additions, deletions: stat.deletions }
          : inputFile,
      ),
    );
  }
  return files;
}

async function readGitPath(
  gitRunner: GitRunnerPort,
  repoRoot: string,
  ref: string,
  filePath: string,
): Promise<string> {
  const shown = await gitRunner.execGit(["show", `${ref}:${normalizePath(filePath)}`], { cwd: repoRoot });
  if (shown.exitCode !== 0) return "";
  return shown.stdout;
}
