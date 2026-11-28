import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { WorktreeSlotManager } from "@ef-harness/git-engine";
import { ProjectMergeQueue } from "@ef-harness/integrator";
import type { IntegrationCheckout, WorktreeSlotPool } from "./ports.js";

export interface GitIntegrationPoolOptions {
  readonly wtRoot: string;
  readonly projectId: string;
  readonly developerCheckoutPath: string;
  readonly workerSlotPath: string;
  readonly commits: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly headSha: string;
}

export class GitIntegrationWorktreePool implements WorktreeSlotPool {
  private readonly slots: WorktreeSlotManager;
  private readonly mainRepo: string;
  private readonly projectId: string;
  private readonly developerCheckoutPath: string;
  private readonly workerSlotPath: string;
  private readonly labels = new Map<string, string>();
  private readonly queue: ProjectMergeQueue;
  private head: string;
  private checkedOut: string | null = null;
  private leaseEpoch = 1;

  constructor(options: GitIntegrationPoolOptions) {
    this.projectId = options.projectId;
    this.developerCheckoutPath = options.developerCheckoutPath;
    this.workerSlotPath = options.workerSlotPath;
    this.head = options.headSha;
    this.mainRepo = path.resolve(options.wtRoot, "..", "preview-main", options.projectId);
    fs.mkdirSync(this.mainRepo, { recursive: true });
    git(this.mainRepo, ["init", "-b", "main"], false);
    git(this.mainRepo, ["config", "user.name", "EF Harness"]);
    git(this.mainRepo, ["config", "user.email", "foundation@ef-harness.local"]);
    git(this.mainRepo, ["config", "commit.gpgsign", "false"]);
    const labels = Object.keys(options.commits);
    if (!labels.includes(options.headSha)) {
      throw new Error(`unknown integration commit ${options.headSha}`);
    }
    const ordered = [options.headSha, ...labels.filter((label) => label !== options.headSha)];
    for (const label of ordered) {
      const files = options.commits[label];
      if (!files) throw new Error(`unknown integration commit ${label}`);
      writeTree(this.mainRepo, files);
      git(this.mainRepo, ["add", "-A"]);
      git(this.mainRepo, ["commit", "--allow-empty", "-m", `preview ${label}`]);
      this.labels.set(label, git(this.mainRepo, ["rev-parse", "HEAD"]));
    }
    const headCommit = this.requireCommit(options.headSha);
    git(this.mainRepo, ["update-ref", "refs/heads/harness/integration", headCommit]);
    this.slots = new WorktreeSlotManager({ wtRoot: path.resolve(options.wtRoot) });
    this.queue = new ProjectMergeQueue({
      repo: this.mainRepo,
      stateFile: path.join(this.mainRepo, ".ef-preview-merge-queue.sqlite"),
    });
    this.queue.integrationSha();
  }

  integrationPath(): string {
    return path.resolve(this.slotsDirectory(), "integration");
  }

  async materialize(sha: string): Promise<IntegrationCheckout> {
    const commit = this.requireCommit(sha);
    git(this.mainRepo, ["update-ref", "refs/heads/harness/integration", commit]);
    if (this.checkedOut === null) {
      const created = await this.slots.ensureIntegrationWorktree({
        projectId: this.projectId,
        mainRepoPath: this.mainRepo,
        baseCommit: commit,
      });
      this.assertDecoupled(created.slotPath);
      this.checkedOut = commit;
      this.head = sha;
      return this.checkout(created.slotPath);
    }
    if (this.checkedOut !== commit) {
      await this.slots.setIntegrationLease(this.projectId, this.mainRepo, {
        holderId: "preview-merge-queue",
        epoch: this.leaseEpoch,
      });
      await this.slots.fastForwardIntegrationWorktree({
        projectId: this.projectId,
        mainRepoPath: this.mainRepo,
        newSha: commit,
        lease: {
          holderId: "preview-merge-queue",
          epoch: this.leaseEpoch,
          role: "project-merge-queue",
        },
      });
      this.checkedOut = commit;
    }
    this.head = sha;
    return this.checkout(this.integrationPath());
  }

  async noteHead(sha: string): Promise<IntegrationCheckout> {
    this.requireCommit(sha);
    this.head = sha;
    return this.checkout(this.integrationPath());
  }

  headSha(): string {
    return this.head;
  }

  async shutdown(): Promise<void> {
    this.queue.close();
  }

  private requireCommit(label: string): string {
    const commit = this.labels.get(label);
    if (!commit) throw new Error(`unknown integration commit ${label}`);
    return commit;
  }

  private slotsDirectory(): string {
    const listed = git(this.mainRepo, ["worktree", "list", "--porcelain"]);
    const worktree = listed
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length))
      .find((dir) => path.basename(dir) === "integration");
    if (worktree) return path.dirname(worktree);
    return path.resolve(path.dirname(this.mainRepo), "..", "wt-unresolved");
  }

  private checkout(worktreePath: string): IntegrationCheckout {
    return {
      projectId: this.projectId,
      slot: "integration",
      worktreePath,
      headSha: this.head,
      ref: "harness/integration",
      decoupledFromDeveloperCheckout: true,
      decoupledFromWorkerSlots: true,
    };
  }

  private assertDecoupled(integration: string): void {
    const resolved = path.resolve(integration);
    const developer = path.resolve(this.developerCheckoutPath);
    const worker = path.resolve(this.workerSlotPath);
    if (resolved === developer || resolved === worker) {
      throw new Error("preview checkout must stay decoupled from the developer checkout and worker slots");
    }
    if (!resolved.endsWith(`${path.sep}integration`)) {
      throw new Error("preview checkout must be wt/<project>/integration");
    }
    if (resolved.includes(`${path.sep}slot-`) || resolved.endsWith(`${path.sep}merge`)) {
      throw new Error("preview checkout cannot use a coding worker or merge slot");
    }
  }
}

function writeTree(root: string, files: Readonly<Record<string, string>>): void {
  for (const entry of fs.readdirSync(root)) {
    if (entry === ".git") continue;
    fs.rmSync(path.join(root, entry), { recursive: true, force: true });
  }
  for (const [relative, contents] of Object.entries(files)) {
    const dest = path.resolve(root, relative);
    if (!dest.startsWith(root + path.sep) && dest !== root) {
      throw new Error(`fixture path escapes the integration worktree: ${relative}`);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, contents, "utf8");
  }
}

function git(cwd: string, args: readonly string[], useCwd = true): string {
  const invocation = useCwd ? ["-C", cwd, ...args] : [...args, cwd];
  return execFileSync("git", invocation, { encoding: "utf8" }).trim();
}
