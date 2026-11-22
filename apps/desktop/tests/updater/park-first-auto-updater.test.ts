import { describe, expect, it } from "vitest";
import {
  BackupNotVerifiedError,
  ParkFirstAutoUpdater,
  UPDATE_AND_RESTART_LABEL,
  UncheckpointedWorkError,
  UpdateNotReadyError,
  updateReadyPillText,
  type HeadroomLevel,
} from "../../src/updater/index.js";

interface HarnessOptions {
  active?: number;
  checkpoints?: number;
  verified?: boolean;
  manual?: boolean;
  network?: HeadroomLevel;
  disk?: HeadroomLevel;
  version?: string;
  parkError?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const log: string[] = [];
  const updater = {
    downloads: 0,
    quits: 0,
    async downloadUpdate() {
      this.downloads += 1;
      log.push("download");
      return { version: options.version ?? "1.4.0" };
    },
    quitAndInstall() {
      this.quits += 1;
      log.push("quit");
    },
  };
  let active = options.active ?? 0;
  const checkpointCount = options.checkpoints ?? active;
  const work = {
    activeBuildVerificationOrMergeCount: () => active,
    async pauseAndCheckpointAllWorkers() {
      log.push("park");
      if (options.parkError) throw new Error("park failed");
      active = 0;
      return Array.from({ length: checkpointCount }, (_unused, index) => `cp-${String(index)}`);
    },
  };
  const shutdown = {
    async flushSqliteWal() {
      log.push("wal");
    },
    async teardownJobObjects() {
      log.push("teardown");
    },
  };
  const backup = {
    async createVerifiedStateDbSnapshot() {
      log.push("backup");
      return {
        verified: options.verified ?? true,
        snapshotPath: "backups/state-pre-update.db",
      };
    },
  };
  const settings = { manualUpdatesOnly: options.manual ?? false };
  const levels = {
    network: options.network ?? "GREEN",
    disk: options.disk ?? "GREEN",
  };
  const app = new ParkFirstAutoUpdater({
    updater,
    work,
    shutdown,
    backup,
    settings,
    headroom: {
      networkLevel: () => levels.network,
      diskLevel: () => levels.disk,
    },
  });
  return { app, updater, log, settings, levels };
}

describe("park-first auto updater", () => {
  it("downloads quietly while four workers run and never auto-restarts", async () => {
    const { app, updater } = harness({ active: 4 });
    const pill = await app.downloadQuietly();
    expect(updater.downloads).toBe(1);
    expect(updater.quits).toBe(0);
    expect(pill).toEqual({
      visible: true,
      text: "Update v1.4.0 ready — Restart when convenient",
    });
    expect(UPDATE_AND_RESTART_LABEL).toBe("Update & Restart");
    expect(updateReadyPillText("v1.4.0")).toBe("Update v1.4.0 ready — Restart when convenient");
  });

  it("parks, flushes the WAL, tears down job objects, and backs up before quitAndInstall", async () => {
    const { app, updater, log } = harness({ active: 4 });
    await app.downloadQuietly();
    await app.requestUpdateAndRestart();
    expect(log).toEqual(["download", "park", "wal", "teardown", "backup", "quit"]);
    expect(updater.quits).toBe(1);
  });

  it("still snapshots state.db when no build is active", async () => {
    const { app, log } = harness({ active: 0 });
    await app.downloadQuietly();
    await app.requestUpdateAndRestart();
    expect(log).toEqual(["download", "wal", "teardown", "backup", "quit"]);
  });

  it("refuses quitAndInstall when workers stay uncheckpointed or the backup is unverified", async () => {
    const partial = harness({ active: 4, checkpoints: 3 });
    await partial.app.downloadQuietly();
    await expect(partial.app.requestUpdateAndRestart()).rejects.toBeInstanceOf(UncheckpointedWorkError);
    expect(partial.updater.quits).toBe(0);
    expect(partial.log).toEqual(["download", "park"]);

    const unverified = harness({ active: 0, verified: false });
    await unverified.app.downloadQuietly();
    await expect(unverified.app.requestUpdateAndRestart()).rejects.toBeInstanceOf(BackupNotVerifiedError);
    expect(unverified.updater.quits).toBe(0);
    expect(unverified.log).toEqual(["download", "wal", "teardown", "backup"]);

    const failedPark = harness({ active: 4, parkError: true });
    await failedPark.app.downloadQuietly();
    await expect(failedPark.app.requestUpdateAndRestart()).rejects.toThrow("park failed");
    expect(failedPark.updater.quits).toBe(0);
    expect(failedPark.log).toEqual(["download", "park"]);
  });

  it("respects manual updates and non-green headroom", async () => {
    const manual = harness({ manual: true });
    await manual.app.downloadQuietly();
    expect(manual.updater.downloads).toBe(0);
    expect(manual.updater.quits).toBe(0);

    const disk = harness({ disk: "RED" });
    await disk.app.downloadQuietly();
    expect(disk.updater.downloads).toBe(0);

    const network = harness({ network: "YELLOW" });
    await network.app.downloadQuietly();
    expect(network.updater.downloads).toBe(0);

    const idle = harness();
    await expect(idle.app.requestUpdateAndRestart()).rejects.toBeInstanceOf(UpdateNotReadyError);
    expect(idle.updater.quits).toBe(0);
  });
});
