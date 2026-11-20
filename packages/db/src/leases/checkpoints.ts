import type { LeaseDatabase, SqlBindValue } from "./db-port.js";
import { runImmediate } from "./db-port.js";
import { asNumber, asNullableString, asString, rowField } from "./rows.js";

export type JsonValue =
  | null
  | string
  | number
  | boolean
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface AttemptCheckpoint {
  readonly attemptId: string;
  readonly step: number;
  readonly wipRef: string | null;
  readonly sessionRef: string | null;
  readonly contractVersions: Readonly<Record<string, number>>;
  readonly pendingEffects: readonly JsonValue[];
  readonly handoffArtifact: string | null;
  readonly updatedAt: number;
}

export interface AttemptCheckpointWrite {
  readonly attemptId: string;
  readonly step: number;
  readonly wipRef: string | null;
  readonly sessionRef: string | null;
  readonly contractVersions: Readonly<Record<string, number>>;
  readonly pendingEffects: readonly JsonValue[];
  readonly handoffArtifact: string | null;
  readonly updatedAt: number;
}

const UPSERT_SQL = `
INSERT INTO attempt_checkpoints (
  attempt, step, wip_ref, session_ref, contract_versions, pending_effects, handoff_artifact, updated_at
) VALUES (
  :attempt, :step, :wip_ref, :session_ref, :contract_versions, :pending_effects, :handoff_artifact, :updated_at
)
ON CONFLICT(attempt) DO UPDATE SET
  step = excluded.step,
  wip_ref = excluded.wip_ref,
  session_ref = excluded.session_ref,
  contract_versions = excluded.contract_versions,
  pending_effects = excluded.pending_effects,
  handoff_artifact = excluded.handoff_artifact,
  updated_at = excluded.updated_at
`;

const READ_SQL = `
SELECT attempt, step, wip_ref, session_ref, contract_versions, pending_effects, handoff_artifact, updated_at
  FROM attempt_checkpoints
 WHERE attempt = :attempt
`;

export class AttemptCheckpointRepo {
  constructor(private readonly db: LeaseDatabase) {}

  write(checkpoint: AttemptCheckpointWrite): void {
    const params = checkpointParams(checkpoint);
    runImmediate(this.db, () => {
      this.db.prepare(UPSERT_SQL).run(params);
    });
  }

  read(attemptId: string): AttemptCheckpoint | null {
    if (attemptId.length === 0) throw new Error("attempt id is required");
    const row = this.db.prepare(READ_SQL).get({ attempt: attemptId });
    if (row === undefined || row === null) return null;
    return {
      attemptId: asString(rowField(row, "attempt"), "attempt"),
      step: asNumber(rowField(row, "step"), "step"),
      wipRef: asNullableString(rowField(row, "wip_ref"), "wip_ref"),
      sessionRef: asNullableString(rowField(row, "session_ref"), "session_ref"),
      contractVersions: parseContractVersions(asString(rowField(row, "contract_versions"), "contract_versions")),
      pendingEffects: parsePendingEffects(asString(rowField(row, "pending_effects"), "pending_effects")),
      handoffArtifact: asNullableString(rowField(row, "handoff_artifact"), "handoff_artifact"),
      updatedAt: asNumber(rowField(row, "updated_at"), "updated_at"),
    };
  }
}

function checkpointParams(checkpoint: AttemptCheckpointWrite): Record<string, SqlBindValue> {
  if (checkpoint.attemptId.length === 0) throw new Error("attempt id is required");
  if (!Number.isSafeInteger(checkpoint.step) || checkpoint.step < 0) {
    throw new Error("checkpoint step must be a non-negative integer");
  }
  if (!Number.isSafeInteger(checkpoint.updatedAt)) {
    throw new Error("checkpoint updatedAt must be an integer");
  }
  return {
    attempt: checkpoint.attemptId,
    step: checkpoint.step,
    wip_ref: checkpoint.wipRef,
    session_ref: checkpoint.sessionRef,
    contract_versions: stringifyContractVersions(checkpoint.contractVersions),
    pending_effects: stringifyPendingEffects(checkpoint.pendingEffects),
    handoff_artifact: checkpoint.handoffArtifact,
    updated_at: checkpoint.updatedAt,
  };
}

function stringifyContractVersions(versions: Readonly<Record<string, number>>): string {
  const normalized: Record<string, number> = {};
  for (const [key, version] of Object.entries(versions)) {
    if (!Number.isSafeInteger(version)) {
      throw new Error(`contract version ${key} must be an integer`);
    }
    normalized[key] = version;
  }
  return JSON.stringify(normalized);
}

function stringifyPendingEffects(effects: readonly JsonValue[]): string {
  if (!Array.isArray(effects)) throw new Error("pendingEffects must be an array");
  return JSON.stringify(effects.map(parseJsonValue));
}

function parseContractVersions(text: string): Record<string, number> {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("contract_versions must be a JSON object");
  }
  const versions: Record<string, number> = {};
  for (const [key, version] of Object.entries(parsed)) {
    if (typeof version !== "number" || !Number.isSafeInteger(version)) {
      throw new Error(`contract version ${key} must be an integer`);
    }
    versions[key] = version;
  }
  return versions;
}

function parsePendingEffects(text: string): JsonValue[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("pending_effects must be a JSON array");
  return parsed.map(parseJsonValue);
}

function parseJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("checkpoint JSON number must be finite");
    return value;
  }
  if (Array.isArray(value)) return value.map(parseJsonValue);
  if (typeof value === "object") {
    const record: { [key: string]: JsonValue } = {};
    for (const [key, inner] of Object.entries(value)) {
      record[key] = parseJsonValue(inner);
    }
    return record;
  }
  throw new Error("checkpoint JSON value is not supported");
}
