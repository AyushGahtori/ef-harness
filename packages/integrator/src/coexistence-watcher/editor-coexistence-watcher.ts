import { COEXISTENCE_WATCH_DEBOUNCE_MS } from "./constants.js";
import { ActiveScopeOverlapDetector } from "./active-scope-overlap-detector.js";
import { BaseSyncIntegrationMerger } from "./base-sync-integration-merger.js";
import { createMinGitRepoInspector } from "./git-exec.js";
import { ManualLockfileIncludeHandler } from "./manual-lockfile-include-handler.js";
import { isGitMetaPath, normalizeRepoRelative, shouldIgnoreWatchPath } from "./path-utils.js";
import type {
  ActiveTasksPort,
  CoexistenceEventStorePort,
  CoexistenceUiPort,
  HumanOwnedTransitionPort,
  LandingOverlapFlagPort,
  ProjectMergeQueuePort,
  RefLeaseAndCasManagerPort,
  SmartBranchFreshnessSyncPort,
  TaskHoldsManagerPort,
} from "./ports.js";
import type { WatchBackend, WatchSubscription } from "./watch-backend.js";
import { createParcelWatchBackend } from "./watch-backend.js";

export interface EditorCoexistenceWatcherOptions {
  readonly checkoutRoot: string;
  readonly devBranch: string;
  readonly tasks: ActiveTasksPort;
  readonly holds: TaskHoldsManagerPort;
  readonly ui: CoexistenceUiPort;
  readonly events: CoexistenceEventStorePort;
  readonly mergeQueue: ProjectMergeQueuePort;
  readonly freshness: SmartBranchFreshnessSyncPort;
  readonly refs: RefLeaseAndCasManagerPort;
  readonly humanOwned?: HumanOwnedTransitionPort;
  readonly landingFlags?: LandingOverlapFlagPort;
  readonly backend?: WatchBackend;
  readonly debounceMs?: number;
  readonly git?: ReturnType<typeof createMinGitRepoInspector>;
}

/**
 * Developer-checkout file & git watcher. Never runs stash/checkout/commit in
 * the developer tree unless an explicit UI consent path elsewhere handles it.
 */
export class EditorCoexistenceWatcher {
  private readonly debounceMs: number;
  private readonly backend: WatchBackend | null;
  private readonly git: ReturnType<typeof createMinGitRepoInspector>;
  private readonly overlap: ActiveScopeOverlapDetector;
  private readonly lockfile: ManualLockfileIncludeHandler;
  private readonly baseSync: BaseSyncIntegrationMerger;
  private subscriptions: WatchSubscription[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingPaths = new Set<string>();
  private lastSymbolicBranch: string | null = null;
  private open = false;

  constructor(private readonly options: EditorCoexistenceWatcherOptions) {
    this.debounceMs = options.debounceMs ?? COEXISTENCE_WATCH_DEBOUNCE_MS;
    this.backend = options.backend ?? null;
    this.git = options.git ?? createMinGitRepoInspector();
    const humanOwned = options.humanOwned ?? { transitionToHumanOwned() {} };
    const landingFlags = options.landingFlags ?? { flagKeepBoth() {} };
    this.overlap = new ActiveScopeOverlapDetector({
      tasks: options.tasks,
      holds: options.holds,
      ui: options.ui,
      events: options.events,
      humanOwned,
      landingFlags,
    });
    this.lockfile = new ManualLockfileIncludeHandler({
      ui: options.ui,
      events: options.events,
    });
    this.baseSync = new BaseSyncIntegrationMerger({
      repoRoot: options.checkoutRoot,
      devBranch: options.devBranch,
      git: this.git,
      refs: options.refs,
      mergeQueue: options.mergeQueue,
      freshness: options.freshness,
      tasks: options.tasks,
      ui: options.ui,
      events: options.events,
    });
    this.lastSymbolicBranch = this.git.symbolicRef(options.checkoutRoot, "HEAD");
    this.baseSync.seedHead(this.baseSync.currentDevHead());
  }

  overlapDetector(): ActiveScopeOverlapDetector {
    return this.overlap;
  }

  lockfileHandler(): ManualLockfileIncludeHandler {
    return this.lockfile;
  }

  baseSyncMerger(): BaseSyncIntegrationMerger {
    return this.baseSync;
  }

  async start(): Promise<void> {
    if (this.open) return;
    this.open = true;
    const backend = this.backend ?? (await createParcelWatchBackend());
    const checkoutSub = await backend.subscribe(this.options.checkoutRoot, (error, events) => {
      if (error) return;
      for (const event of events) this.enqueue(event.path);
    });
    this.subscriptions.push(checkoutSub);
    const gitDir = `${this.options.checkoutRoot}/.git`;
    const gitSub = await backend.subscribe(gitDir, (error, events) => {
      if (error) return;
      for (const event of events) this.enqueueGitMeta(event.path);
    });
    this.subscriptions.push(gitSub);
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pendingPaths.clear();
    const subs = [...this.subscriptions];
    this.subscriptions = [];
    await Promise.all(subs.map((sub) => sub.unsubscribe()));
    this.open = false;
  }

  isOpen(): boolean {
    return this.open;
  }

  subscriptionCount(): number {
    return this.subscriptions.length;
  }

  /** Test hook: process a filesystem path immediately (bypasses debounce timer). */
  async flushPath(absolutePath: string): Promise<void> {
    this.enqueue(absolutePath);
    await this.flushNow();
  }

  private enqueue(absolutePath: string): void {
    const relative = normalizeRepoRelative(this.options.checkoutRoot, absolutePath);
    if (!relative || shouldIgnoreWatchPath(relative)) return;
    this.pendingPaths.add(relative);
    this.scheduleFlush();
  }

  private enqueueGitMeta(absolutePath: string): void {
    const relative = normalizeRepoRelative(this.options.checkoutRoot, absolutePath);
    if (!relative || !isGitMetaPath(relative)) return;
    void this.handleGitMeta(relative);
  }

  private scheduleFlush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flushNow();
    }, this.debounceMs);
  }

  private async flushNow(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const paths = [...this.pendingPaths];
    this.pendingPaths.clear();
    for (const relative of paths) {
      this.overlap.detectOverlaps(relative);
      this.lockfile.noteFileEdit(relative);
    }
  }

  private async handleGitMeta(relative: string): Promise<void> {
    if (relative === ".git/head" || relative.startsWith(".git/refs/heads/")) {
      const branch = this.git.symbolicRef(this.options.checkoutRoot, "HEAD");
      if (branch && branch !== this.lastSymbolicBranch) {
        const previous = this.lastSymbolicBranch ?? branch;
        this.options.ui.showBranchSwitchNotice({ previousBranch: previous, currentBranch: branch });
        this.options.events.append({
          kind: "branch_switch",
          payload: { previousBranch: previous, currentBranch: branch },
        });
        this.lastSymbolicBranch = branch;
      }
      const head = this.baseSync.currentDevHead();
      if (head) {
        await this.baseSync.onDevHeadMoved(this.baseSync.peekLastDevHead(), head);
      }
    }
  }
}