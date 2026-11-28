export const MODULE_CARD_PROMPT_VERSION = "module-card-writer@1" as const;
export const LEGACY_SECRET_PLACEHOLDER = "[REDACTED_LEGACY_SECRET]" as const;

export const DEFAULT_MAX_FOCUS_FILES = 20;
export const PRE_SPEND_TOKEN_THRESHOLD = 25_000;
export const PRE_SPEND_USD_THRESHOLD = 0.15;
export const MAX_L2_CONCURRENCY = 4;
export const STALE_DOC_AGE_DAYS = 180;
export const STALE_DOC_CHURN_THRESHOLD = 20;

export interface ModuleCardKeyExport {
  readonly name: string;
  readonly signature?: string;
}

export interface ModuleCardWriterV1Output {
  readonly module: string;
  readonly purpose: string;
  readonly key_exports: readonly ModuleCardKeyExport[];
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  readonly side_effects: readonly string[];
  readonly tests: readonly string[];
  readonly confidence: "high" | "medium" | "low";
  readonly publicApiSummary?: string;
  readonly sideEffectsAndIo?: string;
  readonly invariantsAndGotchas?: readonly string[];
  readonly externalDependencies?: readonly string[];
  readonly testCoverageNotes?: string;
  readonly observedSymbolHashes?: readonly string[];
}

export interface StoredModuleCard {
  readonly key: ModuleCardCacheKey;
  readonly card: ModuleCardWriterV1Output;
  readonly createdAtMs: number;
}

export interface ModuleCardCacheKey {
  readonly filePath: string;
  readonly fileContentSha256: string;
  readonly promptVersion: typeof MODULE_CARD_PROMPT_VERSION;
}

export interface FocusFileCandidate {
  readonly path: string;
  readonly pageRankScore: number;
  readonly churnScore: number;
  readonly symbolHits: number;
  readonly lexicalScore: number;
}

export interface FocusSelectionResult {
  readonly request: string;
  readonly selected: readonly string[];
  readonly ranked: readonly FocusFileCandidate[];
  readonly capped: boolean;
  readonly maxFiles: number;
}

export interface PreSpendBreakdown {
  readonly uncachedFiles: readonly string[];
  readonly cachedFiles: readonly string[];
  readonly uncachedInputTokens: number;
  readonly estimatedMicroUsd: number;
  readonly planWindowPercent: number;
  readonly requiresConfirmation: boolean;
  readonly reasons: readonly string[];
}

export interface PreSpendSummaryText {
  readonly headline: string;
  readonly breakdown: PreSpendBreakdown;
}

export interface SecurityMaskNotice {
  readonly filePath: string;
  readonly line: number;
  readonly message: string;
}

export interface MaskedSourceExcerpt {
  readonly filePath: string;
  readonly maskedContent: string;
  readonly notices: readonly SecurityMaskNotice[];
}

export interface CodeIndexSymbol {
  readonly fileHash: string;
  readonly name: string;
  readonly kind: string;
  readonly line: number;
  readonly exported: boolean;
}

export interface StaleDocFinding {
  readonly docPath: string;
  readonly status: "likely_stale" | "fresh";
  readonly evidence: readonly string[];
}

export interface L2EgressMode {
  readonly kind: "cloud" | "local_ollama" | "l0_l1_only";
  readonly userDeclinedCloud?: boolean;
}

export interface BrownfieldModuleNode {
  readonly id: string;
  readonly type: "brownfield_module";
  readonly basis: "observed";
  readonly filePath: string;
  readonly fileRank?: number;
  readonly card: ModuleCardWriterV1Output;
}