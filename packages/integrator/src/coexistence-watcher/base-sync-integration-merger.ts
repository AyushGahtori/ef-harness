import { HARNESS_INTEGRATION_REF } from "./constants.js";
import type { MinGitRepoInspectorPort } from "./git-exec.js";
import type {
  ActiveTasksPort,
  CoexistenceEventStorePort,
  CoexistenceUiPort,
  ProjectMergeQueuePort,
  SmartBranchFreshnessSyncPort,
  RefLeaseAndCasManagerPort,
} from "./ports.js";
import { pathMatchesWriteScope } from "./scope-match.js";

export interface BaseSyncIntegrationMergerOptions {
  readonly repoRoot: string;
  readonly devBranch: string;
  readonly git: MinGitRepoInspectorPort;
  readonly refs: RefLeaseAndCasManagerPort;
  readonly mergeQueue: ProjectMergeQueuePort;
  readonly freshness: SmartBranchFreshnessSyncPort;
  readonly tasks: ActiveTasksPort;
  readonly ui: CoexistenceUiPort;
  readonly events: CoexistenceEventStorePort;
}

export interface BaseSyncOffer {
  readonly kind: "merged" | "rewrite_blocked" | "noop";
  readonly mergedSha?: string;
  readonly deletedAlerts: readonly { taskId: string; path: string }[];
}

/**
 * Merges clean developer commits into `harness/integration` through the merge
 * queue gate without touching the developer working tree.
 */
export class BaseSyncIntegrationMerger {
  private lastDevHead: string | null = null;

  constructor(private readonly options: BaseSyncIntegrationMergerOptions) {}

  currentDevHead(): string | null {
    return this.options.git.readRef(this.options.repoRoot, `refs/heads/${this.options.devBranch}`);
  }

  async onDevHeadMoved(previousHead: string | null, nextHead: string): Promise<BaseSyncOffer> {
    const integrationBefore =
      this.options.refs.readRef(this.options.repoRoot, HARNESS_INTEGRATION_REF) ??
      this.options.git.readRef(this.options.repoRoot, HARNESS_INTEGRATION_REF);
    if (!integrationBefore) {
      this.lastDevHead = nextHead;
      return { kind: "noop", deletedAlerts: [] };
    }
    if (previousHead && previousHead !== nextHead) {
      const rewrite = !this.options.git.isAncestor(this.options.repoRoot, previousHead, nextHead);
      if (rewrite) {
        this.options.ui.showBranchRewriteCard({
          devBranch: this.options.devBranch,
          oldHead: previousHead,
          newHead: nextHead,
        });
        this.options.events.append({
          kind: "branch_rewrite_blocked",
          payload: { devBranch: this.options.devBranch, oldHead: previousHead, newHead: nextHead },
        });
        this.lastDevHead = nextHead;
        return { kind: "rewrite_blocked", deletedAlerts: [] };
      }
    }
    const deleted = previousHead
      ? this.scanDeletedAlerts(previousHead, nextHead)
      : [];
    const mergeResultSha = nextHead;
    const { mergedSha } = await this.options.mergeQueue.enqueueBaseSync({
      devBranch: this.options.devBranch,
      oldIntegrationSha: integrationBefore,
      newDevHead: nextHead,
      mergeResultSha,
    });
    this.options.refs.advanceRefCas(
      this.options.repoRoot,
      HARNESS_INTEGRATION_REF,
      integrationBefore,
      mergedSha,
    );
    await this.options.freshness.afterBaseSync(this.options.devBranch, mergedSha);
    this.options.events.append({
      kind: "base_sync",
      payload: {
        devBranch: this.options.devBranch,
        integrationBefore,
        mergedSha,
        devHead: nextHead,
      },
    });
    this.lastDevHead = nextHead;
    return { kind: "merged", mergedSha, deletedAlerts: deleted };
  }

  async pollHead(): Promise<BaseSyncOffer | null> {
    const head = this.currentDevHead();
    if (!head) return null;
    if (head === this.lastDevHead) return null;
    const previous = this.lastDevHead;
    return this.onDevHeadMoved(previous, head);
  }

  seedHead(sha: string | null): void {
    this.lastDevHead = sha;
  }

  peekLastDevHead(): string | null {
    return this.lastDevHead;
  }

  private scanDeletedAlerts(sinceSha: string, untilSha: string): readonly { taskId: string; path: string }[] {
    const deleted = this.options.git.deletedPathsSince(this.options.repoRoot, sinceSha, untilSha);
    const alerts: { taskId: string; path: string }[] = [];
    for (const path of deleted) {
      for (const task of this.options.tasks.listActive()) {
        if (pathMatchesWriteScope(path, task.writeScope)) {
          alerts.push({ taskId: task.taskId, path });
        }
      }
    }
    return alerts;
  }
}