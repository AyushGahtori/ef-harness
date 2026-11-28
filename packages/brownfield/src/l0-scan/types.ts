export type ObservedBasis = "observed";

export const ALWAYS_SKIP_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "vendor",
  "__pycache__",
  "target",
]);

export interface SensitivePathMeta {
  readonly path: string;
  readonly ignoredByGit: boolean;
  readonly skippedAsSensitive: true;
}

export interface ScannedFile {
  readonly path: string;
  readonly bytes: number;
  readonly extension: string;
  readonly language: string;
  readonly tracked: boolean;
  readonly isBinary: boolean;
}

export interface LanguageStats {
  readonly language: string;
  readonly files: number;
  readonly bytes: number;
}

export interface PackageManagerHint {
  readonly id: "pnpm" | "npm" | "yarn" | "bun" | "uv" | "poetry" | "pip" | "cargo" | "go";
  readonly evidence: readonly string[];
}

export interface FrameworkFacts {
  readonly nextjsRouter?: "app" | "pages" | "hybrid_app_and_pages";
  readonly frameworks: readonly string[];
  readonly uiKits: readonly string[];
  readonly orm: readonly string[];
  readonly testRunners: readonly string[];
}

export interface NpmScripts {
  readonly scripts: Readonly<Record<string, string>>;
}

export interface CiWorkflowFacts {
  readonly path: string;
  readonly jobs: readonly string[];
  readonly nodeVersions: readonly string[];
  readonly runsOnUbuntu: boolean;
}

export interface SchemaLocation {
  readonly kind: "prisma" | "drizzle" | "sql_migrations" | "openapi";
  readonly path: string;
}

export interface DocInventoryEntry {
  readonly path: string;
  readonly bytes: number;
  readonly lines: number;
  readonly lastCommitIso: string | null;
}

export interface EnvContractVar {
  readonly name: string;
  readonly source: ".env.example" | ".env.sample" | "source_ref";
}

export interface StackDetection {
  readonly languages: readonly LanguageStats[];
  readonly packageManagers: readonly PackageManagerHint[];
  readonly frameworks: FrameworkFacts;
  readonly scripts: readonly { readonly path: string; readonly scripts: Readonly<Record<string, string>> }[];
  readonly ciWorkflows: readonly CiWorkflowFacts[];
  readonly schemaLocations: readonly SchemaLocation[];
  readonly envContract: readonly EnvContractVar[];
  readonly dockerfiles: readonly string[];
  readonly ciLinuxCaseSensitive: boolean;
}

export interface ChurnFileHotspot {
  readonly path: string;
  readonly changeCount: number;
}

export interface CoChangePair {
  readonly a: string;
  readonly b: string;
  readonly togetherCommits: number;
}

export interface ChurnAnalysis {
  readonly churnAvailable: boolean;
  readonly hotspotFiles: readonly ChurnFileHotspot[];
  readonly coChangePairs: readonly CoChangePair[];
  readonly recentCommitStyles: readonly string[];
  readonly branchNameSamples: readonly string[];
}

export interface WorkspacePackage {
  readonly name: string;
  readonly path: string;
  readonly private: boolean;
}

export interface WorkspaceEdge {
  readonly from: string;
  readonly to: string;
}

export interface MonorepoFacts {
  readonly isMonorepo: boolean;
  readonly tool: "pnpm" | "npm" | "yarn" | "turbo" | "nx" | "cargo" | "none";
  readonly packages: readonly WorkspacePackage[];
  readonly internalEdges: readonly WorkspaceEdge[];
}

export interface ScopePickerOption {
  readonly packageName: string;
  readonly packagePath: string;
  readonly includedReadOnlyDeps: readonly string[];
}

export interface L0ScanResult {
  readonly repoRoot: string;
  readonly scannedAtMs: number;
  readonly durationMs: number;
  readonly headSha: string | null;
  readonly files: readonly ScannedFile[];
  readonly sensitiveSkipped: readonly SensitivePathMeta[];
  readonly stack: StackDetection;
  readonly churn: ChurnAnalysis;
  readonly monorepo: MonorepoFacts;
  readonly docs: readonly DocInventoryEntry[];
  readonly basis: ObservedBasis;
}

export interface L0SnapshotCache {
  readonly l0SnapshotHash: string;
  readonly savedAtMs: number;
  readonly result: L0ScanResult;
}