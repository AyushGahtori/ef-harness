import { createHash } from "node:crypto";
import { BackupNotVerifiedError, ForwardOnlyCheckpointError, NewerSchemaVersionError } from "./errors.js";
import {
  CURRENT_SUPPORTED_SCHEMA_VERSION,
  DowngradeProtectionGuard,
  newerSchemaMessage,
} from "./downgrade-protection-guard.js";
import type { CheckpointRecord, CheckpointStorePort, MigrationAndRebuildEnginePort } from "./ports.js";

export { CURRENT_SUPPORTED_SCHEMA_VERSION };

export const HARNESS_INTEGRATION_REF = "refs/heads/harness/integration";

export type UpcastResult =
  | {
      readonly action: "resume";
      readonly record: CheckpointRecord;
    }
  | {
      readonly action: "fresh_retry";
      readonly record: CheckpointRecord;
      readonly preserveIntegration: true;
      readonly reason: "irreversibly_obsolete_checkpoint";
    };

type Payload = Record<string, unknown>;
type Step = (payload: Readonly<Record<string, unknown>>) => Payload | null;

function clonePayload(payload: Readonly<Record<string, unknown>>): Payload {
  return structuredClone(payload) as Payload;
}

function asString(payload: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

export function deterministicResumeToken(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\n"), "utf8").digest("hex");
}

function attemptV1ToV2(payload: Readonly<Record<string, unknown>>): Payload | null {
  const taskId = asString(payload, "taskId");
  const wipRef = asString(payload, "wipRef");
  const sessionRef = asString(payload, "sessionRef");
  const handoffNote = asString(payload, "handoffNote");
  if (taskId === null || wipRef === null || sessionRef === null || handoffNote === null) return null;
  const next = clonePayload(payload);
  next.schemaVersion = 2;
  next.contractVersions = {
    prompt: asString(payload, "promptVersion") ?? "unrecorded",
    skill: asString(payload, "skillVersion") ?? "unrecorded",
  };
  next.pendingEffects = Array.isArray(payload.pendingEffects) ? [...payload.pendingEffects] : [];
  next.resumeToken = deterministicResumeToken([taskId, wipRef, sessionRef]);
  return next;
}

function attemptV2ToV3(payload: Readonly<Record<string, unknown>>): Payload | null {
  if (asString(payload, "taskId") === null || asString(payload, "resumeToken") === null) return null;
  const next = clonePayload(payload);
  next.schemaVersion = 3;
  next.parkedAtEpochMs = typeof payload.parkedAtEpochMs === "number" ? payload.parkedAtEpochMs : 0;
  return next;
}

function shipV1ToV2(payload: Readonly<Record<string, unknown>>): Payload | null {
  const runId = asString(payload, "runId");
  const taskId = asString(payload, "taskId");
  const status = asString(payload, "status");
  if (runId === null || taskId === null || status === null) return null;
  const next = clonePayload(payload);
  next.schemaVersion = 2;
  next.receiptDigest = deterministicResumeToken([runId, taskId, status]);
  return next;
}

function shipV2ToV3(payload: Readonly<Record<string, unknown>>): Payload | null {
  const status = asString(payload, "status");
  if (status === null || asString(payload, "receiptDigest") === null) return null;
  const next = clonePayload(payload);
  next.schemaVersion = 3;
  next.resumable = status !== "abandoned";
  return next;
}

function verificationV1ToV2(payload: Readonly<Record<string, unknown>>): Payload | null {
  if (asString(payload, "taskId") === null || typeof payload.passed !== "boolean") return null;
  const next = clonePayload(payload);
  next.schemaVersion = 2;
  next.checks = Array.isArray(payload.checks) ? payload.checks.filter((item) => typeof item === "string") : [];
  return next;
}

function verificationV2ToV3(payload: Readonly<Record<string, unknown>>): Payload | null {
  if (asString(payload, "taskId") === null || !Array.isArray(payload.checks)) return null;
  const next = clonePayload(payload);
  next.schemaVersion = 3;
  next.integrationIntact = true;
  return next;
}

const UPCASTERS: Record<string, Record<number, Step>> = {
  attempt_checkpoint: { 1: attemptV1ToV2, 2: attemptV2ToV3 },
  ship_run: { 1: shipV1ToV2, 2: shipV2ToV3 },
  verification_state: { 1: verificationV1ToV2, 2: verificationV2ToV3 },
};

function stripIntegrationOverride(payload: Payload): Payload {
  const next = { ...payload };
  delete next.integrationRef;
  return next;
}

function taskIdOf(payload: Payload, fallback: string | null): string | null {
  return typeof payload.taskId === "string" ? payload.taskId : fallback;
}

/**
 * Pure forward-only checkpoint upcasters (`v1 → v2 → v3`).
 * Persisting the result goes through a backup-protected transaction on Task 015's engine.
 */
export class CheckpointSchemaUpcasterRegistry {
  private readonly guard: DowngradeProtectionGuard;

  constructor(
    private readonly migrations: MigrationAndRebuildEnginePort,
    private readonly store: CheckpointStorePort,
    guard?: DowngradeProtectionGuard,
  ) {
    this.guard = guard ?? new DowngradeProtectionGuard();
  }

  upcast(record: CheckpointRecord, targetVersion = CURRENT_SUPPORTED_SCHEMA_VERSION): UpcastResult {
    if (!Number.isInteger(record.schemaVersion) || record.schemaVersion > CURRENT_SUPPORTED_SCHEMA_VERSION) {
      throw new NewerSchemaVersionError(newerSchemaMessage("a newer version"), "state.db");
    }
    if (!Number.isInteger(targetVersion) || targetVersion > CURRENT_SUPPORTED_SCHEMA_VERSION) {
      throw new NewerSchemaVersionError(newerSchemaMessage("a newer version"), "state.db");
    }
    if (targetVersion < record.schemaVersion) {
      throw new ForwardOnlyCheckpointError(record.schemaVersion, targetVersion);
    }
    if (record.schemaVersion < 1 || UPCASTERS[record.kind] === undefined) {
      return this.freshRetry(record);
    }
    let version = record.schemaVersion;
    let payload: Payload = clonePayload(record.payload);
    while (version < targetVersion) {
      const step = UPCASTERS[record.kind]?.[version];
      if (step === undefined) return this.freshRetry(record);
      const upgraded = step(payload);
      if (upgraded === null) return this.freshRetry(record);
      payload = upgraded;
      version += 1;
    }
    const resumePayload = stripIntegrationOverride(payload);
    resumePayload.schemaVersion = version;
    return {
      action: "resume",
      record: {
        id: record.id,
        kind: record.kind,
        schemaVersion: version,
        taskId: taskIdOf(resumePayload, record.taskId),
        payload: resumePayload,
        integrationRef: record.integrationRef,
        resumeDisposition: "resume",
      },
    };
  }

  async upcastStored(
    record: CheckpointRecord,
    openedByAppVersion: string,
    targetVersion = CURRENT_SUPPORTED_SCHEMA_VERSION,
  ): Promise<UpcastResult> {
    this.guard.assertCanOpen({
      databaseName: "state.db",
      schemaVersion: record.schemaVersion,
      openedByAppVersion,
    });
    const backup = await this.migrations.createVerifiedBackup();
    if (!backup.verified) throw new BackupNotVerifiedError(backup.snapshotPath);
    return this.migrations.runBackupProtectedTransaction(() => {
      const result = this.upcast(record, targetVersion);
      this.store.write(result.record);
      return result;
    });
  }

  private freshRetry(record: CheckpointRecord): UpcastResult {
    return {
      action: "fresh_retry",
      preserveIntegration: true,
      reason: "irreversibly_obsolete_checkpoint",
      record: {
        id: record.id,
        kind: record.kind,
        schemaVersion: record.schemaVersion,
        taskId: record.taskId,
        payload: stripIntegrationOverride(clonePayload(record.payload)),
        integrationRef: record.integrationRef,
        resumeDisposition: "fresh_retry",
      },
    };
  }
}
