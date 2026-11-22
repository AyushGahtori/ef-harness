export const INTEGRATION_REF = "refs/heads/harness/integration";
export const ZERO_OID = "0000000000000000000000000000000000000000";
export const LOCKFILE_PATHS = ["package.json", "pnpm-lock.yaml"] as const;
export const SHARED_CONTRACT_PREFIXES = ["contracts/", "schema/", "migrations/", "prisma/", "drizzle/"] as const;
export const PNPM_LOCKFILE_ONLY_ARGS = ["install", "--lockfile-only", "--ignore-scripts"] as const;

export type FeatureBranchStatus = "active" | "sync_scheduled" | "landed" | "pruned" | "missing_ref";

export type MigrationTool = "timestamp-hash" | "prisma" | "drizzle";

export interface FeatureBranchRecord {
  readonly featureId: string;
  readonly featureSlug: string;
  readonly waveId: string;
  readonly ref: string;
  readonly baseIntegrationSha: string;
  readonly headSha: string;
  readonly verifiedHeadSha: string;
  readonly pinnedBaseCommitSha: string;
  readonly activeLeafSlots: readonly string[];
  readonly behindIntegrationCount: number;
  readonly status: FeatureBranchStatus;
  readonly syncReason: string | null;
  readonly landedByTask: number | null;
  readonly leaseHolder: string;
  readonly leaseEpoch: number;
  readonly worktreePath: string | null;
}

export interface DependencyIntent {
  readonly featureId: string;
  readonly packageName: string;
  readonly versionRange: string;
  readonly devOnly: boolean;
  readonly rationale: string;
  readonly taskId?: string;
}

export interface DependencyConflict {
  readonly packageName: string;
  readonly requests: readonly {
    readonly featureId: string;
    readonly versionRange: string;
    readonly rationale: string;
    readonly taskId: string | null;
  }[];
}

export interface DependencyDenial {
  readonly featureId: string;
  readonly packageName: string;
  readonly reason: string;
}

export interface ResolvedDependency {
  readonly packageName: string;
  readonly versionRange: string;
  readonly devOnly: boolean;
  readonly featureIds: readonly string[];
}

export interface VetReport {
  readonly decision: "allow" | "deny";
  readonly reason: string;
}

export interface SupplyChainGate {
  vetDependencyIntent(intent: DependencyIntent): VetReport;
}

export interface RecoveryCard {
  readonly kind: "recovery_card";
  readonly featureId: string;
  readonly ref: string;
  readonly lastVerifiedSha: string;
  readonly message: string;
}

export interface RecoveryResult {
  readonly recovered: boolean;
  readonly sha: string | null;
  readonly card: RecoveryCard | null;
}

export interface SyncOutcome {
  readonly action: "synced" | "up_to_date";
  readonly method: "fast-forward" | "merge" | "none";
  readonly previousHead: string;
  readonly newHead: string;
  readonly pinnedBaseCommitSha: string;
}

export type FreshnessReason = "lockfile" | "read_set" | "shared_contract" | "textual_conflict";

export type FreshnessPlan =
  | { readonly action: "skip"; readonly reason: "disjoint_clean" }
  | { readonly action: "schedule"; readonly reason: FreshnessReason; readonly at: "next_leaf_boundary" };

export interface DriftWarning {
  readonly path: string;
  readonly featureIds: readonly string[];
  readonly kind: "tracked" | "untracked";
  readonly message: string;
}

export interface SkeletonElement {
  readonly kind: "table" | "column";
  readonly name: string;
  readonly table: string | null;
}

export interface SkeletonLockPort {
  isLocked(element: SkeletonElement): boolean;
  destructiveAllowed(element: SkeletonElement, ccrId: string | null): boolean;
}

export interface DdlStatement {
  readonly kind:
    | "create_table"
    | "create_index"
    | "create_enum"
    | "add_column"
    | "drop_column"
    | "rename_column"
    | "rename_table"
    | "add_foreign_key"
    | "drop_table"
    | "alter_column"
    | "other";
  readonly raw: string;
  readonly destructive: boolean;
  readonly name: string | null;
  readonly table: string | null;
  readonly column: string | null;
  readonly columns: readonly string[];
  readonly columnType: string | null;
  readonly targetTable: string | null;
  readonly renamedTo: string | null;
}

export interface MigrationFile {
  readonly id: string;
  readonly featureId: string;
  readonly path: string;
  readonly sql: string;
  readonly timestamp: string;
  readonly hash: string;
  readonly slug: string;
  readonly dependsOn: readonly string[];
  readonly tool: MigrationTool;
  readonly sequence: number | null;
  readonly ccrId: string | null;
}

export type MigrationFindingCode =
  | "duplicate_object"
  | "incompatible_column"
  | "fk_order"
  | "destructive_skeleton"
  | "sequential_filename"
  | "sequence_collision";

export interface MigrationFinding {
  readonly code: MigrationFindingCode;
  readonly message: string;
  readonly featureIds: readonly string[];
  readonly objectName: string;
  readonly migrationIds: readonly string[];
}

export interface DependencyAggregateResult {
  readonly status: "applied" | "conflict" | "denied" | "joined";
  readonly commitSha: string | null;
  readonly integrationRef: string;
  readonly packages: readonly ResolvedDependency[];
  readonly conflicts: readonly DependencyConflict[];
  readonly denials: readonly DependencyDenial[];
  readonly lockfileCommand: readonly string[];
  readonly propagated: readonly { readonly featureId: string; readonly action: string }[];
}

export interface SequenceAssignment {
  readonly featureId: string;
  readonly migrationId: string;
  readonly fromSequence: number;
  readonly toSequence: number;
  readonly fileName: string;
}

export interface OpenFeatureInput {
  readonly featureId: string;
  readonly featureSlug: string;
  readonly waveId: string;
}

export interface IntegrationHeadVerifier {
  verify(sha: string): { readonly ok: true } | { readonly ok: false; readonly reason: string };
}

export function featureRef(slug: string): string {
  return `refs/heads/harness/f/${slug}`;
}

export function isAggregatorLockfile(relative: string): boolean {
  const normalized = relative.replaceAll("\\", "/").replace(/^\.\//, "");
  return normalized === "package.json" || normalized === "pnpm-lock.yaml" || normalized.endsWith("/pnpm-lock.yaml");
}

export function assertFeatureSlug(slug: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(slug)) {
    throw new Error(`Feature slug ${slug} cannot be used in harness/f/<slug>.`);
  }
}
