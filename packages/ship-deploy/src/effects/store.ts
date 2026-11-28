import {
  EFFECT_STATES,
  EffectsRepo,
  loadCanonicalSqlAsset,
  openDatabase,
  type EffectRecord as StoredEffect,
  type EffectState,
  type SqliteConnection,
} from "@ef-harness/db";
import type { ApprovalStatus, EffectExecStatus, EffectRecord, TargetEnv } from "./types.js";

/** Live stop bit written by the steering kernel stop controller. */
export const STEERING_CONTROL_STATE_KEY = "steering.control_state";
export const WRITER_EPOCH_META_KEY = "writer_epoch";

interface ApprovalSidecar {
  approvalStatus: ApprovalStatus;
  boundPayloadHash: string | null;
  payloadJson: unknown;
  dispatchedAt: number | null;
  finishedAt: number | null;
}

export interface SqliteEffectStoreOptions {
  readonly connection?: SqliteConnection;
  readonly now?: () => number;
}

export class SqliteEffectStore {
  readonly connection: SqliteConnection;
  private readonly repo: EffectsRepo;
  private readonly now: () => number;
  private injectDispatchFault = false;

  constructor(options: SqliteEffectStoreOptions = {}) {
    this.connection = options.connection ?? openEffectConnection();
    this.repo = new EffectsRepo(this.connection);
    this.now = options.now ?? (() => Date.now());
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
    const drafted = this.repo.record({
      id: record.effectId,
      kind: record.effectType,
      target: record.targetEnv,
      payloadHash: record.canonicalPayloadHash,
      idempotencyKey: record.idempotencyKey,
      approval,
      ...(record.writerEpoch === null ? {} : { leaseEpoch: record.writerEpoch }),
      now: record.createdAt,
    });
    const dbState = mapExecToDbState(record.execStatus, record.approvalStatus);
    if (dbState !== "intended" && drafted.state !== dbState) {
      this.repo.transition(record.effectId, dbState, record.createdAt, {
        approval,
        ...(record.writerEpoch === null ? {} : { leaseEpoch: record.writerEpoch }),
      });
    }
  }

  findByIdempotency(idempotencyKey: string): EffectRecord | null {
    const row = this.repo.findByIdempotencyKey(idempotencyKey);
    return row ? decodeStored(row) : null;
  }

  get(effectId: string): EffectRecord | null {
    const row = this.repo.get(effectId);
    return row ? decodeStored(row) : null;
  }

  listAudit(): EffectRecord[] {
    const rows = this.connection.all("SELECT id FROM effects ORDER BY created_at ASC");
    const records: EffectRecord[] = [];
    for (const row of rows) {
      const id = readText(row, "id");
      const record = this.get(id);
      if (record) records.push(record);
    }
    return records;
  }

  updateApproval(effectId: string, approvalStatus: ApprovalStatus, boundPayloadHash: string | null): void {
    const existing = this.repo.get(effectId);
    if (!existing) return;
    const sidecar = decodeApproval(existing.approval);
    const approval = encodeApproval({
      ...sidecar,
      approvalStatus,
      boundPayloadHash,
    });
    const dbState: EffectState =
      approvalStatus === "approved" || approvalStatus === "auto_allowed" ? "approved" : "intended";
    this.repo.transition(effectId, dbState, this.now(), { approval });
  }

  /**
   * Write-ahead: atomically transition planned/approved → dispatched (`sent`) before network I/O.
   * The fence is the live `meta` writer epoch and steering stop bit, read inside the transaction.
   */
  atomicDispatchTransition(effectId: string, writerEpoch: number, runtimeState: string): void {
    this.connection.transaction(() => {
      const fence = this.readRuntimeFence();
      if (runtimeState === "STOPPED" || fence.state === "STOPPED") {
        throw new Error("project runtime STOPPED");
      }
      if (writerEpoch < fence.writerEpoch) {
        throw new Error("stale writer_epoch");
      }
      if (this.injectDispatchFault) {
        this.injectDispatchFault = false;
        throw new Error("injected dispatch fault");
      }
      const row = this.repo.get(effectId);
      if (!row) {
        throw new Error("effect not found");
      }
      if (row.state !== "approved" && row.state !== "intended") {
        throw new Error(`cannot dispatch from state ${row.state}`);
      }
      const sidecar = decodeApproval(row.approval);
      const approval = encodeApproval({
        ...sidecar,
        dispatchedAt: this.now(),
      });
      this.repo.transition(effectId, "sent", this.now(), { approval, leaseEpoch: writerEpoch });
    });
  }

  markSucceeded(effectId: string, receipt: unknown): void {
    const existing = this.repo.get(effectId);
    if (!existing) throw new Error("effect not found");
    const sidecar = decodeApproval(existing.approval);
    const approval = encodeApproval({ ...sidecar, finishedAt: this.now() });
    this.repo.transition(effectId, "confirmed", this.now(), {
      approval,
      receipt: JSON.stringify(receipt),
    });
  }

