import { describe, expect, it } from "vitest";
import {
  BackupNotVerifiedError,
  CURRENT_SUPPORTED_SCHEMA_VERSION,
  CheckpointSchemaUpcasterRegistry,
  DowngradeProtectionGuard,
  ForwardOnlyCheckpointError,
  HARNESS_INTEGRATION_REF,
  NewerSchemaVersionError,
  type CheckpointRecord,
  type CheckpointStorePort,
  type MigrationAndRebuildEnginePort,
} from "../../src/updater/index.js";

function parkedAttempt(): CheckpointRecord {
  return {
    id: "cp-T-5",
    kind: "attempt_checkpoint",
    schemaVersion: 1,
    taskId: "T-5",
    integrationRef: HARNESS_INTEGRATION_REF,
    resumeDisposition: "resume",
    payload: {
      taskId: "T-5",
      wipRef: "refs/wip/T-5",
      sessionRef: "sess-5",
      handoffNote: "parked mid-wave",
      integrationRef: "refs/heads/feature/oops",
    },
  };
}

function registry(log: string[], verified = true): {
  registry: CheckpointSchemaUpcasterRegistry;
  written: CheckpointRecord[];
} {
  const written: CheckpointRecord[] = [];
  const migrations: MigrationAndRebuildEnginePort = {
    async createVerifiedBackup() {
      log.push("backup");
      return { verified, snapshotPath: "backups/state-pre-update.db" };
    },
    async runBackupProtectedTransaction<T>(work: () => Promise<T> | T): Promise<T> {
      log.push("tx");
      return work();
    },
  };
  const store: CheckpointStorePort = {
    write(record) {
      log.push("write");
      written.push(record);
    },
  };
  return { registry: new CheckpointSchemaUpcasterRegistry(migrations, store), written };
}

