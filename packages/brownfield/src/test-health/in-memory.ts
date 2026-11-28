import type {
  BaselineHealthCacheEntry,
  BaselineTestHealthReceipt,
  DetectedRepoScripts,
  QuarantinedTestRow,
} from "./types.js";
import type {
  BaselineTestHealthStorePort,
  BrownfieldL0RepoScannerPort,
  GitStatusLine,
  GitWorktreeInspectorPort,
  HarnessCommandResult,
  HarnessRunEnginePort,
  QuarantinedTestsStorePort,
  WorktreeSlot,
  WorktreeSlotPoolPort,
} from "./ports.js";

export class InMemoryWorktreeSlotPool implements WorktreeSlotPoolPort {
  constructor(private readonly roots: Map<string, string>) {}

  async checkoutIsolated(baselineCommitSha: string): Promise<WorktreeSlot> {
    const slotId = `slot-${baselineCommitSha.slice(0, 8)}`;
    const rootPath = this.roots.get(baselineCommitSha) ?? this.roots.get("*") ?? ".";
    return { slotId, rootPath };
  }

  async release(): Promise<void> {
    // no-op for tests
  }
}

export type ScriptedCommand = {
  readonly argv: readonly string[];
  readonly result: HarnessCommandResult;
};

export class ScriptedHarnessRunEngine implements HarnessRunEnginePort {
  private readonly invocationCounts = new Map<string, number>();

  constructor(private readonly scripts: readonly ScriptedCommand[]) {}

  async runInSandbox(_slot: WorktreeSlot, argv: readonly string[]): Promise<HarnessCommandResult> {
    const key = argv.join(" ");
    const exactMatches = this.scripts.filter((s) => s.argv.join(" ") === key);
    if (exactMatches.length > 0) {
      const count = this.invocationCounts.get(key) ?? 0;
      this.invocationCounts.set(key, count + 1);
      return exactMatches[Math.min(count, exactMatches.length - 1)]!.result;
    }
    const prefix = `${argv[0]}`;
    const prefixMatches = this.scripts.filter((s) => s.argv[0] === prefix);
    if (prefixMatches.length > 0) {
      const count = this.invocationCounts.get(prefix) ?? 0;
      this.invocationCounts.set(prefix, count + 1);
      return prefixMatches[Math.min(count, prefixMatches.length - 1)]!.result;
    }
    return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
  }
}

export class InMemoryGitWorktreeInspector implements GitWorktreeInspectorPort {
  constructor(
    private readonly headByRoot: Map<string, string>,
    private readonly statusByRoot: Map<string, readonly GitStatusLine[]>,
    private readonly hashes: Map<string, string>,
  ) {}

  async statusPorcelain(worktreeRoot: string): Promise<readonly GitStatusLine[]> {
    return this.statusByRoot.get(worktreeRoot) ?? [];
  }

  async resolveHead(worktreeRoot: string): Promise<string> {
    return this.headByRoot.get(worktreeRoot) ?? "0000000000000000000000000000000000000000";
  }

  async hashFile(_worktreeRoot: string, relativePath: string): Promise<string | null> {
    return this.hashes.get(relativePath) ?? null;
  }
}

export class StubBrownfieldL0RepoScanner implements BrownfieldL0RepoScannerPort {
  constructor(private readonly scripts: DetectedRepoScripts) {}

  async detectScripts(): Promise<DetectedRepoScripts> {
    return this.scripts;
  }
}

export class InMemoryBaselineTestHealthStore implements BaselineTestHealthStorePort {
  private cache = new Map<string, BaselineHealthCacheEntry>();
  private receipts: BaselineTestHealthReceipt[] = [];

  async saveReceipt(receipt: BaselineTestHealthReceipt): Promise<void> {
    this.receipts.push(receipt);
  }

  async loadCache(cacheKey: string): Promise<BaselineHealthCacheEntry | null> {
    return this.cache.get(cacheKey) ?? null;
  }

  async saveCache(entry: BaselineHealthCacheEntry): Promise<void> {
    this.cache.set(entry.cacheKey, entry);
  }

  listReceipts(): readonly BaselineTestHealthReceipt[] {
    return this.receipts;
  }
}

export class InMemoryQuarantinedTestsStore implements QuarantinedTestsStorePort {
  private rows: QuarantinedTestRow[] = [];

  async replaceAll(rows: readonly QuarantinedTestRow[]): Promise<void> {
    this.rows = [...rows];
  }

  async listAll(): Promise<readonly QuarantinedTestRow[]> {
    return this.rows;
  }
}