  markFailed(effectId: string, receipt: unknown): void {
    const existing = this.repo.get(effectId);
    if (!existing) throw new Error("effect not found");
    const sidecar = decodeApproval(existing.approval);
    const approval = encodeApproval({ ...sidecar, finishedAt: this.now() });
    this.repo.transition(effectId, "failed", this.now(), {
      approval,
      receipt: JSON.stringify(receipt),
    });
  }

  markUnknownOutcome(effectId: string): void {
    this.repo.transition(effectId, "unknown", this.now());
  }

  setRuntimeFence(writerEpoch: number, state: "RUNNING" | "STOPPED"): void {
    this.writeMeta(WRITER_EPOCH_META_KEY, String(writerEpoch));
    this.writeMeta(STEERING_CONTROL_STATE_KEY, state);
  }

  readRuntimeFence(): { writerEpoch: number; state: "RUNNING" | "STOPPED" } {
    const epochRaw = this.readMeta(WRITER_EPOCH_META_KEY);
    const parsed = epochRaw === null ? 1 : Number(epochRaw);
    const writerEpoch = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
    const control = this.readMeta(STEERING_CONTROL_STATE_KEY);
    return { writerEpoch, state: control === "STOPPED" ? "STOPPED" : "RUNNING" };
  }

  private writeMeta(key: string, value: string): void {
    this.connection.run(
      "INSERT INTO meta(key, value) VALUES (:key, :value) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      { key, value },
    );
  }

  private readMeta(key: string): string | null {
    const row = this.connection.get("SELECT value FROM meta WHERE key = :key", { key });
    if (row === undefined || row === null) return null;
    const value = readCell(row, "value");
    if (value === null || value === undefined) return null;
    return String(value);
  }
}

export function openEffectConnection(): SqliteConnection {
  const db = openDatabase({ location: ":memory:", role: "state" });
  db.exec(loadCanonicalSqlAsset("stateSql"));
  db.run("INSERT INTO meta(key, value) VALUES (:key, '1')", { key: WRITER_EPOCH_META_KEY });
  db.run("INSERT INTO meta(key, value) VALUES (:key, 'RUNNING')", { key: STEERING_CONTROL_STATE_KEY });
  return db;
}

function mapExecToDbState(exec: EffectExecStatus, approval: ApprovalStatus): EffectState {
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

function decodeApproval(approval: string | null): ApprovalSidecar {
  if (!approval) {
    return {
      approvalStatus: "pending_approval",
      boundPayloadHash: null,
      payloadJson: {},
      dispatchedAt: null,
      finishedAt: null,
    };
  }
  const parsed: unknown = JSON.parse(approval);
  if (parsed === null || typeof parsed !== "object") {
    return {
      approvalStatus: "pending_approval",
      boundPayloadHash: null,
      payloadJson: {},
      dispatchedAt: null,
      finishedAt: null,
    };
  }
  const row = parsed as Record<string, unknown>;
  const status = row.approvalStatus;
  return {
    approvalStatus: isApprovalStatus(status) ? status : "pending_approval",
    boundPayloadHash: typeof row.boundPayloadHash === "string" ? row.boundPayloadHash : null,
    payloadJson: row.payloadJson ?? {},
    dispatchedAt: typeof row.dispatchedAt === "number" ? row.dispatchedAt : null,
    finishedAt: typeof row.finishedAt === "number" ? row.finishedAt : null,
  };
}

function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return (
    value === "pending_approval" ||
    value === "approved" ||
    value === "denied" ||
    value === "auto_allowed" ||
    value === "approval_stale_payload_changed"
  );
}

function decodeStored(row: StoredEffect): EffectRecord {
  const sidecar = decodeApproval(row.approval);
  if (!(EFFECT_STATES as readonly string[]).includes(row.state)) {
    throw new Error(`unsupported effect state: ${row.state}`);
  }
  return {
    effectId: row.id,
    effectType: row.kind,
    targetEnv: row.target as TargetEnv,
    canonicalPayloadHash: row.payloadHash,
    idempotencyKey: row.idempotencyKey,
    writerEpoch: row.leaseEpoch,
    approvalStatus: sidecar.approvalStatus,
    boundApprovalPayloadHash: sidecar.boundPayloadHash,
    execStatus: mapDbToExec(row.state),
    payloadJson: sidecar.payloadJson,
    remoteReceiptJson: parseReceipt(row.receipt),
    createdAt: row.createdAt,
    dispatchedAt: sidecar.dispatchedAt,
    finishedAt: sidecar.finishedAt,
  };
}

function parseReceipt(receipt: string | null): unknown {
  if (receipt === null) return null;
  return JSON.parse(receipt);
}

function readCell(row: unknown, key: string): unknown {
  if (row === null || typeof row !== "object") return undefined;
  return Reflect.get(row, key);
}

function readText(row: unknown, key: string): string {
  const value = readCell(row, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`effects.${key} is not text`);
  }
  return value;
}
