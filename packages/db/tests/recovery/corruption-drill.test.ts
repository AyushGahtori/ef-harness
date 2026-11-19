import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BackupScheduler,
  CorruptionRecoveryEngine,
  HOUR_MS,
  ManualClock,
  immediateSleeper,
  type ReplaySourceAdapter,
} from "../../src/recovery/index.js";
import { openDatabase, runPragmaCheck } from "../../src/recovery/sqlite-io.js";
import {
  corruptBTreePages,
  makeProject,
  makeTempRoot,
  projectFiles,
  readMetaValue,
  removeTempRoot,
  setMeta,
  writeCorruptWal,
  type ProjectFixture,
} from "./fixture.js";

const roots: string[] = [];

function setup(): { fixture: ProjectFixture; clock: ManualClock } {
  const root = makeTempRoot();
  roots.push(root);
  const fixture = makeProject(root);
  return { fixture, clock: new ManualClock(1_700_000_000_000) };
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) removeTempRoot(root);
  }
});

function mockReplay(): ReplaySourceAdapter {
  return {
    loadKnowledgeChangeSets: () => [
      {
        id: "cs-replay",
        rev: 9,
        origin: "import",
        originRef: null,
        author: "replay",
        createdAt: 90,
        summary: "post-backup knowledge",
        nodes: [],
        edges: [],
        source: "mock",
      },
    ],
    findAcceptedCommitsSince: () => [
      {
        taskId: "T07",
        checks: ["AC-31"],
        commitSha: "abc123",
        attemptId: "A0014",
        feature: "F12",
      },
    ],
    parkInFlightAtCheckpoints: () => [
      {
        taskId: "T07",
        attemptId: "A0014",
        checkpointRef: "refs/harness/checkpoints/T07/A0014",
        sha: "def456",
      },
    ],
  };
}

