import type { SqliteConnection } from "@ef-harness/db";
import { SqliteShipRunStore } from "../ci-loop/sqlite-ship-run-store.js";
import type { ShipRunPhase, ShipRunRecord as CiShipRun } from "../ci-loop/types.js";
import {
  ExternalEffectLedger,
  PayloadHashMismatchError,
  SqliteEffectStore,
} from "../effects/index.js";
import type { EffectRecord } from "../effects/types.js";
import { openShipStateFile } from "../state-file.js";
import { nextIntegerPk } from "./progress.js";
import type {
  BackupReceipt,
  BackfillCheckpoint,
  DdlClassification,
  DeployResult,
  PhaseName,
  PhaseRecord,
  PhaseStatus,
  SqlDialect,
  TargetEnv,
} from "./types.js";
import { PHASE_ORDER } from "./types.js";

export interface RunExtra {
  rolledBackTo: string | null;
  contractExportPath: string | null;
  fastPath: boolean;
  detail: string;
}

export interface PersistedRun {
  migrationId: string;
  env: TargetEnv;
  dialect: SqlDialect;
  commitSha: string;
  previousCommitSha: string;
  sqlSha256: string;
  currentPhase: PhaseName;
  phases: Record<PhaseName, PhaseRecord>;
  classification: DdlClassification;
  backup: BackupReceipt | null;
  deploy: DeployResult | null;
  rolledBackTo: string | null;
  contractExportPath: string | null;
  fastPath: boolean;
  shipRunId: string;
  detail: string;
}

const SIDECAR_SQL = `
CREATE TABLE IF NOT EXISTS live_migration_runs (
  migration_id TEXT PRIMARY KEY,
  env TEXT NOT NULL,
  dialect TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  previous_commit_sha TEXT NOT NULL,
  sql_sha256 TEXT NOT NULL,
  current_phase TEXT NOT NULL,
  phase_json TEXT NOT NULL CHECK (json_valid(phase_json)),
  classification_json TEXT NOT NULL CHECK (json_valid(classification_json)),
  backup_json TEXT,
  deploy_json TEXT,
  extra_json TEXT NOT NULL CHECK (json_valid(extra_json)),
  ship_run_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS live_migration_backfill_cursors (
  migration_id TEXT NOT NULL,
  backfill_id TEXT NOT NULL,
  last_processed_pk TEXT,
  rows_processed INTEGER NOT NULL,
  rows_remaining_est INTEGER NOT NULL,
  rows_total INTEGER NOT NULL,
  batch_errors_json TEXT NOT NULL CHECK (json_valid(batch_errors_json)),
  paused INTEGER NOT NULL CHECK (paused IN (0, 1)),
  last_batch_ms INTEGER NOT NULL,
  progress_text TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (migration_id, backfill_id)
) STRICT;
`;

export class MigrationStateStore {
  readonly ledger: ExternalEffectLedger;
  private readonly shipRuns: SqliteShipRunStore;

