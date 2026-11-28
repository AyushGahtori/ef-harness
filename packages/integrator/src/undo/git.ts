import { spawnSync } from "node:child_process";
import { EF_TRAILER_KEYS, INTEGRATION_BRANCH } from "./constants.js";
import { GitCommandError, HistoryRewriteError } from "./errors.js";
import type { EfTrailers, FileChange, FileStatus } from "./types.js";

export interface GitResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const IDENTITY = {
  name: "Feature Undo",
  email: "feature-undo@ef-harness.local",
};

const FORBIDDEN = new Set(["reset", "rebase", "filter-branch", "filter-repo"]);

export class GitRepo {
  constructor(
    readonly repo: string,
    readonly commands: string[] = [],
  ) {}

  child(repo: string): GitRepo {
    return new GitRepo(repo, this.commands);
  }

  run(args: readonly string[], input?: string): GitResult {
    assertAllowed(args);
    this.commands.push(args.join(" "));
    return runGit(this.repo, args, input);
  }

  ok(args: readonly string[], input?: string): GitResult {
    const result = this.run(args, input);
    if (result.status !== 0) {
      throw new GitCommandError(args[0] ?? "git", result.status, result.stderr || result.stdout);
    }
    return result;
  }

  revParse(ref: string): string {
    return this.ok(["rev-parse", "--verify", ref]).stdout.trim();
  }

  parents(sha: string): string[] {
    const raw = this.ok(["rev-list", "--parents", "-n", "1", sha]).stdout.trim();
    return raw.split(/\s+/).slice(1);
  }

  isAncestor(ancestor: string, descendant: string): boolean {
    return this.run(["merge-base", "--is-ancestor", ancestor, descendant]).status === 0;
  }

  commitMessage(sha: string): string {
    return this.ok(["log", "-1", "--format=%B", sha]).stdout;
  }

  integrationSha(): string {
    return this.revParse(INTEGRATION_BRANCH);
  }
}

export function runGit(repo: string, args: readonly string[], input?: string): GitResult {
  const result = spawnSync(
    "git",
    [
      "-C",
      repo,
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.longpaths=true",
      "-c",
      "core.quotepath=false",
      "-c",
      "commit.gpgsign=false",
      "-c",
      `user.name=${IDENTITY.name}`,
      "-c",
      `user.email=${IDENTITY.email}`,
      ...args,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      shell: false,
      input,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_AUTHOR_NAME: IDENTITY.name,
        GIT_AUTHOR_EMAIL: IDENTITY.email,
        GIT_COMMITTER_NAME: IDENTITY.name,
        GIT_COMMITTER_EMAIL: IDENTITY.email,
      },
    },
  );
  if (result.error) {
    throw new GitCommandError(args[0] ?? "git", 127, result.error.message);
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function assertAllowed(args: readonly string[]): void {
  const command = args[0] ?? "";
  if (FORBIDDEN.has(command)) {
    throw new HistoryRewriteError(args.join(" "));
  }
  if (command === "push" && args.some((arg) => arg === "--force" || arg === "-f" || arg.startsWith("+"))) {
    throw new HistoryRewriteError(args.join(" "));
  }
}

export function assertForwardCommit(git: GitRepo, newSha: string, oldSha: string): void {
  const parents = git.parents(newSha);
  if (!parents.includes(oldSha)) {
    throw new HistoryRewriteError(`update-ref ${newSha} is not a forward child of ${oldSha}`);
  }
  if (git.isAncestor(newSha, oldSha)) {
    throw new HistoryRewriteError(`update-ref would move harness/integration backwards to ${newSha}`);
  }
}

export function parseEfTrailers(message: string): EfTrailers | null {
  const values = new Map<string, string>();
  for (const line of message.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line.trim());
    if (!match?.[1]) continue;
    values.set(match[1], (match[2] ?? "").trim());
  }
  for (const key of EF_TRAILER_KEYS) {
    if (!values.get(key)) return null;
  }
  return {
    feature: values.get("EF-Feature") ?? "",
    tasks: splitList(values.get("EF-Tasks") ?? ""),
    requirements: splitList(values.get("EF-Requirements") ?? ""),
    checksPassed: values.get("EF-Checks-Passed") ?? "",
    harnessVersion: values.get("EF-Harness-Version") ?? "",
  };
}

