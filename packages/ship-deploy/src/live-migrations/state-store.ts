import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { EffectDraft, ExternalEffectLedger } from "./ports.js";
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

export interface ShipRunDraft {
  id: string;
  effectId: string | null;
  headSha: string;
  environment: string;
  status: "pending" | "running" | "passed" | "failed" | "cancelled" | "rolled_back";
}

export class MigrationStateStore implements ExternalEffectLedger {
  private readonly db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static open(file: string): MigrationStateStore {
    const db = new DatabaseSync(file);
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    const meta = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get() as
      | { ok: number }
      | undefined;
    if (!meta) {
      db.exec(readFileSync(stateSchemaPath(), "utf8"));
    }
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(`
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
    `);
    return new MigrationStateStore(db);
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  saveRun(run: PersistedRun): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO live_migration_runs (
           migration_id, env, dialect, commit_sha, previous_commit_sha, sql_sha256, current_phase,
           phase_json, classification_json, backup_json, deploy_json, extra_json, ship_run_id, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(migration_id) DO UPDATE SET
           current_phase = excluded.current_phase,
           phase_json = excluded.phase_json,
           classification_json = excluded.classification_json,
           backup_json = excluded.backup_json,
           deploy_json = excluded.deploy_json,
           extra_json = excluded.extra_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        run.migrationId,
        run.env,
        run.dialect,
        run.commitSha,
        run.previousCommitSha,
        run.sqlSha256,
        run.currentPhase,
        JSON.stringify(run.phases),
        JSON.stringify(run.classification),
        run.backup ? JSON.stringify(run.backup) : null,
        run.deploy ? JSON.stringify(run.deploy) : null,
        JSON.stringify({
          rolledBackTo: run.rolledBackTo,
          contractExportPath: run.contractExportPath,
          fastPath: run.fastPath,
          detail: run.detail,
        } satisfies RunExtra),
        run.shipRunId,
        now,
      );
    this.upsertShipRun({
      id: run.shipRunId,
      effectId: null,
      headSha: run.commitSha,
      environment: run.env,
      status: shipStatus(run),
    });
  }

  getRun(migrationId: string): PersistedRun | null {
    const row = this.db
      .prepare(
        `SELECT migration_id, env, dialect, commit_sha, previous_commit_sha, sql_sha256, current_phase,
                phase_json, classification_json, backup_json, deploy_json, extra_json, ship_run_id
         FROM live_migration_runs WHERE migration_id = ?`,
      )
      .get(migrationId) as
      | {
          migration_id: string;
          env: string;
          dialect: string;
          commit_sha: string;
          previous_commit_sha: string;
          sql_sha256: string;
          current_phase: string;
          phase_json: string;
          classification_json: string;
          backup_json: string | null;
          deploy_json: string | null;
          extra_json: string;
          ship_run_id: string;
        }
      | undefined;
    if (!row) return null;
    const extra = JSON.parse(row.extra_json) as RunExtra;
    return {
      migrationId: row.migration_id,
      env: row.env as TargetEnv,
      dialect: row.dialect as SqlDialect,
      commitSha: row.commit_sha,
      previousCommitSha: row.previous_commit_sha,
      sqlSha256: row.sql_sha256,
      currentPhase: row.current_phase as PhaseName,
      phases: JSON.parse(row.phase_json) as Record<PhaseName, PhaseRecord>,
      classification: JSON.parse(row.classification_json) as DdlClassification,
      backup: row.backup_json ? (JSON.parse(row.backup_json) as BackupReceipt) : null,
      deploy: row.deploy_json ? (JSON.parse(row.deploy_json) as DeployResult) : null,
      rolledBackTo: extra.rolledBackTo,
      contractExportPath: extra.contractExportPath,
      fastPath: extra.fastPath,
      shipRunId: row.ship_run_id,
      detail: extra.detail,
    };
  }