  constructor(
    private readonly db: SqliteConnection,
    ledger?: ExternalEffectLedger,
  ) {
    this.db.exec(SIDECAR_SQL);
    this.ledger =
      ledger ??
      new ExternalEffectLedger({
        store: new SqliteEffectStore({ connection: db }),
      });
    this.shipRuns = new SqliteShipRunStore(db);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Migration effects go through `ExternalEffectLedger`. A reused idempotency key
   * with a different payload throws `PayloadHashMismatchError`.
   */
  recordEffect(input: {
    readonly id: string;
    readonly kind: string;
    readonly target: string;
    readonly payloadHash: string;
    readonly idempotencyKey: string;
    readonly targetEnv: TargetEnv;
    readonly approval: "intended" | "approved";
  }): void {
    const fence = this.ledger.store.readRuntimeFence();
    const recorded = this.ledger.recordPlanned({
      effectType: input.kind,
      targetEnv: input.targetEnv,
      payload: {
        target: input.target,
        payloadHash: input.payloadHash,
        kind: input.kind,
      },
      idempotencyKey: input.idempotencyKey,
      writerEpoch: fence.writerEpoch,
    });
    const stored = this.ledger.store.get(recorded.effectId);
    if (
      input.approval === "approved" &&
      stored &&
      stored.execStatus !== "succeeded" &&
      stored.execStatus !== "dispatched"
    ) {
      this.ledger.approveEffect(stored.effectId, stored.canonicalPayloadHash);
    }
  }

  applyEffect(
    localId: string,
    state: "approved" | "failed" | "sent" | "confirmed",
    receipt: string | null,
  ): void {
    const row = this.requireLocal(localId);
    if (state === "approved") {
      this.ledger.approveEffect(row.effectId, row.canonicalPayloadHash);
      return;
    }
    if (state === "failed") {
      this.ledger.store.markFailed(row.effectId, { reason: receipt });
      return;
    }
    if (state === "sent") {
      const fence = this.ledger.store.readRuntimeFence();
      const epoch = row.writerEpoch ?? fence.writerEpoch;
      this.ledger.store.atomicDispatchTransition(row.effectId, epoch, fence.state);
      return;
    }
    this.ledger.store.markSucceeded(row.effectId, { receipt });
  }

  saveRun(run: PersistedRun): void {
    const now = Date.now();
    this.db.run(
      `INSERT INTO live_migration_runs (
         migration_id, env, dialect, commit_sha, previous_commit_sha, sql_sha256, current_phase,
         phase_json, classification_json, backup_json, deploy_json, extra_json, ship_run_id, updated_at
       ) VALUES (
         :migration_id, :env, :dialect, :commit_sha, :previous_commit_sha, :sql_sha256, :current_phase,
         :phase_json, :classification_json, :backup_json, :deploy_json, :extra_json, :ship_run_id, :updated_at
       )
       ON CONFLICT(migration_id) DO UPDATE SET
         current_phase = excluded.current_phase,
         phase_json = excluded.phase_json,
         classification_json = excluded.classification_json,
         backup_json = excluded.backup_json,
         deploy_json = excluded.deploy_json,
         extra_json = excluded.extra_json,
         updated_at = excluded.updated_at`,
      {
        migration_id: run.migrationId,
        env: run.env,
        dialect: run.dialect,
        commit_sha: run.commitSha,
        previous_commit_sha: run.previousCommitSha,
        sql_sha256: run.sqlSha256,
        current_phase: run.currentPhase,
        phase_json: JSON.stringify(run.phases),
        classification_json: JSON.stringify(run.classification),
        backup_json: run.backup ? JSON.stringify(run.backup) : null,
        deploy_json: run.deploy ? JSON.stringify(run.deploy) : null,
        extra_json: JSON.stringify({
          rolledBackTo: run.rolledBackTo,
          contractExportPath: run.contractExportPath,
          fastPath: run.fastPath,
          detail: run.detail,
        } satisfies RunExtra),
        ship_run_id: run.shipRunId,
        updated_at: now,
      },
    );
    this.shipRuns.upsert(shipRunFrom(run, now));
  }

  getRun(migrationId: string): PersistedRun | null {
    const row = asRecord(
      this.db.get(
        `SELECT migration_id, env, dialect, commit_sha, previous_commit_sha, sql_sha256, current_phase,
                phase_json, classification_json, backup_json, deploy_json, extra_json, ship_run_id
         FROM live_migration_runs WHERE migration_id = :migration_id`,
        { migration_id: migrationId },
      ),
    );
    if (!row) return null;
    const extra = JSON.parse(text(row, "extra_json")) as RunExtra;
    return {
      migrationId: text(row, "migration_id"),
      env: text(row, "env") as TargetEnv,
      dialect: text(row, "dialect") as SqlDialect,
      commitSha: text(row, "commit_sha"),
      previousCommitSha: text(row, "previous_commit_sha"),
      sqlSha256: text(row, "sql_sha256"),
      currentPhase: text(row, "current_phase") as PhaseName,
      phases: JSON.parse(text(row, "phase_json")) as Record<PhaseName, PhaseRecord>,
      classification: JSON.parse(text(row, "classification_json")) as DdlClassification,
      backup: nullableText(row, "backup_json")
        ? (JSON.parse(text(row, "backup_json")) as BackupReceipt)
        : null,
      deploy: nullableText(row, "deploy_json")
        ? (JSON.parse(text(row, "deploy_json")) as DeployResult)
        : null,
      rolledBackTo: extra.rolledBackTo,
      contractExportPath: extra.contractExportPath,
      fastPath: extra.fastPath,
      shipRunId: text(row, "ship_run_id"),
      detail: extra.detail,
    };
  }

  saveCursor(migrationId: string, cursor: BackfillCheckpoint): void {
    this.db.run(
      `INSERT INTO live_migration_backfill_cursors (
         migration_id, backfill_id, last_processed_pk, rows_processed, rows_remaining_est, rows_total,
         batch_errors_json, paused, last_batch_ms, progress_text, updated_at
       ) VALUES (
         :migration_id, :backfill_id, :last_processed_pk, :rows_processed, :rows_remaining_est, :rows_total,
         :batch_errors_json, :paused, :last_batch_ms, :progress_text, :updated_at
       )
       ON CONFLICT(migration_id, backfill_id) DO UPDATE SET
         last_processed_pk = excluded.last_processed_pk,
         rows_processed = excluded.rows_processed,
         rows_remaining_est = excluded.rows_remaining_est,
         rows_total = excluded.rows_total,
         batch_errors_json = excluded.batch_errors_json,
         paused = excluded.paused,
         last_batch_ms = excluded.last_batch_ms,
         progress_text = excluded.progress_text,
         updated_at = excluded.updated_at`,
      {
        migration_id: migrationId,
        backfill_id: cursor.backfillId,
        last_processed_pk: cursor.lastProcessedPk,
        rows_processed: cursor.rowsProcessed,
        rows_remaining_est: cursor.rowsRemainingEst,
        rows_total: cursor.rowsTotal,
        batch_errors_json: JSON.stringify(cursor.batchErrors),
        paused: cursor.paused ? 1 : 0,
        last_batch_ms: cursor.lastBatchMs,
        progress_text: cursor.progressText,
        updated_at: Date.now(),
      },
    );
  }

  latestCursor(migrationId: string): BackfillCheckpoint | null {
    const row = asRecord(
      this.db.get(
        `SELECT backfill_id FROM live_migration_backfill_cursors
         WHERE migration_id = :migration_id ORDER BY updated_at DESC LIMIT 1`,
        { migration_id: migrationId },
      ),
    );
    if (!row) return null;
    return this.getCursor(migrationId, text(row, "backfill_id"));
  }

  getCursor(migrationId: string, backfillId: string): BackfillCheckpoint | null {
    const row = asRecord(
      this.db.get(
        `SELECT backfill_id, last_processed_pk, rows_processed, rows_remaining_est, rows_total,
                batch_errors_json, paused, last_batch_ms, progress_text
         FROM live_migration_backfill_cursors
         WHERE migration_id = :migration_id AND backfill_id = :backfill_id`,
        { migration_id: migrationId, backfill_id: backfillId },
      ),
    );
    if (!row) return null;
    const lastProcessedPk = nullableText(row, "last_processed_pk");
    return {
      backfillId: text(row, "backfill_id"),
      lastProcessedPk,
      nextPk: nextIntegerPk(lastProcessedPk),
      rowsProcessed: integer(row, "rows_processed"),
      rowsRemainingEst: integer(row, "rows_remaining_est"),
      rowsTotal: integer(row, "rows_total"),
      batchErrors: JSON.parse(text(row, "batch_errors_json")) as string[],
      paused: integer(row, "paused") === 1,
      lastBatchMs: integer(row, "last_batch_ms"),
      progressText: text(row, "progress_text"),
    };
  }

  private requireLocal(localId: string): EffectRecord {
    const row = asRecord(
      this.db.get(
        `SELECT idempotency_key FROM effects
          WHERE idempotency_key LIKE :pattern ESCAPE '\\'
          ORDER BY created_at DESC LIMIT 1`,
        { pattern: `%:${escapeLike(localId)}` },
      ),
    );
    if (!row) throw new Error(`effect ${localId} not found`);
    const found = this.ledger.store.findByIdempotency(text(row, "idempotency_key"));
    if (!found) throw new Error(`effect ${localId} not found`);
    return found;
  }
}

export function bindMigrationState(file: string): MigrationStateStore {
  return new MigrationStateStore(openShipStateFile(file));
}

export function blankPhases(): Record<PhaseName, PhaseRecord> {
  const phases = {} as Record<PhaseName, PhaseRecord>;
  for (const phase of PHASE_ORDER) {
    phases[phase] = { phase, status: "pending", detail: "" };
  }
  return phases;
}

export { PayloadHashMismatchError };

function shipRunFrom(run: PersistedRun, updatedAt: number): CiShipRun {
  return {
    id: run.shipRunId,
    kind: "migration",
    feature: run.migrationId,
    effect: null,
    repo: null,
    prNumber: null,
    headSha: run.commitSha,
    runId: null,
    environment: run.env,
    status: shipStatus(run),
    failureFingerprint: null,
    repairGeneration: 0,
    url: null,
    phase: phaseFor(run),
    updatedAt,
    repairPushesByFingerprint: {},
    totalRepairPushes: 0,
  };
}

function phaseFor(run: PersistedRun): ShipRunPhase {
  if (run.phases.CONTRACT.status === "passed") return "SHIPPED";
  if (run.phases.APP_DEPLOY.status === "passed" || run.phases.APP_DEPLOY.status === "rolled_back") {
    return "DEPLOYING";
  }
  if (run.phases.EXPAND.status === "passed") return "DEPLOYING";
  return "PREFLIGHT";
}

function shipStatus(run: PersistedRun): CiShipRun["status"] {
  if (run.phases.APP_DEPLOY.status === "rolled_back") return "rolled_back";
  const statuses: PhaseStatus[] = PHASE_ORDER.map((phase) => run.phases[phase].status);
  if (statuses.some((status) => status === "failed")) return "failed";
  if (statuses.every((status) => status === "passed" || status === "not_applicable")) return "passed";
  return "running";
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`column ${key} is not text`);
  return value;
}

function nullableText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`column ${key} is not text`);
  return value;
}

function integer(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`column ${key} is not an integer`);
}