export function renderTrailers(subject: string, body: string, trailers: EfTrailers, extra: readonly (readonly [string, string])[] = []): string {
  const lines = [
    subject.trim(),
    "",
    body.trim(),
    "",
    `EF-Feature: ${trailers.feature}`,
    `EF-Tasks: ${trailers.tasks.join(",")}`,
    `EF-Requirements: ${trailers.requirements.join(",")}`,
    `EF-Checks-Passed: ${trailers.checksPassed}`,
    `EF-Harness-Version: ${trailers.harnessVersion}`,
  ];
  for (const [key, value] of extra) lines.push(`${key}: ${value}`);
  return `${lines.join("\n")}\n`;
}

export function featureDiff(git: GitRepo, mergeSha: string): FileChange[] {
  const raw = git.ok(["diff", "--name-status", "--find-renames", `${mergeSha}^1`, mergeSha]).stdout;
  const changes: FileChange[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    const code = parts[0] ?? "";
    const status = normalizeStatus(code);
    if (!status) continue;
    const filePath = status === "A" && code.startsWith("R") ? parts[2] : parts[parts.length - 1];
    if (!filePath) continue;
    changes.push({ path: filePath.replaceAll("\\", "/"), status });
  }
  return changes;
}

export function listTree(git: GitRepo, ref: string): string[] {
  const raw = git.ok(["ls-tree", "-r", "--name-only", ref]).stdout;
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().replaceAll("\\", "/"))
    .filter((line) => line.length > 0);
}

export function readBlob(git: GitRepo, ref: string, filePath: string): string | null {
  const result = git.run(["show", `${ref}:${filePath}`]);
  if (result.status !== 0) return null;
  if (result.stdout.includes("\u0000")) return null;
  return result.stdout;
}

export function commitsTouching(git: GitRepo, fromSha: string, toRef: string, filePath: string): string[] {
  const raw = git.ok(["rev-list", `${fromSha}..${toRef}`, "--", filePath]).stdout;
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function addedLines(git: GitRepo, mergeSha: string, filePath: string): string[] {
  const result = git.run(["diff", "--unified=0", `${mergeSha}^1`, mergeSha, "--", filePath]);
  const added: string[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
    if (line.startsWith("+")) added.push(line.slice(1));
  }
  return added;
}

export function revertConflicts(git: GitRepo, mergeSha: string, head: string): string[] {
  const result = git.run(["merge-tree", "--write-tree", `--merge-base=${mergeSha}`, head, `${mergeSha}^1`]);
  const text = `${result.stdout}\n${result.stderr}`;
  if (/unknown option|usage: git merge-tree/i.test(text)) {
    throw new GitCommandError("merge-tree", result.status, text);
  }
  const paths = new Set<string>();
  for (const match of text.matchAll(/Merge conflict in (\S+)/g)) {
    const found = match[1];
    if (found) paths.add(found);
  }
  if (result.status !== 0 && paths.size === 0) paths.add("(conflict)");
  if (result.status === 0) return [];
  return [...paths];
}

export function forEachRef(git: GitRepo, prefix: string): { ref: string; sha: string }[] {
  const result = git.run(["for-each-ref", "--format=%(objectname) %(refname)", prefix]);
  if (result.status !== 0) return [];
  const rows: { ref: string; sha: string }[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const space = trimmed.indexOf(" ");
    if (space <= 0) continue;
    rows.push({ sha: trimmed.slice(0, space), ref: trimmed.slice(space + 1) });
  }
  return rows;
}

function normalizeStatus(code: string): FileStatus | null {
  if (code.startsWith("A")) return "A";
  if (code.startsWith("M") || code.startsWith("R") || code.startsWith("C")) return "M";
  if (code.startsWith("D")) return "D";
  return null;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function findFeatureMerge(git: GitRepo, featureId: string, explicitSha: string): string {
  if (explicitSha) {
    const parsed = git.run(["rev-parse", "--verify", `${explicitSha}^{commit}`]);
    if (parsed.status === 0) return parsed.stdout.trim();
  }
  const raw = git.ok(["log", "--merges", `--format=%H%x1f%B%x1e`, INTEGRATION_BRANCH]).stdout;
  const matches: string[] = [];
  for (const entry of raw.split("\u001e")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const splitAt = trimmed.indexOf("\u001f");
    if (splitAt < 0) continue;
    const sha = trimmed.slice(0, splitAt).trim();
    const body = trimmed.slice(splitAt + 1);
    if (parseEfTrailers(body)?.feature === featureId && sha) matches.push(sha);
  }
  return matches[matches.length - 1] ?? "";
}

export function featureOfCommit(git: GitRepo, sha: string): string {
  return parseEfTrailers(git.commitMessage(sha))?.feature ?? "";
}
