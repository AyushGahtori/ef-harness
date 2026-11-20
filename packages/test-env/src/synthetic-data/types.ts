/** Schema, seed recipe, and dataset contracts for deterministic synthetic databases. */

export const SYNTHETIC_REFERENCE_INSTANT = "2024-01-15T00:00:00.000Z";
export const DEFAULT_CUTOFF_INSTANT = "2024-06-15T15:00:00.000Z";

/** America/New_York spring-forward 2024-03-10 02:00, stored as UTC instants. */
export const DST_SPRING_INSTANTS = [
  "2024-03-10T06:59:59.000Z",
  "2024-03-10T07:00:00.000Z",
  "2024-03-10T07:00:01.000Z",
] as const;

/** America/New_York fall-back 2024-11-03 02:00, stored as UTC instants. */
export const DST_FALL_INSTANTS = [
  "2024-11-03T05:59:59.000Z",
  "2024-11-03T06:00:00.000Z",
  "2024-11-03T06:00:01.000Z",
] as const;

export const RESERVED_EMAIL_DOMAINS = ["example.test", "env.test"] as const;

export const BOUNDARY_ROW_COUNT = 16;

export type SqlDialect = "sqlite" | "postgres";
export type SeedProfile = "functional" | "performance";
export type DatasetPurpose = "functional" | "performance" | "migration-predecessor";
export type LengthUnit = "code_points" | "utf8_bytes" | "utf16_code_units";
export type DataValue = null | string | number | boolean;
export type DataRow = Readonly<Record<string, DataValue>>;

export type BoundaryKind =
  | "max_length"
  | "unicode"
  | "emoji"
  | "rtl"
  | "cutoff"
  | "dst"
  | "cardinality"
  | "soft_delete"
  | "nullable";

export interface SpecBoundary {
  readonly kind: BoundaryKind;
  readonly table?: string;
  readonly column?: string;
  readonly cutoff?: string;
  readonly timezone?: string;
  readonly maxLength?: number;
  readonly samples?: readonly string[];
}

export interface ColumnReference {
  readonly table: string;
  readonly column: string;
}

export interface ColumnSchema {
  readonly name: string;
  readonly type: string;
  readonly nullable?: boolean;
  readonly primaryKey?: boolean;
  readonly unique?: boolean;
  readonly maxLength?: number;
  readonly lengthUnit?: LengthUnit;
  readonly min?: number;
  readonly max?: number;
  readonly check?: string;
  readonly hint?: string;
  readonly references?: ColumnReference;
  readonly softDelete?: boolean;
}

export interface TableSchema {
  readonly name: string;
  readonly columns: readonly ColumnSchema[];
  readonly primaryKey?: readonly string[];
  readonly unique?: readonly (readonly string[])[];
  readonly checks?: readonly string[];
  readonly maxRows?: number;
}

export interface SchemaMetadata {
  readonly dialect?: SqlDialect;
  readonly tables: readonly TableSchema[];
}

export interface SeedRecipe {
  readonly seed: number;
  readonly profile: SeedProfile;
  readonly locale: string;
  readonly functionalRowCount: number;
  readonly performanceRowCount: number;
  readonly cutoff: string;
  readonly timezone: string;
  readonly vocabularies: Readonly<Record<string, readonly string[]>>;
  readonly boundaries: readonly SpecBoundary[];
  readonly singletonTables: readonly string[];
  readonly columnHints: Readonly<Record<string, string>>;
  readonly sanitizedBrownfield: Readonly<Record<string, readonly DataRow[]>>;
}

export interface TableChecksum {
  readonly table: string;
  readonly rowCount: number;
  readonly columns: readonly { readonly column: string; readonly sha256: string }[];
  readonly tableSha256: string;
}

export interface InsertBatch {
  readonly table: string;
  readonly columns: readonly string[];
  readonly rows: readonly DataRow[];
}

export interface RowUpdate {
  readonly table: string;
  readonly set: DataRow;
  readonly where: DataRow;
}

export interface LoadPlan {
  readonly inserts: readonly InsertBatch[];
  readonly updates: readonly RowUpdate[];
}

export interface SqlBatch {
  readonly sql: string;
  readonly params: readonly DataValue[];
}

