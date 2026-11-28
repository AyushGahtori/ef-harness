import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertDeveloperCheckoutGitAllowed } from "./forbidden-git.js";
import type { GitRunRecord } from "./types.js";

const invocationJournal: GitRunRecord[] = [];

export function resetGitInvocationJournal(): void {
  invocationJournal.length = 0;
}

export function readGitInvocationJournal(): readonly GitRunRecord[] {
  return [...invocationJournal];
}

export interface RunGitOptions {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly input?: string;
  readonly developerCheckout?: boolean;
}

export interface RunGitResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export function runGit(options: RunGitOptions): RunGitResult {
  const developerCheckout = options.developerCheckout ?? true;
  if (developerCheckout) {
    assertDeveloperCheckoutGitAllowed(options.args);
  }
  const argv = [
    "-c",
    "core.longpaths=true",
    "-c",
    "core.quotepath=false",
    "-c",
    "core.editor=true",
    ...options.args,
  ];
  const env = { ...(options.env ?? process.env), GIT_EDITOR: "true", GIT_MERGE_AUTOEDIT: "no" };
  const result = spawnSync("git", argv, {
    cwd: options.cwd,
    env,
    input: options.input,
    encoding: "utf8",
    windowsHide: true,
  });
  const record: GitRunRecord = { argv: options.args, exitCode: result.status };
  if (developerCheckout) invocationJournal.push(record);
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function runGitOrThrow(options: RunGitOptions): RunGitResult {
  const result = runGit(options);
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${options.args.join(" ")} failed (${result.exitCode}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return result;
}

export function parseMergeTreeOutput(stdout: string): { treeOid: string | null; conflictingPaths: string[] } {
  const lines = stdout.split(/\r?\n/);
  const first = (lines[0] ?? "").trim();
  const treeOid = /^[0-9a-f]{40,64}$/i.test(first) ? first : null;
  const paths = new Set<string>();
  let header = true;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      header = false;
      continue;
    }
    if (header) {
      const stage = /^\d{6}\s+[0-9a-f]+\s+[123]\t(.+)$/.exec(line);
      const stagedPath = stage?.[1];
      if (stagedPath) {
        paths.add(stagedPath.replaceAll("\\", "/"));
        continue;
      }
      if (!line.startsWith("Auto-merging ") && !line.startsWith("CONFLICT ")) {
        paths.add(line.trim().replaceAll("\\", "/"));
      }
      continue;
    }
    const conflict = /CONFLICT \([^)]+\): Merge conflict in (.+)$/.exec(line.trim());
    const conflictPath = conflict?.[1];
    if (conflictPath) paths.add(conflictPath.trim().replaceAll("\\", "/"));
  }
  return {
    treeOid,
    conflictingPaths: [...paths].sort((left, right) => left.localeCompare(right)),
  };
}

export function fileSha256(repoPath: string, relativePath: string): string {
  const full = path.join(repoPath, relativePath);
  const data = fs.readFileSync(full);
  return createHash("sha256").update(data).digest("hex");
}