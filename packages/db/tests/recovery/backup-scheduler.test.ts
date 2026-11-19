import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BackupScheduler,
  DAY_MS,
  HOUR_MS,
  ManualClock,
  RecoveryError,
  immediateSleeper,
  isRebuildOnlyDatabase,
  listBackupFiles,
  listBackupPins,
} from "../../src/recovery/index.js";
import { withRotationLock } from "../../src/recovery/lock.js";
import { renameWithRetry } from "../../src/recovery/rename.js";
import {
  artifactHash,
  makeProject,
  makeTempRoot,
  projectFiles,
  readMetaValue,
  removeTempRoot,
  replaceArtifacts,
  setMeta,
  type ProjectFixture,
} from "./fixture.js";

const roots: string[] = [];

function project(): { fixture: ProjectFixture; clock: ManualClock; scheduler: BackupScheduler } {
  const root = makeTempRoot();
  roots.push(root);
  const fixture = makeProject(root);
  const clock = new ManualClock(1_700_000_000_000);
  const scheduler = new BackupScheduler({
    ...projectFiles(fixture),
    backupsDir: fixture.backupsDir,
    clock,
    sleeper: immediateSleeper,
  });
  return { fixture, clock, scheduler };
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) removeTempRoot(root);
  }
});

describe("backup rotation, CAS pins, and idle hourly writes", { timeout: 180_000 }, () => {
  it("rotates hourly backups to 24 and daily backups to 7, and unpins only the rotated holder", async () => {
    const { fixture, clock, scheduler } = project();
    const shared = artifactHash("shared-blob");
    replaceArtifacts(fixture.stateDbPath, ["shared-blob"], clock.now());
    setMeta(fixture.stateDbPath, "last_rev", "1");
    const first = await scheduler.backupHourly();
    expect(first.status).toBe("written");
    if (first.status !== "written") return;
    expect(first.pinnedHashes).toEqual([shared]);
    expect(listBackupPins(fixture.globalDbPath, first.holderId)).toEqual([shared]);

    const daily = await scheduler.backupDaily();
    expect(daily.status).toBe("written");
    if (daily.status !== "written") return;
    expect(listBackupPins(fixture.globalDbPath, daily.holderId)).toEqual([shared]);

    for (const tag of ["schema-v2", "schema-v3", "pre.4"]) {
      clock.advance(1);
      const tagged = await scheduler.backupPreMigration(tag);
      expect(tagged.path).toContain(`pre-migration-${tag}-`);
    }

    for (let rev = 2; rev <= 25; rev += 1) {
      clock.advance(HOUR_MS);
      replaceArtifacts(fixture.stateDbPath, [`art-${rev}`], clock.now());
      setMeta(fixture.stateDbPath, "last_rev", String(rev));
      const written = await scheduler.backupHourly();
      expect(written.status).toBe("written");
    }

    for (let day = 0; day < 7; day += 1) {
      clock.advance(DAY_MS);
      const written = await scheduler.backupDaily();
      expect(written.status).toBe("written");
    }

    const files = listBackupFiles(fixture.backupsDir);
    const hourly = files.filter((file) => file.cadence === "hourly");
    const dailyFiles = files.filter((file) => file.cadence === "daily");
    const tagged = files.filter((file) => file.cadence === "pre-migration");
    expect(hourly).toHaveLength(24);
    expect(dailyFiles).toHaveLength(7);
    expect(tagged).toHaveLength(3);
    expect(listBackupPins(fixture.globalDbPath, first.holderId)).toEqual([]);
    expect(listBackupPins(fixture.globalDbPath, daily.holderId)).toEqual([]);
    for (const file of tagged) {
      expect(listBackupPins(fixture.globalDbPath, `${fixture.projectId}-backup-${file.id}`)).toEqual([
        shared,
      ]);
    }
    const newestHourly = hourly[0];
    expect(newestHourly).toBeTruthy();
    if (!newestHourly) return;
    expect(
      listBackupPins(fixture.globalDbPath, `${fixture.projectId}-backup-${newestHourly.id}`),
    ).toEqual([artifactHash("art-25")]);
  });

  it("registers CAS pins before the backup file is visible", async () => {
    const { fixture, clock } = project();
    replaceArtifacts(fixture.stateDbPath, ["visible"], clock.now());
    setMeta(fixture.stateDbPath, "last_rev", "4");
    const probed = new BackupScheduler({
      ...projectFiles(fixture),
      backupsDir: fixture.backupsDir,
      clock,
      sleeper: immediateSleeper,
      afterPinsBeforeExpose: (info) => {
        expect(fs.existsSync(info.tempPath)).toBe(true);
        expect(fs.existsSync(info.finalPath)).toBe(false);
        expect(listBackupPins(fixture.globalDbPath, info.holderId)).toEqual(info.hashes);
        expect(info.hashes).toEqual([artifactHash("visible")]);
      },
    });
    const written = await probed.backupHourly();
    expect(written.status).toBe("written");
    if (written.status !== "written") return;
    expect(fs.existsSync(written.path)).toBe(true);
    expect(readMetaValue(written.path, "last_rev")).toBe("4");
  });

  it("skips hourly backups when the project is idle or the hour has not elapsed", async () => {
    const { fixture, clock, scheduler } = project();
    const idle = await scheduler.backupHourly();
    expect(idle).toEqual({ status: "skipped", cadence: "hourly", reason: "idle" });
    expect(listBackupFiles(fixture.backupsDir)).toHaveLength(0);

    setMeta(fixture.stateDbPath, "last_rev", "3");
    const first = await scheduler.backupHourly();
    expect(first.status).toBe("written");
    clock.advance(HOUR_MS / 2);
    setMeta(fixture.stateDbPath, "last_rev", "4");
    const early = await scheduler.backupHourly();
    expect(early).toEqual({ status: "skipped", cadence: "hourly", reason: "not_due" });
    expect(listBackupFiles(fixture.backupsDir)).toHaveLength(1);

    clock.advance(HOUR_MS);
    const afterMutation = await scheduler.backupHourly();
    expect(afterMutation.status).toBe("written");
    expect(listBackupFiles(fixture.backupsDir)).toHaveLength(2);

    clock.advance(HOUR_MS);
    const unchanged = await scheduler.backupHourly();
    expect(unchanged).toEqual({ status: "skipped", cadence: "hourly", reason: "idle" });
    expect(listBackupFiles(fixture.backupsDir)).toHaveLength(2);

    setMeta(fixture.stateDbPath, "last_rev", "5");
    clock.advance(HOUR_MS);
    const next = await scheduler.backupHourly();
    expect(next.status).toBe("written");
    expect(listBackupFiles(fixture.backupsDir)).toHaveLength(3);
  });

  it("refuses to rotate telemetry.db or code-index.db", async () => {
    const { fixture, clock } = project();
    const telemetry = new BackupScheduler({
      project: { projectId: fixture.projectId, filePath: fixture.telemetryDbPath },
      globalDb: { filePath: fixture.globalDbPath },
      backupsDir: fixture.backupsDir,
      clock,
      sleeper: immediateSleeper,
    });
    await expect(telemetry.backupHourly()).rejects.toBeInstanceOf(RecoveryError);
    expect(isRebuildOnlyDatabase(fixture.codeIndexDbPath)).toBe(true);
    expect(listBackupFiles(fixture.backupsDir)).toHaveLength(0);
  });

  it("holds the rotation lock so a second writer waits", async () => {
    const root = makeTempRoot();
    roots.push(root);
    const dir = path.join(root, "backups");
    fs.mkdirSync(dir);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withRotationLock(dir, () => gate);
    let secondStarted = false;
    const second = withRotationLock(dir, () => {
      secondStarted = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(secondStarted).toBe(false);
    release();
    await first;
    await second;
    expect(secondStarted).toBe(true);
  });

  it("retries rename on a sharing violation and stops on other errors", async () => {
    const delays: number[] = [];
    const sleeper = {
      async sleep(ms: number): Promise<void> {
        delays.push(ms);
      },
    };
    let attempts = 0;
    await renameWithRetry(path.join("from"), path.join("to"), sleeper, () => {
      attempts += 1;
      if (attempts < 10) {
        const error = new Error("locked") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
    });
    expect(attempts).toBe(10);
    expect(delays).toEqual([50, 100, 200, 400, 800, 1000, 1000, 1000, 1000]);

    const fatal = new Error("missing") as NodeJS.ErrnoException;
    fatal.code = "ENOENT";
    await expect(
      renameWithRetry("from", "to", sleeper, () => {
        throw fatal;
      }),
    ).rejects.toMatchObject({ code: "rename_failed" });
  });
});
