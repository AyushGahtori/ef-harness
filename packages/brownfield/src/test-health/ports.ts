import type { BaselineHealthCacheEntry, BaselineTestHealthReceipt, DetectedRepoScripts, QuarantinedTestRow } from "./types.js";

export interface WorktreeSlot {
  readonly slotId: string;
  readonly rootPath: string;
}

export interface WorktreeSlotPoolPort {
  checkoutIsolated(baselineCommitSha: string): Promise<WorktreeSlot>;
  release(slotId: string): Promise<void>;
}

export interface HarnessCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface HarnessRunEnginePort {
  runInSandbox(slot: WorktreeSlot, argv: readonly string[], options?: { env?: Record<string, string> }): Promise<HarnessCommandResult>;
}

export interface GitStatusLine {
  readonly path: string;
  readonly indexStatus: string;
  readonly workTreeStatus: string;
}

export interface GitWorktreeInspectorPort {
  statusPorcelain(worktreeRoot: string): Promise<readonly GitStatusLine[]>;
  resolveHead(worktreeRoot: string): Promise<string>;
  hashFile(worktreeRoot: string, relativePath: string): Promise<string | null>;
}

export interface BrownfieldL0RepoScannerPort {
  detectScripts(repoRoot: string): Promise<DetectedRepoScripts>;
}

export interface BaselineTestHealthStorePort {
  saveReceipt(receipt: BaselineTestHealthReceipt): Promise<void>;
  loadCache(cacheKey: string): Promise<BaselineHealthCacheEntry | null>;
  saveCache(entry: BaselineHealthCacheEntry): Promise<void>;
}

export interface QuarantinedTestsStorePort {
  replaceAll(rows: readonly QuarantinedTestRow[]): Promise<void>;
  listAll(): Promise<readonly QuarantinedTestRow[]>;
}