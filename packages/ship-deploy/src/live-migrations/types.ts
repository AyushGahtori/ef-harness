export type SqlDialect = "sqlite" | "postgres";

export type TargetEnv = "preview" | "staging" | "production";

export type SqlValue = string | number | bigint | null;

export type PhaseName =
  | "REHEARSE"
  | "BACKUP"
  | "EXPAND"
  | "APP_DEPLOY"
  | "BACKFILL"
  | "CONTRACT";

export const PHASE_ORDER: readonly PhaseName[] = [
  "REHEARSE",
  "BACKUP",
  "EXPAND",
  "APP_DEPLOY",
  "BACKFILL",
  "CONTRACT",
];

export type PhaseStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "not_applicable"
  | "paused"
  | "blocked"
  | "rolled_back";

export type DdlSafetyClass = "SAFE_ADDITIVE" | "LOCK_HAZARD" | "DESTRUCTIVE_CONTRACT";

export type ApprovalKind = "expand" | "app_deploy" | "backfill" | "destructive_contract";

export interface SqlRunResult {
  changes: number;
}

export interface SqlSession {
  readonly dialect: SqlDialect;
  exec(sql: string): void;
  all(sql: string, params?: readonly SqlValue[]): readonly Record<string, SqlValue>[];
  get(sql: string, params?: readonly SqlValue[]): Record<string, SqlValue> | undefined;
  run(sql: string, params?: readonly SqlValue[]): SqlRunResult;
  close(): void;
}

export interface SchemaObjectRef {
  table: string;
  column?: string;
}

export interface ClassifiedStatement {
  sql: string;
  safety: DdlSafetyClass;
  reason: string;
  expandForbidden: boolean;
  table?: string;
  column?: string;
  guidance?: string;
  rewrittenSql?: string;
  rewriteSteps?: readonly string[];
}

export interface DdlClassification {
  dialect: SqlDialect;
  statements: readonly ClassifiedStatement[];
  expandSql: readonly string[];
  lockHazards: readonly ClassifiedStatement[];
  contractSql: readonly string[];
  contractObjects: readonly SchemaObjectRef[];
  mixedDestructiveIntoExpand: boolean;
  splitGuidance: string | null;
}

export interface PhaseRecord {
  phase: PhaseName;
  status: PhaseStatus;
  detail: string;
}

export interface BackupReceipt {
  artifactPath: string;
  checksumSha256: string;
  verified: boolean;
  method: "sqlite-online-backup" | "pg_dump-custom" | "provider-snapshot" | "external-pitr";
  detail: string;
  rowCount: number | null;
}

export interface DeployResult {
  deploymentId: string;
  liveUrl: string;
  buildId: string;
  previousDeploymentId: string;
}

export interface BackfillSpec {
  id: string;
  table: string;
  primaryKey: string;
  targetColumn: string;
  assignExpression: string;
  label: string;
  batchSize: number;
}

export interface BackfillCheckpoint {
  backfillId: string;
  lastProcessedPk: string | null;
  nextPk: string | null;
  rowsProcessed: number;
  rowsRemainingEst: number;
  rowsTotal: number;
  batchErrors: readonly string[];
  paused: boolean;
  lastBatchMs: number;
  progressText: string;
}

export interface ExportReceipt {
  format: "csv" | "jsonl" | "sql";
  artifactPath: string;
  checksumSha256: string;
  rowCount: number;
  verified: boolean;
  table: string;
  column: string | null;
}

export interface ApprovalCard {
  cardId: string;
  title: string;
  env: TargetEnv;
  kind: ApprovalKind;
  loud: boolean;
  payload: Readonly<Record<string, string | number | boolean | null>>;
  payloadHash: string;
}

export interface ApprovalDecision {
  approved: boolean;
  payloadHash: string;
  reason: string;
}

export interface ProbeResult {
  ok: boolean;
  error?: string;
}

export interface AppProbe {
  probe(session: SqlSession): ProbeResult | Promise<ProbeResult>;
}

export interface PitrAttestation {
  clean: true;
  writtenOverride: string;
}

export const LIVE_LOCK_TIMEOUT_MS = 3000;
export const LIVE_LOCK_TIMEOUT_SQL = "SET LOCAL lock_timeout = '3000ms'";
export const LOCK_HAZARD_GUIDANCE =
  "lock_timeout = '2s'; statement_timeout = '30s'; validate new constraints as NOT VALID, then VALIDATE CONSTRAINT";
export const EXPAND_SPLIT_GUIDANCE =
  "DdlSafetyClassifier hard-rejects mixing DESTRUCTIVE_CONTRACT into Phase 3 (Expand). Split into Phase 3 Expand (ADD COLUMN) + Phase 5 Backfill + Phase 6 Contract (DROP COLUMN).";