describe("corruption recovery drill", { timeout: 180_000 }, () => {
  it("quarantines a corrupt database and wal, restores the newest healthy backup, and reports the gap", async () => {
    const { fixture, clock } = setup();
    setMeta(fixture.stateDbPath, "stream_epoch", "3");
    setMeta(fixture.stateDbPath, "last_rev", "2");
    setMeta(fixture.stateDbPath, "marker", "older-backup");
    const scheduler = new BackupScheduler({
      ...projectFiles(fixture),
      backupsDir: fixture.backupsDir,
      clock,
      sleeper: immediateSleeper,
    });
    const older = await scheduler.backupHourly();
    expect(older.status).toBe("written");

    clock.advance(HOUR_MS);
    setMeta(fixture.stateDbPath, "last_rev", "4");
    setMeta(fixture.stateDbPath, "marker", "newer-backup");
    const newer = await scheduler.backupHourly();
    expect(newer.status).toBe("written");
    if (newer.status !== "written") return;

    clock.advance(HOUR_MS);
    setMeta(fixture.stateDbPath, "last_rev", "8");
    setMeta(fixture.stateDbPath, "marker", "live-unbacked");
    writeCorruptWal(fixture.stateDbPath);
    corruptBTreePages(fixture.stateDbPath, 16);
    corruptBTreePages(newer.path, 32);
    fs.writeFileSync(fixture.telemetryDbPath, Buffer.from("not a database"));
    fs.writeFileSync(fixture.codeIndexDbPath, Buffer.from("not a database"));

    const crashAt = clock.now();
    const engine = new CorruptionRecoveryEngine({
      ...projectFiles(fixture),
      backupsDir: fixture.backupsDir,
      historyDir: fixture.historyDir,
      telemetryDbPath: fixture.telemetryDbPath,
      codeIndexDbPath: fixture.codeIndexDbPath,
      clock,
      sleeper: immediateSleeper,
      replay: mockReplay(),
    });
    const report = await engine.onProjectOpen();
    expect(report).not.toBeNull();
    if (!report) return;

    expect(report.outcome).toBe("restored");
    expect(report.safeMode).toBe(true);
    expect(report.schedule).toBe("project_open");
    expect(report.detectedBy).toBe("quick_check");
    expect(report.salvageAccepted).toBe(false);
    expect(report.skippedCorruptBackups).toContain(path.basename(newer.path));
    expect(report.backupAt).toBe(older.status === "written" ? older.createdAt : report.backupAt);
    expect(report.crashDetectedAt).toBe(crashAt);
    expect(report.spendGapEstimated).toBe(true);
    expect(report.spendGapWindow).toEqual({
      backupAt: report.backupAt,
      crashDetectedAt: crashAt,
    });
    expect(JSON.stringify(report)).not.toMatch(/spentUnits|micro-USD|\$\d/);
    expect(report.streamEpoch).toBe(4);
    expect(report.recoveredRevision).toBe(9);
    expect(report.replayedChangeSets.map((change) => change.changeSetId)).toEqual(["cs-replay"]);
    expect(report.tasksQueuedForReverification.map((task) => task.taskId)).toEqual(["T07"]);
    expect(report.parkedAttempts.map((attempt) => attempt.checkpointRef)).toEqual([
      "refs/harness/checkpoints/T07/A0014",
    ]);
    expect(report.telemetryRebuilt).toBe(true);
    expect(report.codeIndexRebuilt).toBe(true);
    expect(report.quarantinedPath).toBeTruthy();
    if (!report.quarantinedPath) return;
    expect(fs.existsSync(path.join(report.quarantinedPath, "state.db"))).toBe(true);
    expect(fs.existsSync(path.join(report.quarantinedPath, "state.db-wal"))).toBe(true);
    expect(fs.existsSync(`${fixture.stateDbPath}-wal`)).toBe(false);
    expect(readMetaValue(fixture.stateDbPath, "marker")).toBe("older-backup");
    expect(readMetaValue(fixture.stateDbPath, "stream_epoch")).toBe("4");

    const telemetry = openDatabase(fixture.telemetryDbPath, true);
    const codeIndex = openDatabase(fixture.codeIndexDbPath, true);
    try {
      expect(runPragmaCheck(telemetry, "quick_check").ok).toBe(true);
      expect(telemetry.prepare("SELECT count(*) AS n FROM telemetry").get()).toEqual({ n: 0 });
      expect(runPragmaCheck(codeIndex, "quick_check").ok).toBe(true);
      expect(codeIndex.prepare("SELECT count(*) AS n FROM symbols").get()).toEqual({ n: 0 });
    } finally {
      telemetry.close();
      codeIndex.close();
    }

    const global = openDatabase(fixture.globalDbPath, true);
    try {
      expect(global.prepare("SELECT status FROM projects WHERE id = ?").get(fixture.projectId)).toEqual({
        status: "needs_repair",
      });
    } finally {
      global.close();
    }
    expect(fs.existsSync(path.join(fixture.projectDir, "safe-mode.json"))).toBe(true);
    const backups = fs.readdirSync(fixture.backupsDir);
    expect(backups.some((name) => name === "telemetry.db" || name === "code-index.db")).toBe(false);
  });

  it("does not invent a fresh recovery when the project is healthy", async () => {
    const { fixture, clock } = setup();
    const engine = new CorruptionRecoveryEngine({
      ...projectFiles(fixture),
      backupsDir: fixture.backupsDir,
      clock,
      sleeper: immediateSleeper,
    });
    expect(await engine.onProjectOpen()).toBeNull();
    expect(await engine.onDailyIdle()).toBeNull();
    expect(await engine.onWeekly()).toBeNull();
    expect(await engine.onRuntimeError(new Error("disk full"))).toBeNull();
    expect(fs.existsSync(path.join(fixture.projectDir, "safe-mode.json"))).toBe(false);
  });

  it("rehydrates from history when no backup exists and otherwise asks for manual re-init", async () => {
    const manual = setup();
    corruptBTreePages(manual.fixture.stateDbPath, 7);
    writeCorruptWal(manual.fixture.stateDbPath);
    const manualEngine = new CorruptionRecoveryEngine({
      ...projectFiles(manual.fixture),
      backupsDir: manual.fixture.backupsDir,
      historyDir: manual.fixture.historyDir,
      clock: manual.clock,
      sleeper: immediateSleeper,
    });
    const manualReport = await manualEngine.recover("manual", "SQLITE_CORRUPT");
    expect(manualReport.outcome).toBe("manual_salvage");
    expect(manualReport.summary).toBe("Manual salvage / fresh re-init");
    expect(manualReport.spendGapEstimated).toBe(true);
    expect(manualReport.spendGapWindow?.backupAt).toBeNull();
    expect(readMetaValue(manual.fixture.stateDbPath, "project_id")).toBe(manual.fixture.projectId);
    const fresh = openDatabase(manual.fixture.stateDbPath, true);
    try {
      expect(runPragmaCheck(fresh, "quick_check").ok).toBe(true);
    } finally {
      fresh.close();
    }

    const hydrated = setup();
    fs.writeFileSync(
      path.join(hydrated.fixture.historyDir, "000010-000010.jsonl"),
      `${JSON.stringify({
        rev: 10,
        changeSetId: "cs-10",
        origin: "import",
        author: "history",
        createdAt: 10,
        summary: "full rehydrate",
        nodes: [
          {
            id: "R10",
            kind: "rule",
            version: 1,
            contentHash: "hash-r10",
            title: "Rehydrated",
            text: "",
            fields: {},
            createdRev: 10,
            updatedRev: 10,
          },
        ],
      })}\n`,
    );
    corruptBTreePages(hydrated.fixture.stateDbPath, 9);
    const hydratedEngine = new CorruptionRecoveryEngine({
      ...projectFiles(hydrated.fixture),
      backupsDir: hydrated.fixture.backupsDir,
      historyDir: hydrated.fixture.historyDir,
      clock: hydrated.clock,
      sleeper: immediateSleeper,
    });
    const hydratedReport = await hydratedEngine.onRuntimeError({
      errcode: 11,
      message: "database disk image is malformed",
    });
    expect(hydratedReport?.outcome).toBe("rehydrated");
    expect(hydratedReport?.spendGapEstimated).toBe(true);
    expect(hydratedReport?.replayedChangeSets.map((change) => [change.changeSetId, change.applied])).toEqual([
      ["cs-10", true],
    ]);
    expect(readMetaValue(hydrated.fixture.stateDbPath, "last_rev")).toBe("10");
    expect(readMetaValue(hydrated.fixture.stateDbPath, "marker")).toBeNull();
  });

  it("bumps stream_epoch when salvage itself is accepted", async () => {
    const { fixture, clock } = setup();
    setMeta(fixture.stateDbPath, "stream_epoch", "2");
    setMeta(fixture.stateDbPath, "last_rev", "1");
    const engine = new CorruptionRecoveryEngine({
      ...projectFiles(fixture),
      backupsDir: fixture.backupsDir,
      clock,
      sleeper: immediateSleeper,
      replay: {
        loadKnowledgeChangeSets: () => [],
        findAcceptedCommitsSince: () => [],
        parkInFlightAtCheckpoints: () => [],
      },
    });
    const report = await engine.onRuntimeError({
      errcode: 11,
      message: "SQLITE_CORRUPT",
    });
    expect(report?.outcome).toBe("salvaged");
    expect(report?.spendGapEstimated).toBe(false);
    expect(report?.spendGapWindow).toBeNull();
    expect(report?.streamEpoch).toBe(3);
    expect(readMetaValue(fixture.stateDbPath, "last_rev")).toBe("1");
  });
});
