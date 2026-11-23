import { DatabaseSync } from "node:sqlite";
import type { ApprovalStatus, EffectExecStatus, EffectRecord, TargetEnv } from "./types.js";

/** Frozen `effects` table from `schema/state.sql`. */
const EFFECTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS effects (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  target          TEXT NOT NULL,
  payload_hash    TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  approval        TEXT,
  lease_epoch     INTEGER,
  state           TEXT NOT NULL CHECK (state IN ('intended','approved','sent','confirmed','failed','unknown')),
  receipt         TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS project_runtime (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  writer_epoch INTEGER NOT NULL,
  state TEXT NOT NULL
);
INSERT OR IGNORE INTO project_runtime (singleton, writer_epoch, state) VALUES (1, 1, 'RUNNING');
`;

interface ApprovalSidecar {
  approvalStatus: ApprovalStatus;
  boundPayloadHash: string | null;
  payloadJson: unknown;
  dispatchedAt: number | null;
  finishedAt: number | null;
}

export interface SqliteEffectStoreOptions {
  readonly database?: DatabaseSync;
  readonly now?: () => number;
}

export class SqliteEffectStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private injectDispatchFault = false;

  constructor(options: SqliteEffectStoreOptions = {}) {
    this.db = options.database ?? new DatabaseSync(":memory:");
    this.now = options.now ?? (() => Date.now());
    this.db.exec(EFFECTS_SCHEMA);
  }

  /** Test hook: the next dispatch transition throws after BEGIN IMMEDIATE. */
  injectNextDispatchFault(): void {
    this.injectDispatchFault = true;
  }

  insertPlanned(record: Omit<EffectRecord, "dispatchedAt" | "finishedAt">): void {
    const approval = encodeApproval({
      approvalStatus: record.approvalStatus,
      boundPayloadHash: record.boundApprovalPayloadHash,
      payloadJson: record.payloadJson,
      dispatchedAt: null,
      finishedAt: null,
    });
    this.db
      .prepare(
        `INSERT INTO effects (
           id, kind, target, payload_hash, idempotency_key, approval, lease_epoch, state, receipt, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.effectId,
        record.effectType,
        record.targetEnv,
        record.canonicalPayloadHash,
        record.idempotencyKey,
        approval,
        record.writerEpoch,
        mapExecToDbState(record.execStatus, record.approvalStatus),
        record.remoteReceiptJson === null ? null : JSON.stringify(record.remoteReceiptJson),
        record.createdAt,
        record.createdAt,
      );
  }

  findByIdempotency(idempotencyKey: string): EffectRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, kind, target, payload_hash, idempotency_key, approval, lease_epoch, state, receipt, created_at, updated_at
         FROM effects WHERE idempotency_key = ?`,
      )
      .get(idempotencyKey) as Record<string, unknown> | undefined;
    return row ? decodeRow(row) : null;
  }

  get(effectId: string): EffectRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, kind, target, payload_hash, idempotency_key, approval, lease_epoch, state, receipt, created_at, updated_at
         FROM effects WHERE id = ?`,
      )
      .get(effectId) as Record<string, unknown> | undefined;
    return row ? decodeRow(row) : null;
  }

  listAudit(): EffectRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, kind, target, payload_hash, idempotency_key, approval, lease_epoch, state, receipt, created_at, updated_at
         FROM effects ORDER BY created_at ASC`,
      )
      .all() as Record<string, unknown>[];
    return rows.map((row) => decodeRow(row));
  }

  updateApproval(effectId: string, approvalStatus: ApprovalStatus, boundPayloadHash: string | null): void {
    const existing = this.get(effectId);
    if (!existing) return;
    const sidecar = decodeApproval(
      this.db.prepare("SELECT approval FROM effects WHERE id = ?").get(effectId) as { approval: string | null },
    );
    const approval = encodeApproval({
      ...sidecar,
      approvalStatus,
      boundPayloadHash,
    });
    const dbState =
      approvalStatus === "approved" || approvalStatus === "auto_allowed" ? "approved" : "intended";
    this.db
      .prepare(`UPDATE effects SET approval = ?, state = ?, updated_at = ? WHERE id = ?`)
      .run(approval, dbState, this.now(), effectId);
  }

  /**
   * Write-ahead: atomically transition planned/approved → dispatched (`sent`) before network I/O.
   */
  atomicDispatchTransition(effectId: string, writerEpoch: number, runtimeState: string): void {
    if (runtimeState === "STOPPED") {
      throw new Error("project runtime STOPPED");
    }
    const fence = this.db
      .prepare(`SELECT writer_epoch FROM project_runtime WHERE singleton = 1`)
      .get() as { writer_epoch: number };
    if (writerEpoch < fence.writer_epoch) {
      throw new Error("stale writer_epoch");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.injectDispatchFault) {
        this.injectDispatchFault = false;
        throw new Error("injected dispatch fault");
      }
      const row = this.db
        .prepare(`SELECT state, approval FROM effects WHERE id = ?`)
        .get(effectId) as { state: string; approval: string | null } | undefined;
      if (!row) {
        throw new Error("effect not found");
      }
      if (row.state !== "approved" && row.state !== "intended") {
        throw new Error(`cannot dispatch from state ${row.state}`);
      }
      const sidecar = decodeApproval(row);
      const approval = encodeApproval({
        ...sidecar,
        dispatchedAt: this.now(),
      });
      this.db
        .prepare(`UPDATE effects SET state = 'sent', lease_epoch = ?, approval = ?, updated_at = ? WHERE id = ?`)
        .run(writerEpoch, approval, this.now(), effectId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  markSucceeded(effectId: string, receipt: unknown): void {
    const sidecar = decodeApproval(
      this.db.prepare(`SELECT approval FROM effects WHERE id = ?`).get(effectId) as { approval: string | null },
    );
    const approval = encodeApproval({ ...sidecar, finishedAt: this.now() });
    this.db
      .prepare(`UPDATE effects SET state = 'confirmed', receipt = ?, approval = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(receipt), approval, this.now(), effectId);
  }

  markFailed(effectId: string, receipt: unknown): void {
    const sidecar = decodeApproval(
      this.db.prepare(`SELECT approval FROM effects WHERE id = ?`).get(effectId) as { approval: string | null },
    );
    const approval = encodeApproval({ ...sidecar, finishedAt: this.now() });
    this.db
      .prepare(`UPDATE effects SET state = 'failed', receipt = ?, approval = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(receipt), approval, this.now(), effectId);
  }

  markUnknownOutcome(effectId: string): void {
    this.db
      .prepare(`UPDATE effects SET state = 'unknown', updated_at = ? WHERE id = ?`)
      .run(this.now(), effectId);
  }

  setRuntimeFence(writerEpoch: number, state: "RUNNING" | "STOPPED"): void {
    this.db
      .prepare(`UPDATE project_runtime SET writer_epoch = ?, state = ? WHERE singleton = 1`)
      .run(writerEpoch, state);
  }

  readRuntimeFence(): { writerEpoch: number; state: "RUNNING" | "STOPPED" } {
    const row = this.db
      .prepare(`SELECT writer_epoch, state FROM project_runtime WHERE singleton = 1`)
      .get() as { writer_epoch: number; state: "RUNNING" | "STOPPED" };
    return { writerEpoch: row.writer_epoch, state: row.state };
  }
}

function mapExecToDbState(exec: EffectExecStatus, approval: ApprovalStatus): string {
  if (exec === "dispatched") return "sent";
  if (exec === "succeeded") return "confirmed";
  if (exec === "failed") return "failed";
  if (exec === "unknown_outcome") return "unknown";
  if (approval === "approved" || approval === "auto_allowed") return "approved";
  return "intended";
}

function mapDbToExec(state: string): EffectExecStatus {
  switch (state) {
    case "sent":
      return "dispatched";
    case "confirmed":
      return "succeeded";
    case "failed":
      return "failed";
    case "unknown":
      return "unknown_outcome";
    default:
      return "planned";
  }
}

function encodeApproval(sidecar: ApprovalSidecar): string {
  return JSON.stringify(sidecar);
}

function decodeApproval(row: { approval: string | null }): ApprovalSidecar {
  if (!row.approval) {
    return {
      approvalStatus: "pending_approval",
      boundPayloadHash: null,
      payloadJson: {},
      dispatchedAt: null,
      finishedAt: null,
    };
  }
  const parsed = JSON.parse(row.approval) as ApprovalSidecar;
  return parsed;
}

function decodeRow(row: Record<string, unknown>): EffectRecord {
  const sidecar = decodeApproval({ approval: row.approval as string | null });
  const dbState = String(row.state);
  return {
    effectId: String(row.id),
    effectType: String(row.kind),
    targetEnv: String(row.target) as TargetEnv,
    canonicalPayloadHash: String(row.payload_hash),
    idempotencyKey: String(row.idempotency_key),
    writerEpoch: row.lease_epoch === null ? null : Number(row.lease_epoch),
    approvalStatus: sidecar.approvalStatus,
    boundApprovalPayloadHash: sidecar.boundPayloadHash,
    execStatus: mapDbToExec(dbState),
    payloadJson: sidecar.payloadJson,
    remoteReceiptJson:
      row.receipt === null || row.receipt === undefined ? null : JSON.parse(String(row.receipt)),
    createdAt: Number(row.created_at),
    dispatchedAt: sidecar.dispatchedAt,
    finishedAt: sidecar.finishedAt,
  };
}