export interface PostgresCopy {
  readonly sql: string;
  readonly stdin: string;
}

export interface BulkSql {
  readonly sqlite: readonly SqlBatch[];
  readonly postgresInserts: readonly SqlBatch[];
  readonly postgresCopy: readonly PostgresCopy[];
}

export interface BoundaryCoverage {
  readonly maxLength: boolean;
  readonly unicode: boolean;
  readonly emoji: boolean;
  readonly rtlArabic: boolean;
  readonly rtlHebrew: boolean;
  readonly cutoffBefore: boolean;
  readonly cutoffAt: boolean;
  readonly cutoffAfter: boolean;
  readonly dstSpring: boolean;
  readonly dstFall: boolean;
  readonly zeroChildren: boolean;
  readonly oneChild: boolean;
  readonly manyChildren: boolean;
  readonly softDeleted: boolean;
  readonly nullFields: boolean;
  readonly duplicateValues: boolean;
  readonly orphanLooking: boolean;
}

export interface GeneratedTable {
  readonly name: string;
  readonly columns: readonly string[];
  readonly primaryKey: readonly string[];
  readonly rows: readonly DataRow[];
}

export interface GeneratedDataset {
  readonly seed: number;
  readonly profile: SeedProfile;
  readonly locale: string;
  readonly purpose: DatasetPurpose;
  readonly tables: readonly GeneratedTable[];
  readonly load: LoadPlan;
  readonly bulk: BulkSql;
  readonly checksums: readonly TableChecksum[];
  readonly coverage: BoundaryCoverage;
  readonly deferredUpdates: number;
}

export interface PredecessorFixture {
  readonly commit: string | null;
  readonly purpose: "migration-predecessor";
  readonly dataset: GeneratedDataset;
  readonly notes: readonly string[];
}

export interface TemplateBuildRequest {
  readonly migrations: readonly string[];
  readonly migrationsHash?: string;
  readonly seedRecipe: unknown;
  readonly schema: SchemaMetadata;
  readonly profile?: SeedProfile;
}

export interface TemplateHandle {
  readonly templateKey: string;
  readonly name: string;
  readonly projectId: string;
  readonly profile: SeedProfile;
  readonly dialect: SqlDialect;
  readonly location: string;
  readonly locked: true;
  readonly createdAt: number;
  readonly migrationsHash: string;
  readonly seedRecipeHash: string;
  readonly checksums: readonly TableChecksum[];
  readonly rowCounts: readonly { readonly table: string; readonly rows: number }[];
}

export interface CloneHandle {
  readonly envId: string;
  readonly name: string;
  readonly location: string;
  readonly templateKey: string;
  readonly dialect: SqlDialect;
  release(): Promise<void>;
}

export interface PruneResult {
  readonly keep: number;
  readonly removed: readonly string[];
  readonly skipped: readonly string[];
  readonly retained: readonly string[];
}

export interface TemplateManagerStats {
  readonly buildsStarted: number;
  readonly buildsCompleted: number;
  readonly dedupedWaits: number;
  readonly clones: number;
  readonly pruned: number;
  readonly ready: number;
  readonly inflight: number;
}

export type SqlPrimitive = null | string | number;

export interface QueryResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount: number;
}

export interface PostgresSession {
  query(sql: string, params?: readonly SqlPrimitive[]): Promise<QueryResult>;
  copyFromStdin(sql: string, stdin: string): Promise<void>;
  close(): Promise<void>;
}

/** Local stand-in for Task 050 `EmbeddedPostgresProvider` until that branch is wired. */
export interface EmbeddedPostgresProviderPort {
  connectAdmin(): Promise<PostgresSession>;
  connectDatabase(database: string): Promise<PostgresSession>;
  /** Close leftover builder connections to one database. Does not stop the server. */
  closeDatabasePool(database: string): Promise<void>;
}

/** Local stand-in for Task 050 `SqliteEnvProvider` file copy/delete. */
export interface SqliteEnvProviderPort {
  copyTemplateFile(templatePath: string, destinationPath: string): Promise<void>;
  removeDatabaseFile(filePath: string): Promise<void>;
}
