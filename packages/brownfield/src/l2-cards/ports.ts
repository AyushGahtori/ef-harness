import type {
  CodeIndexSymbol,
  L2EgressMode,
  ModuleCardWriterV1Output,
  StoredModuleCard,
} from "./types.js";
import type { ModuleCardCacheKey } from "./types.js";

export interface CodeMapQueryPort {
  listFiles(commitSha: string): readonly string[];
  fileRank(commitSha: string, filePath: string): number | null;
  searchSymbols(query: string): readonly { readonly path: string; readonly name: string }[];
  symbolsForPath(commitSha: string, filePath: string): readonly CodeIndexSymbol[];
  fileHash(commitSha: string, filePath: string): string | null;
}

export interface L0GroundTruthPort {
  readonly commitSha: string;
  existingPaths(): ReadonlySet<string>;
  npmScripts(): ReadonlySet<string>;
  churnByPath(): ReadonlyMap<string, number>;
  docLastModifiedMs(docPath: string): number | null;
  codeLastModifiedMs(filePath: string): number | null;
}

export interface ModuleCardStorePort {
  get(key: ModuleCardCacheKey): StoredModuleCard | null;
  put(card: StoredModuleCard): void;
  deleteForPath(filePath: string): void;
}

export interface ModelGenerateInput {
  readonly filePath: string;
  readonly maskedSource: string;
}

export interface ModelAdapterPort {
  generateModuleCard(input: ModelGenerateInput): Promise<ModuleCardWriterV1Output>;
}

export interface ObservedModuleGraphPort {
  upsertBrownfieldModule(input: {
    readonly filePath: string;
    readonly fileRank: number | null;
    readonly card: ModuleCardWriterV1Output;
  }): string;
}

export interface RepoCloudEgressLedgerPort {
  hasSentCodeFromRepo(repoId: string): boolean;
  markSentCodeFromRepo(repoId: string): void;
}

export interface L2RuntimeContext {
  readonly repoId: string;
  readonly commitSha: string;
  readonly codeMap: CodeMapQueryPort;
  readonly l0: L0GroundTruthPort;
  readonly store: ModuleCardStorePort;
  readonly model: ModelAdapterPort | null;
  readonly graph: ObservedModuleGraphPort;
  readonly egressLedger: RepoCloudEgressLedgerPort;
  readonly egress: L2EgressMode;
}