describe("checkpoint schema upcasters and downgrade protection", () => {
  it("upgrades a parked v1 attempt to v2 inside a backup-protected transaction", async () => {
    const log: string[] = [];
    const { registry: upcasters, written } = registry(log);
    const record = parkedAttempt();
    const before = JSON.stringify(record.payload);
    const result = await upcasters.upcastStored(record, "v1.0", 2);
    expect(JSON.stringify(record.payload)).toBe(before);
    expect(log).toEqual(["backup", "tx", "write"]);
    expect(result.action).toBe("resume");
    expect(result.record.schemaVersion).toBe(2);
    expect(result.record.taskId).toBe("T-5");
    expect(result.record.payload.taskId).toBe("T-5");
    expect(result.record.payload.wipRef).toBe("refs/wip/T-5");
    expect(result.record.payload.sessionRef).toBe("sess-5");
    expect(result.record.payload.handoffNote).toBe("parked mid-wave");
    expect(result.record.integrationRef).toBe(HARNESS_INTEGRATION_REF);
    expect(result.record.payload.integrationRef).toBeUndefined();
    expect(result.record.payload.resumeToken).toMatch(/^[0-9a-f]{64}$/);
    expect(written[0]?.integrationRef).toBe(HARNESS_INTEGRATION_REF);
    const again = upcasters.upcast(record, 2);
    expect(again.record.payload.resumeToken).toBe(result.record.payload.resumeToken);
  });

  it("continues v1 through v3 without dropping the v2 resume token", () => {
    const { registry: upcasters } = registry([]);
    const record = parkedAttempt();
    const v2 = upcasters.upcast(record, 2);
    const v3 = upcasters.upcast(record, 3);
    expect(CURRENT_SUPPORTED_SCHEMA_VERSION).toBe(3);
    expect(v3.record.schemaVersion).toBe(3);
    expect(v3.record.payload.resumeToken).toBe(v2.record.payload.resumeToken);
    expect(v3.record.payload.parkedAtEpochMs).toBe(0);
    expect(v3.record.payload.taskId).toBe("T-5");
    expect(v3.record.integrationRef).toBe(HARNESS_INTEGRATION_REF);
    expect(v3.action).toBe("resume");
  });

  it("upcasts ship runs and verification state", () => {
    const { registry: upcasters } = registry([]);
    const ship = upcasters.upcast({
      id: "ship-1",
      kind: "ship_run",
      schemaVersion: 1,
      taskId: "T-5",
      integrationRef: HARNESS_INTEGRATION_REF,
      resumeDisposition: "resume",
      payload: { runId: "run-1", taskId: "T-5", status: "parked" },
    });
    expect(ship.action).toBe("resume");
    expect(ship.record.schemaVersion).toBe(3);
    expect(ship.record.payload.resumable).toBe(true);
    expect(ship.record.integrationRef).toBe(HARNESS_INTEGRATION_REF);

    const verification = upcasters.upcast({
      id: "verify-1",
      kind: "verification_state",
      schemaVersion: 1,
      taskId: "T-5",
      integrationRef: HARNESS_INTEGRATION_REF,
      resumeDisposition: "resume",
      payload: { taskId: "T-5", passed: true },
    });
    expect(verification.record.schemaVersion).toBe(3);
    expect(verification.record.payload.integrationIntact).toBe(true);
    expect(verification.record.payload.passed).toBe(true);
  });

  it("falls back to a fresh retry for an obsolete checkpoint and preserves integration", async () => {
    const log: string[] = [];
    const { registry: upcasters, written } = registry(log);
    const result = await upcasters.upcastStored(
      {
        id: "cp-old",
        kind: "attempt_checkpoint",
        schemaVersion: 0,
        taskId: "T-9",
        integrationRef: HARNESS_INTEGRATION_REF,
        resumeDisposition: "resume",
        payload: { format: "legacy-binary", integrationRef: "refs/heads/feature/oops" },
      },
      "v1.0",
    );
    expect(result.action).toBe("fresh_retry");
    if (result.action !== "fresh_retry") throw new Error("expected fresh retry");
    expect(result.preserveIntegration).toBe(true);
    expect(result.reason).toBe("irreversibly_obsolete_checkpoint");
    expect(result.record.integrationRef).toBe(HARNESS_INTEGRATION_REF);
    expect(result.record.resumeDisposition).toBe("fresh_retry");
    expect(result.record.payload.integrationRef).toBeUndefined();
    expect(written[0]?.integrationRef).toBe(HARNESS_INTEGRATION_REF);
    expect(log[0]).toBe("backup");
  });

  it("refuses a newer schema before backup or any write", async () => {
    let backups = 0;
    let writes = 0;
    const migrations: MigrationAndRebuildEnginePort = {
      async createVerifiedBackup() {
        backups += 1;
        return { verified: true, snapshotPath: "unused" };
      },
      async runBackupProtectedTransaction<T>(work: () => T): Promise<T> {
        return work();
      },
    };
    const store: CheckpointStorePort = {
      write() {
        writes += 1;
      },
    };
    const upcasters = new CheckpointSchemaUpcasterRegistry(migrations, store);
    const database = { schemaVersion: 4, bytes: "untouched" };
    await expect(
      upcasters.upcastStored(
        {
          ...parkedAttempt(),
          schemaVersion: 4,
        },
        "v2.0",
      ),
    ).rejects.toThrow("This project was opened by EF Harness v2.0 — please update this machine");
    expect(backups).toBe(0);
    expect(writes).toBe(0);
    expect(database).toEqual({ schemaVersion: 4, bytes: "untouched" });

    const guard = new DowngradeProtectionGuard();
    expect(() =>
      guard.assertCanOpen({ databaseName: "global.db", schemaVersion: 4, openedByAppVersion: "v2.0" }),
    ).toThrow(NewerSchemaVersionError);
    expect(() =>
      guard.assertCanOpen({ databaseName: "state.db", schemaVersion: 3, openedByAppVersion: "v1.1" }),
    ).not.toThrow();
    expect(() =>
      guard.assertCanOpen({ databaseName: "state.db", schemaVersion: 2, openedByAppVersion: "v1.0" }),
    ).not.toThrow();
    try {
      guard.assertCanOpen({ databaseName: "global.db", schemaVersion: 9, openedByAppVersion: "v3.1" });
    } catch (error) {
      expect(error).toBeInstanceOf(NewerSchemaVersionError);
      if (error instanceof NewerSchemaVersionError) {
        expect(error.databaseName).toBe("global.db");
        expect(error.message).toBe("This project was opened by EF Harness v3.1 — please update this machine");
      }
    }
  });

  it("does not move a checkpoint backward and does not write when backup verification fails", async () => {
    const { registry: upcasters } = registry([]);
    expect(() => upcasters.upcast({ ...parkedAttempt(), schemaVersion: 3 }, 2)).toThrow(ForwardOnlyCheckpointError);
    const log: string[] = [];
    const failed = registry(log, false);
    await expect(failed.registry.upcastStored(parkedAttempt(), "v1.0")).rejects.toBeInstanceOf(BackupNotVerifiedError);
    expect(log).toEqual(["backup"]);
    expect(failed.written).toEqual([]);
  });
});
