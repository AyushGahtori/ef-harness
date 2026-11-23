import type { CasArtifactRecord, RasterFrame, RepoFileSlice, UiConsistencyFinding } from "./types.js";

export interface StaticAuditGatePort {
  readonly source: string;
  scanFiles(files: readonly RepoFileSlice[]): readonly UiConsistencyFinding[];
}

export interface DesignTokenLintPort {
  readonly source: string;
  lintFiles(files: readonly RepoFileSlice[]): readonly UiConsistencyFinding[];
}

export interface BrandAssetRegistryPort {
  readonly source: string;
  scanHotlinks(files: readonly RepoFileSlice[]): readonly UiConsistencyFinding[];
}

export interface BeforeAfterBaselinePort {
  readonly source: string;
  resolveApprovedBaseline(input: {
    route: string;
    viewportId: string;
    theme: string;
  }): RasterFrame | null;
}

export interface TasteReviewerPort {
  readonly source: string;
  reviewScreenshots(input: {
    casArtifactIds: readonly string[];
    budgetOk: boolean;
  }): Promise<{ readonly status: "advisory_sent" | "skipped_no_budget" | "skipped_no_vision_model" }>;
}

export interface CasStorePort {
  put(record: CasArtifactRecord): string;
  get(id: string): CasArtifactRecord | null;
}