  saveCursor(migrationId: string, cursor: BackfillCheckpoint): void {
    this.db
      .prepare(
        `INSERT INTO live_migration_backfill_cursors (
           migration_id, backfill_id, last_processed_pk, rows_processed, rows_remaining_est, rows_total,
           batch_errors_json, paused, last_batch_ms, progress_text, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      )
      .run(
        migrationId,
        cursor.backfillId,
        cursor.lastProcessedPk,
        cursor.rowsProcessed,
        cursor.rowsRemainingEst,
        cursor.rowsTotal,
        JSON.stringify(cursor.batchErrors),
        cursor.paused ? 1 : 0,
        cursor.lastBatchMs,
        cursor.progressText,
        Date.now(),
      );
  }

  latestCursor(migrationId: string): BackfillCheckpoint | null {
    const row = this.db
      .prepare(
        `SELECT backfill_id FROM live_migration_backfill_cursors
         WHERE migration_id = ? ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(migrationId) as { backfill_id: string } | undefined;
    if (!row) return null;
    return this.getCursor(migrationId, row.backfill_id);
  }

  getCursor(migrationId: string, backfillId: string): BackfillCheckpoint | null {
    const row = this.db
      .prepare(
        `SELECT backfill_id, last_processed_pk, rows_processed, rows_remaining_est, rows_total,
                batch_errors_json, paused, last_batch_ms, progress_text
         FROM live_migration_backfill_cursors
         WHERE migration_id = ? AND backfill_id = ?`,
      )
      .get(migrationId, backfillId) as
      | {
          backfill_id: string;
          last_processed_pk: string | null;
          rows_processed: number;
          rows_remaining_est: number;
          rows_total: number;
          batch_errors_json: string;
          paused: number;
          last_batch_ms: number;
          progress_text: string;
        }
      | undefined;
    if (!row) return null;
    return {
      backfillId: row.backfill_id,
      lastProcessedPk: row.last_processed_pk,
      nextPk: nextIntegerPk(row.last_processed_pk),
      rowsProcessed: row.rows_processed,
      rowsRemainingEst: row.rows_remaining_est,
      rowsTotal: row.rows_total,
      batchErrors: JSON.parse(row.batch_errors_json) as string[],
      paused: row.paused === 1,
      lastBatchMs: row.last_batch_ms,
      progressText: row.progress_text,
    };
  }

  record(effect: EffectDraft): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO effects (
           id, kind, target, payload_hash, idempotency_key, approval, lease_epoch, state, receipt, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
         ON CONFLICT(idempotency_key) DO UPDATE SET
           state = excluded.state,
           approval = excluded.approval,
           receipt = excluded.receipt,
           payload_hash = excluded.payload_hash,
           updated_at = excluded.updated_at`,
      )
      .run(
        effect.id,
        effect.kind,
        effect.target,
        effect.payloadHash,
        effect.idempotencyKey,
        effect.approval,
        effect.state,
        effect.receipt,
        now,
        now,
      );
  }

  update(id: string, state: EffectDraft["state"], receipt: string | null): void {
    this.db
      .prepare("UPDATE effects SET state = ?, receipt = ?, updated_at = ? WHERE id = ?")
      .run(state, receipt, Date.now(), id);
  }

  upsertShipRun(row: ShipRunDraft): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO ship_runs (
           id, kind, effect, head_sha, environment, status, repair_generation, updated_at
         ) VALUES (?, 'migration', ?, ?, ?, ?, 0, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           effect = COALESCE(excluded.effect, ship_runs.effect),
           head_sha = excluded.head_sha,
           updated_at = excluded.updated_at`,
      )
      .run(row.id, row.effectId, row.headSha, row.environment, row.status, now);
  }

  countEffects(kind: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM effects WHERE kind = ?").get(kind) as
      | { c: number | bigint }
      | undefined;
    const count = row?.c ?? 0;
    return typeof count === "bigint" ? Number(count) : count;
  }
}

export function stateSchemaPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../schema/state.sql");
}

export function blankPhases(): Record<PhaseName, PhaseRecord> {
  const phases = {} as Record<PhaseName, PhaseRecord>;
  for (const phase of PHASE_ORDER) {
    phases[phase] = { phase, status: "pending", detail: "" };
  }
  return phases;
}

function shipStatus(run: PersistedRun): ShipRunDraft["status"] {
  if (run.phases.APP_DEPLOY.status === "rolled_back") return "rolled_back";
  const statuses: PhaseStatus[] = PHASE_ORDER.map((phase) => run.phases[phase].status);
  if (statuses.some((status) => status === "failed")) return "failed";
  if (statuses.every((status) => status === "passed" || status === "not_applicable")) return "passed";
  return "running";
}
