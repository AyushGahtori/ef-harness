import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

export class GitWorkspace {
  readonly slotRoot: string;

  constructor(readonly repo: string, slotRoot?: string) {
    this.slotRoot = slotRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), "ef095-slots-"));
  }

  init(): void {
    fs.mkdirSync(this.repo, { recursive: true });
    this.must(["init", "-b", "harness/integration"]);
    fs.writeFileSync(path.join(this.repo, "README.md"), "synthetic project\n", "utf8");
    this.must(["add", "README.md"]);
    this.must(["commit", "-m", "init"]);
    this.must(["checkout", "--detach"]);
  }

  branch(name: string, from: string): void {
    this.must(["branch", name, from]);
  }

  head(ref: string): string {
    return this.must(["rev-parse", ref]).stdout.trim();
  }

  checkout(ref: string, slotName: string): string {
    const slot = path.join(this.slotRoot, slotName);
    fs.rmSync(slot, { recursive: true, force: true });
    fs.mkdirSync(this.slotRoot, { recursive: true });
    this.must(["worktree", "add", "--detach", slot, ref]);
    return slot;
  }

  removeSlot(slot: string): void {
    if (!slot) return;
    const removed = this.git(["worktree", "remove", "--force", slot]);
    if (removed.status !== 0) {
      fs.rmSync(slot, { recursive: true, force: true });
      this.git(["worktree", "prune"]);
    }
  }

  commitAll(slot: string, message: string): string | null {
    this.mustIn(slot, ["add", "-A"]);
    const names = this.mustIn(slot, ["diff", "--cached", "--name-only"]).stdout.trim();
    if (!names) return null;
    this.mustIn(slot, ["commit", "-m", message]);
    return this.mustIn(slot, ["rev-parse", "HEAD"]).stdout.trim();
  }

  changedPaths(sha: string): string[] {
    const output = this.must(["diff-tree", "--no-commit-id", "--name-only", "-r", sha]).stdout;
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  showPatch(sha: string): string {
    return this.must(["show", "--format=", "--unified=3", sha]).stdout;
  }

  commitTree(tree: string, parent: string, message: string): string {
    return this.must(["commit-tree", tree, "-p", parent, "-m", message]).stdout.trim();
  }

  treeOf(sha: string): string {
    return this.must(["rev-parse", `${sha}^{tree}`]).stdout.trim();
  }

  point(ref: string, sha: string): void {
    this.must(["update-ref", ref, sha]);
  }

  casUpdate(ref: string, next: string, expected: string): boolean {
    const result = this.git(["update-ref", ref, next, expected]);
    return result.status === 0;
  }

  refName(branch: string): string {
    return branch.startsWith("refs/") ? branch : `refs/heads/${branch}`;
  }

  land(branch: string, candidateSha: string, message: string): { ok: true; sha: string; previous: string } | { ok: false; message: string } {
    const previous = this.head(branch);
    const sha = this.commitTree(this.treeOf(candidateSha), previous, message);
    const moved = this.casUpdate(this.refName(branch), sha, previous);
    if (!moved) return { ok: false, message: `CAS update-ref rejected for ${branch}` };
    return { ok: true, sha, previous };
  }

  rollback(branch: string, previous: string, current: string): boolean {
    return this.casUpdate(this.refName(branch), previous, current);
  }

  mergeIntoIntegration(featureBranch: string): { ok: true; sha: string; previous: string } | { ok: false; message: string } {
    const previous = this.head("harness/integration");
    const slot = this.checkout(previous, `merge-${Date.now()}`);
    try {
      const merged = this.gitIn(slot, ["merge", "--no-ff", "--no-edit", featureBranch, "-m", `integrate ${featureBranch}`]);
      if (merged.status !== 0) {
        this.gitIn(slot, ["merge", "--abort"]);
        return { ok: false, message: (merged.stderr || merged.stdout || "merge failed").trim() };
      }
      const sha = this.mustIn(slot, ["rev-parse", "HEAD"]).stdout.trim();
      const moved = this.casUpdate("refs/heads/harness/integration", sha, previous);
      if (!moved) return { ok: false, message: "CAS update-ref rejected for harness/integration" };
      return { ok: true, sha, previous };
    } finally {
      this.removeSlot(slot);
    }
  }

  logSubjects(ref: string): string[] {
    const output = this.git(["log", "--format=%s", ref]);
    if (output.status !== 0) return [];
    return output.stdout.split(/\r?\n/).filter((line) => line.length > 0);
  }

  dispose(): void {
    const listed = this.git(["worktree", "list", "--porcelain"]);
    const paths = listed.stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length).trim())
      .filter((item) => path.resolve(item) !== path.resolve(this.repo));
    for (const item of paths) this.removeSlot(item);
    fs.rmSync(this.slotRoot, { recursive: true, force: true });
  }

  porcelain(): string {
    return this.git(["status", "--porcelain"]).stdout.trim();
  }

  private must(args: string[]): GitResult {
    const result = this.git(args);
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
    }
    return result;
  }

  private mustIn(cwd: string, args: string[]): GitResult {
    const result = this.gitIn(cwd, args);
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
    }
    return result;
  }

  private git(args: string[]): GitResult {
    return this.gitIn(this.repo, args);
  }

  private gitIn(cwd: string, args: string[]): GitResult {
    const result = spawnSync(
      "git",
      ["-c", "safe.directory=*", "-c", "user.name=EF Harness", "-c", "user.email=foundation@ef-harness.local", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args],
      {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "EF Harness",
          GIT_AUTHOR_EMAIL: "foundation@ef-harness.local",
          GIT_COMMITTER_NAME: "EF Harness",
          GIT_COMMITTER_EMAIL: "foundation@ef-harness.local",
          GIT_PAGER: "cat",
          GIT_TERMINAL_PROMPT: "0",
        },
      },
    );
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }
}
