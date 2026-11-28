import type { BrowserEngine, BrowserRunSnapshot } from "./types.js";

export type MinGitRepoInspectorPort = {
  readonly isShallowRepository: () => Promise<boolean> | boolean;
  readonly revListCount: (range: string) => Promise<number> | number;
  readonly resolveRef: (ref: string) => Promise<string> | string;
};

export type WorktreeSlotPoolPort = {
  readonly withScratchWorktree: <T>(
    label: string,
    fn: (worktreePath: string) => Promise<T>,
  ) => Promise<T>;
};

export type BrowserRunnerPort = {
  readonly isEngineInstalled: (engine: BrowserEngine) => Promise<boolean> | boolean;
  readonly runPlaywrightRepro: (
    engine: BrowserEngine,
    scriptRef: string,
  ) => Promise<BrowserRunSnapshot>;
};