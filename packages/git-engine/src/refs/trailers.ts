import type { GitExecRequest, GitExecResult, GitRunner } from "./git-runner.js";
import { stripTrailingNewline } from "./git-runner.js";
import { GitCommandError, InvalidRefLeaseArgumentError } from "./errors.js";
import { classifyAutomatedWrite, isSha } from "./namespace.js";

export interface HarnessCommitTrailers {
  readonly feature: string;
  readonly task: string;
  readonly attempt: string;
  readonly checks: string;
}

export interface ParsedHarnessTrailers {
  readonly feature: string | null;
  readonly task: string | null;
  readonly attempt: string | null;
  readonly checks: string | null;
}

export interface AcceptedHarnessCommit {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly taskId: string;
  readonly checkReceipt: string;
  readonly featureId: string | null;
  readonly attempt: string | null;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly committerName: string;
  readonly committerEmail: string;
  readonly trailers: ParsedHarnessTrailers;
}

export interface FindAcceptedCommitsInput {
  readonly sinceSha: string;
  readonly untilRef?: string;
}

export function assertHarnessTrailers(trailers: HarnessCommitTrailers): void {
  assertTrailerValue("Harness-Feature", trailers.feature);
  assertTrailerValue("Harness-Task", trailers.task);
  assertTrailerValue("Harness-Attempt", trailers.attempt);
  assertTrailerValue("Harness-Checks", trailers.checks);
}

export function parseHarnessTrailers(message: string): ParsedHarnessTrailers {
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const block: string[] = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (line === "") {
      if (block.length === 0) continue;
      break;
    }
    if (/^[ \t]/.test(line) || /^[A-Za-z0-9-]+[ \t]*:[ \t]/.test(line)) {
      block.push(line);
      continue;
    }
    break;
  }
  block.reverse();
  const values = new Map<string, string>();
  let currentKey: string | null = null;
  for (const line of block) {
    const match = /^([A-Za-z0-9-]+)[ \t]*:[ \t]+(.*)$/.exec(line);
    if (match) {
      currentKey = match[1] ?? null;
      if (currentKey) values.set(currentKey, (match[2] ?? "").trim());
      continue;
    }
    if (currentKey && /^[ \t]/.test(line)) {
      const previous = values.get(currentKey) ?? "";
      values.set(currentKey, `${previous} ${line.trim()}`.trim());
    }
  }
  return {
    feature: values.get("Harness-Feature") ?? null,
    task: values.get("Harness-Task") ?? null,
    attempt: values.get("Harness-Attempt") ?? null,
    checks: values.get("Harness-Checks") ?? null,
  };
}

export async function renderCommitMessage(
  git: GitRunner,
  repoPath: string,
  message: string,
  trailers: HarnessCommitTrailers,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  assertHarnessTrailers(trailers);
  if (message.length === 0 || message.includes("\0")) {
    throw new InvalidRefLeaseArgumentError("Commit message must be a non-empty string without NUL bytes.");
  }
  const body = message.replace(/\r\n/g, "\n");
  const stdin = body.endsWith("\n") ? body : `${body}\n`;
  const result = await execGit(git, repoPath, [
    "interpret-trailers",
    "--if-exists",
    "add",
    "--if-missing",
    "add",
    "--where",
    "end",
    "--trailer",
    `Harness-Feature: ${trailers.feature}`,
    "--trailer",
    `Harness-Task: ${trailers.task}`,
    "--trailer",
    `Harness-Attempt: ${trailers.attempt}`,
    "--trailer",
    `Harness-Checks: ${trailers.checks}`,
  ], stdin, env);
  if (result.exitCode !== 0) {
    throw new GitCommandError("interpret-trailers", result.exitCode, result.stderr);
  }
  return result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`;
}

export async function findAcceptedCommitsSince(
  git: GitRunner,
  repoPath: string,
  input: FindAcceptedCommitsInput,
  env?: NodeJS.ProcessEnv,
): Promise<readonly AcceptedHarnessCommit[]> {
  const sinceSha = input.sinceSha.trim().toLowerCase();
  if (!isSha(sinceSha)) {
    throw new InvalidRefLeaseArgumentError("sinceSha must be a 40-character hexadecimal SHA.");
  }
  const untilRef = input.untilRef ?? "refs/heads/harness/integration";
  classifyAutomatedWrite(untilRef, "refs/heads/main", undefined, Date.now());
  const listed = await execGit(git, repoPath, ["rev-list", "--reverse", `${sinceSha}..${untilRef}`], undefined, env);
  if (listed.exitCode !== 0) {
    throw new GitCommandError("rev-list", listed.exitCode, listed.stderr);
  }
  const shas = stripTrailingNewline(listed.stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const accepted: AcceptedHarnessCommit[] = [];
  for (const sha of shas) {
    const record = await readCommitRecord(git, repoPath, sha, env);
    const trailers = parseHarnessTrailers(record.body);
    if (!trailers.task || !trailers.checks) continue;
    accepted.push({
      sha,
      parents: record.parents,
      taskId: trailers.task,
      checkReceipt: trailers.checks,
      featureId: trailers.feature,
      attempt: trailers.attempt,
      authorName: record.authorName,
      authorEmail: record.authorEmail,
      committerName: record.committerName,
      committerEmail: record.committerEmail,
      trailers,
    });
  }
  return accepted;
}

export async function readCommitParents(
  git: GitRunner,
  repoPath: string,
  sha: string,
  env?: NodeJS.ProcessEnv,
): Promise<readonly string[]> {
  return (await readCommitRecord(git, repoPath, sha, env)).parents;
}

interface CommitRecord {
  readonly parents: readonly string[];
  readonly authorName: string;
  readonly authorEmail: string;
  readonly committerName: string;
  readonly committerEmail: string;
  readonly body: string;
}

async function readCommitRecord(
  git: GitRunner,
  repoPath: string,
  sha: string,
  env?: NodeJS.ProcessEnv,
): Promise<CommitRecord> {
  const meta = await execGit(
    git,
    repoPath,
    ["log", "-1", "--format=%P%x1f%an%x1f%ae%x1f%cn%x1f%ce", sha],
    undefined,
    env,
  );
  if (meta.exitCode !== 0) {
    throw new GitCommandError("log", meta.exitCode, meta.stderr);
  }
  const body = await execGit(git, repoPath, ["log", "-1", "--format=%B", sha], undefined, env);
  if (body.exitCode !== 0) {
    throw new GitCommandError("log", body.exitCode, body.stderr);
  }
  const parts = stripTrailingNewline(meta.stdout).split("\x1f");
  const parents = (parts[0] ?? "")
    .split(" ")
    .map((parent) => parent.trim().toLowerCase())
    .filter((parent) => isSha(parent));
  return {
    parents,
    authorName: parts[1] ?? "",
    authorEmail: parts[2] ?? "",
    committerName: parts[3] ?? "",
    committerEmail: parts[4] ?? "",
    body: body.stdout,
  };
}

function assertTrailerValue(name: string, value: string): void {
  if (value.length === 0 || /[\r\n\0]/.test(value) || value.trim() !== value) {
    throw new InvalidRefLeaseArgumentError(`${name} must be a single-line trailer value.`);
  }
}

function execGit(
  git: GitRunner,
  repoPath: string,
  args: readonly string[],
  stdin: string | undefined,
  env: NodeJS.ProcessEnv | undefined,
): Promise<GitExecResult> {
  const request: GitExecRequest = {
    cwd: repoPath,
    args,
    ...(stdin !== undefined ? { stdin } : {}),
    ...(env !== undefined ? { env } : {}),
  };
  return git.execGit(request);
}
