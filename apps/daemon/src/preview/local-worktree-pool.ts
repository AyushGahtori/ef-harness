import fs from "node:fs";
import path from "node:path";
import type { IntegrationCheckout, WorktreeSlotPool } from "./ports.js";

export interface LocalWorktreeSlotPoolOptions {
  readonly wtRoot: string;
  readonly projectId: string;
  readonly developerCheckoutPath: string;
  readonly workerSlotPath: string;
  readonly commits: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly headSha: string;
}

/**
 * Persistent `wt/<project>/integration` checkout.
 * The developer desk and coding-worker slots are recorded only so the runner can refuse them.
 */
export class LocalWorktreeSlotPool implements WorktreeSlotPool {
  private head: string;

  constructor(private readonly options: LocalWorktreeSlotPoolOptions) {
    this.head = options.headSha;
    this.assertDecoupled(this.integrationPath());
  }

  integrationPath(): string {
    const resolved = path.resolve(this.options.wtRoot, this.options.projectId, "integration");
    this.assertDecoupled(resolved);
    return resolved;
  }

  materialize(sha: string): IntegrationCheckout {
    const files = this.options.commits[sha];
    if (!files) throw new Error(`unknown integration commit ${sha}`);
    const dir = this.integrationPath();
    fs.mkdirSync(dir, { recursive: true });
    for (const [relative, contents] of Object.entries(files)) {
      const dest = path.resolve(dir, relative);
      if (!dest.startsWith(dir + path.sep) && dest !== dir) {
        throw new Error(`fixture path escapes the integration worktree: ${relative}`);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, contents, "utf8");
    }
    this.head = sha;
    return this.checkout();
  }

  noteHead(sha: string): IntegrationCheckout {
    this.head = sha;
    return this.checkout();
  }

  headSha(): string {
    return this.head;
  }

  private checkout(): IntegrationCheckout {
    return {
      projectId: this.options.projectId,
      slot: "integration",
      worktreePath: this.integrationPath(),
      headSha: this.head,
      ref: "harness/integration",
      decoupledFromDeveloperCheckout: true,
      decoupledFromWorkerSlots: true,
    };
  }

  private assertDecoupled(integration: string): void {
    const developer = path.resolve(this.options.developerCheckoutPath);
    const worker = path.resolve(this.options.workerSlotPath);
    if (integration === developer || integration === worker) {
      throw new Error("preview checkout must stay decoupled from the developer checkout and worker slots");
    }
    if (!integration.endsWith(`${path.sep}integration`)) {
      throw new Error("preview checkout must be wt/<project>/integration");
    }
    if (integration.includes(`${path.sep}slot-`) || integration.endsWith(`${path.sep}merge`)) {
      throw new Error("preview checkout cannot use a coding worker or merge slot");
    }
  }
}
