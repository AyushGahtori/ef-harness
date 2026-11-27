import { toBareSha256Hex } from "@ef-harness/shared-contracts";
import type { SqliteConnection } from "../driver/types.js";

export const EFFECT_STATES = ["intended", "approved", "sent", "confirmed", "failed", "unknown"] as const;

export type EffectState = (typeof EFFECT_STATES)[number];

export interface EffectDraft {
  readonly id: string;
  readonly kind: string;
  readonly target: string;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
  readonly approval?: string;
  readonly leaseEpoch?: number;
  readonly now: number;
}

export interface EffectPatch {
  readonly approval?: string;
  readonly receipt?: string;
  readonly leaseEpoch?: number;
}

export interface EffectRecord {
  readonly id: string;
  readonly kind: string;
  readonly target: string;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
  readonly approval: string | null;
  readonly leaseEpoch: number | null;
  readonly state: EffectState;
  readonly receipt: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export class PayloadHashMismatchError extends Error {
  readonly code = "PAYLOAD_HASH_MISMATCH" as const;
  readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super(`effect idempotency key ${idempotencyKey} was reused with a different payload hash`);
    this.name = "PayloadHashMismatchError";
    this.idempotencyKey = idempotencyKey;
  }
}

/**
 * Ledger for `state.db.effects`. Payload hashes are stored as bare 64-hex SHA-256.
 * The same idempotency key with the same hash returns the existing row.
 */
export class EffectsRepo {
  constructor(private readonly db: SqliteConnection) {}

  record(draft: EffectDraft): EffectRecord {
    assertText("id", draft.id);
    assertText("kind", draft.kind);
    assertText("target", draft.target);
    assertText("idempotencyKey", draft.idempotencyKey);
    const payloadHash = toBareSha256Hex(draft.payloadHash);
    const existing = this.findByIdempotencyKey(draft.idempotencyKey);
    if (existing) {
      if (existing.payloadHash !== payloadHash) throw new PayloadHashMismatchError(draft.idempotencyKey);
      return existing;
    }
    this.db.run(
      `INSERT INTO effects(
         id, kind, target, payload_hash, idempotency_key, approval, lease_epoch, state, receipt, created_at, updated_at
       ) VALUES (
         :id, :kind, :target, :payload_hash, :idempotency_key, :approval, :lease_epoch, 'intended', NULL, :now, :now
       )`,
      {
        id: draft.id,
        kind: draft.kind,
        target: draft.target,
        payload_hash: payloadHash,
        idempotency_key: draft.idempotencyKey,
        approval: draft.approval ?? null,
        lease_epoch: draft.leaseEpoch ?? null,
        now: draft.now,
      },
    );
    return this.require(draft.id);
  }

  get(id: string): EffectRecord | null {
    const row = this.db.get(
      `SELECT id, kind, target, payload_hash, idempotency_key, approval, lease_epoch, state, receipt, created_at, updated_at
         FROM effects WHERE id = :id`,
      { id },
    );
    if (row === undefined || row === null) return null;
    return readEffect(row);
  }

  findByIdempotencyKey(idempotencyKey: string): EffectRecord | null {
    const row = this.db.get(
      `SELECT id, kind, target, payload_hash, idempotency_key, approval, lease_epoch, state, receipt, created_at, updated_at
         FROM effects WHERE idempotency_key = :idempotency_key`,
      { idempotency_key: idempotencyKey },
    );
    if (row === undefined || row === null) return null;
    return readEffect(row);
  }

  transition(id: string, state: EffectState, at: number, patch: EffectPatch = {}): EffectRecord {
    assertState(state);
    const current = this.require(id);
    const approval = patch.approval === undefined ? current.approval : patch.approval;
    const receipt = patch.receipt === undefined ? current.receipt : patch.receipt;
    const leaseEpoch = patch.leaseEpoch === undefined ? current.leaseEpoch : patch.leaseEpoch;
    this.db.run(
      `UPDATE effects
          SET state = :state,
              approval = :approval,
              receipt = :receipt,
              lease_epoch = :lease_epoch,
              updated_at = :updated_at
        WHERE id = :id`,
      {
        id,
        state,
        approval,
        receipt,
        lease_epoch: leaseEpoch,
        updated_at: at,
      },
    );
    return this.require(id);
  }

  private require(id: string): EffectRecord {
    const row = this.get(id);
    if (!row) throw new Error(`effect ${id} is missing`);
    return row;
  }
}

function assertText(label: string, value: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`effect ${label} must be a non-empty string`);
  }
}

function assertState(state: string): asserts state is EffectState {
  if (!(EFFECT_STATES as readonly string[]).includes(state)) {
    throw new TypeError(`unsupported effect state: ${state}`);
  }
}

function readEffect(value: unknown): EffectRecord {
  if (value === null || typeof value !== "object") throw new Error("effect row was not an object");
  const state = cellText(value, "state");
  assertState(state);
  return {
    id: cellText(value, "id"),
    kind: cellText(value, "kind"),
    target: cellText(value, "target"),
    payloadHash: cellText(value, "payload_hash"),
    idempotencyKey: cellText(value, "idempotency_key"),
    approval: cellNullableText(value, "approval"),
    leaseEpoch: cellNullableInt(value, "lease_epoch"),
    state,
    receipt: cellNullableText(value, "receipt"),
    createdAt: cellInt(value, "created_at"),
    updatedAt: cellInt(value, "updated_at"),
  };
}

function cell(row: object, key: string): unknown {
  return Reflect.get(row, key);
}

function cellText(row: object, key: string): string {
  const value = cell(row, key);
  if (typeof value !== "string") throw new Error(`effects.${key} is not text`);
  return value;
}

function cellNullableText(row: object, key: string): string | null {
  const value = cell(row, key);
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(`effects.${key} is not text`);
  return value;
}

function cellInt(row: object, key: string): number {
  const value = cellNullableInt(row, key);
  if (value === null) throw new Error(`effects.${key} is not an integer`);
  return value;
}

function cellNullableInt(row: object, key: string): number | null {
  const value = cell(row, key);
  if (value == null) return null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`effects.${key} is not an integer`);
}
