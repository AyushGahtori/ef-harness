import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { MergeCommitRecord, MergeReport, QueueFeature } from "./types.ts";

const REQUIRED_TRAILERS = [
  "EF-Feature",
  "EF-Tasks",
  "EF-Requirements",
  "EF-Checks-Passed",
  "EF-Harness-Version",
] as const;

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: "EF Harness",
    GIT_AUTHOR_EMAIL: "foundation@ef-harness.local",
    GIT_COMMITTER_NAME: "EF Harness",
    GIT_COMMITTER_EMAIL: "foundation@ef-harness.local",
  };
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: gitEnv(),
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }
  return (result.stdout ?? "").trim();
}

function trailerMessage(feature: QueueFeature): string {
  return [
    `Merge ${feature.id} into harness/integration`,
    "",
    `EF-Feature: ${feature.id}`,
    `EF-Tasks: ${feature.tasks}`,
    `EF-Requirements: ${feature.requirements}`,
    `EF-Checks-Passed: ${feature.checks}`,
    "EF-Harness-Version: 0.0.0",
  ].join("\n");
}

function parseTrailers(message: string): Record<string, string> {
  const trailers: Record<string, string> = {};
  for (const line of message.split(/\r?\n/)) {
    const match = /^(EF-[A-Za-z0-9-]+):\s*(.*)$/.exec(line);
    const key = match?.[1];
    const value = match?.[2]?.trim() ?? "";
    if (key && value) trailers[key] = value;
  }
  return trailers;
}

export class CombinedRegressionGate {
  pass(features: readonly QueueFeature[]): boolean {
    return features.every((feature) => !feature.regression);
  }
}

export class ProjectMergeQueue {
  private readonly gate = new CombinedRegressionGate();

  land(dir: string, features: readonly QueueFeature[]): MergeReport {
    fs.mkdirSync(dir, { recursive: true });
    git(dir, ["init", "-b", "harness/integration"]);
    fs.writeFileSync(path.join(dir, ".gitignore"), ".harness/views/\n", "utf8");
    fs.writeFileSync(path.join(dir, "README.md"), "Kitchen meal ordering\n", "utf8");
    git(dir, ["add", "--", ".gitignore", "README.md"]);
    git(dir, ["commit", "-m", "Kitchen base"]);
    const ordered = [...features].sort(
      (left, right) => left.finishedAtSec - right.finishedAtSec || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
    const commits: MergeCommitRecord[] = [];
    const held: string[] = [];
    for (const group of groupSameSecond(ordered)) {
      const outcome = this.landGroup(dir, group);
      commits.push(...outcome.commits);
      held.push(...outcome.held);
    }
    const status = git(dir, ["status", "--porcelain"]);
    const sameSecond = features.filter((feature, index, all) =>
      all.some((other, otherIndex) => otherIndex !== index && other.finishedAtSec === feature.finishedAtSec),
    );
    return {
      commits,
      held,
      clean: status === "",
      sameSecondSerialized: sameSecond.length === 0 || commitsAreSerial(dir, commits),
    };
  }

  private landGroup(dir: string, group: readonly QueueFeature[]): { commits: MergeCommitRecord[]; held: string[] } {
    if (group.length === 0) return { commits: [], held: [] };
    if (!this.gate.pass(group)) {
      if (group.length === 1) {
        const only = group[0];
        if (!only) return { commits: [], held: [] };
        prepareBranch(dir, only);
        return { commits: [], held: [only.id] };
      }
      const mid = Math.floor(group.length / 2);
      const left = this.landGroup(dir, group.slice(0, mid));
      const right = this.landGroup(dir, group.slice(mid));
      return { commits: [...left.commits, ...right.commits], held: [...left.held, ...right.held] };
    }
    const commits: MergeCommitRecord[] = [];
    for (const feature of group) commits.push(landOne(dir, feature));
    return { commits, held: [] };
  }
}

export class MergeBatchBisector {
  split<T>(batch: readonly T[]): [T[], T[]] {
    const mid = Math.floor(batch.length / 2);
    return [batch.slice(0, mid), batch.slice(mid)];
  }
}

function groupSameSecond(features: readonly QueueFeature[]): QueueFeature[][] {
  const groups: QueueFeature[][] = [];
  for (const feature of features) {
    const last = groups[groups.length - 1];
    if (last && last[0]?.finishedAtSec === feature.finishedAtSec) last.push(feature);
    else groups.push([feature]);
  }
  return groups;
}

function prepareBranch(dir: string, feature: QueueFeature): void {
  git(dir, ["checkout", "harness/integration"]);
  git(dir, ["checkout", "-b", `harness/f/${feature.slug}`]);
  const src = path.join(dir, "src");
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, `${feature.slug}.txt`), feature.body, "utf8");
  git(dir, ["add", "--", `src/${feature.slug}.txt`]);
  git(dir, ["commit", "-m", `Build ${feature.id}`]);
  git(dir, ["checkout", "harness/integration"]);
}

function landOne(dir: string, feature: QueueFeature): MergeCommitRecord {
  prepareBranch(dir, feature);
  git(dir, ["merge", "--no-ff", `harness/f/${feature.slug}`, "-m", trailerMessage(feature)]);
  return readHead(dir, feature);
}

function readHead(dir: string, feature: QueueFeature): MergeCommitRecord {
  const line = git(dir, ["rev-list", "--parents", "-n", "1", "HEAD"]);
  const parts = line.split(/\s+/).filter(Boolean);
  const sha = parts[0] ?? "";
  const parents = Math.max(0, parts.length - 1);
  const message = git(dir, ["log", "-1", "--format=%B"]);
  const trailers = parseTrailers(message);
  for (const key of REQUIRED_TRAILERS) {
    if (!trailers[key]) throw new Error(`merge commit for ${feature.id} is missing ${key}`);
  }
  if (parents !== 2) throw new Error(`merge commit for ${feature.id} is not --no-ff (${parents} parents)`);
  const subject = message.split(/\r?\n/)[0] ?? "";
  return {
    featureId: feature.id,
    sha,
    subject,
    parents,
    trailers,
    branch: `harness/f/${feature.slug}`,
  };
}

function commitsAreSerial(dir: string, commits: readonly MergeCommitRecord[]): boolean {
  if (commits.length < 2) return true;
  for (let i = 1; i < commits.length; i += 1) {
    const current = commits[i];
    const previous = commits[i - 1];
    if (!current || !previous) return false;
    const parents = git(dir, ["rev-list", "--parents", "-n", "1", current.sha]).split(/\s+/);
    if (!parents.includes(previous.sha)) return false;
  }
  return true;
}

export function trackedViews(dir: string): number {
  const listed = git(dir, ["ls-files", "--", ".harness/views"]);
  if (!listed) return 0;
  return listed.split(/\r?\n/).filter(Boolean).length;
}

export function writeIgnoredView(dir: string): void {
  const file = path.join(dir, ".harness", "views", "orders.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "Soup x 2\nSalad x 1\n", "utf8");
  git(dir, ["check-ignore", "--", ".harness/views/orders.md"]);
}
