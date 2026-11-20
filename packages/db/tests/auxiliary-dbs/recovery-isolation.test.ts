import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AttachedDatabaseForbiddenError,
  CodeIndexDb,
  GlobalBrokerDb,
  TelemetryDb,
  assertConnectionIsolated,
  createCollectingLogger,
  openSqliteConnection,
  type AuxiliaryLogEvent,
  type ProcessIdentity,
} from "../../src/auxiliary-dbs/index.js";
import { useTempDirs } from "./lifecycle.js";
import { corruptHeader, projectPath } from "./temp-root.js";

const identity: ProcessIdentity = {
  pid: 7,
  processStartTime: 11,
  hostname: "isolation-host",
};

describe("auxiliary database recovery and isolation", () => {
  const dirs = useTempDirs();

  it("quarantines corrupt telemetry.db and code-index.db and leaves state.db untouched", () => {
    const root = dirs.root("recovery");
    const events: AuxiliaryLogEvent[] = [];
    const logger = createCollectingLogger(events);
    const global = GlobalBrokerDb.open({ root, identity, logger });
    dirs.close(() => global.close());
    global.registerProject({
      id: "alpha",
      path: projectPath("Alpha"),
      displayName: "Alpha",
      schemaVersion: 1,
    });
    const now = 1_700_000_000_000;
    const telemetry = TelemetryDb.open({
      filePath: global.layout.projectTelemetryPath("alpha"),
      logger,
      now: () => now,
      flushIntervalMs: 60_000,
    });
    dirs.close(() => telemetry.close());
    telemetry.enqueue({ ts: now, kind: "metric", data: { before: true } });
    telemetry.flush();
    expect(telemetry.count()).toBe(1);

    const codeIndex = CodeIndexDb.open({
      filePath: global.layout.projectCodeIndexPath("alpha"),
      logger,
    });
    dirs.close(() => codeIndex.close());
    codeIndex.upsertCommit({ commitSha: "c".repeat(40), builtAt: 1, files: 0 });
    expect(codeIndex.schemaTables()).toContain("indexed_commits");

    const state = openSqliteConnection(global.layout.projectStatePath("alpha"), "state");
    dirs.close(() => state.close());
    state.exec("CREATE TABLE marker (note TEXT NOT NULL) STRICT");
    state.run("INSERT INTO marker(note) VALUES (?)", "untouched");

    expect(new Set([
      global.filePath,
      state.filePath,
      telemetry.filePath,
      codeIndex.filePath,
    ]).size).toBe(4);
    expect(global.attachedDatabaseNames()).toEqual(["main"]);
    expect(telemetry.attachedDatabaseNames()).toEqual(["main"]);
    expect(codeIndex.attachedDatabaseNames()).toEqual(["main"]);
    expect(state.databaseNames().filter((name) => name !== "temp")).toEqual(["main"]);
    global.verifyIsolatedConnection();
    telemetry.verifyIsolatedConnection();
    codeIndex.verifyIsolatedConnection();
    assertConnectionIsolated(state);
    expect(() => state.exec("ATTACH DATABASE ':memory:' AS shared_tx")).toThrow(AttachedDatabaseForbiddenError);

    const telemetryPath = telemetry.filePath;
    const codeIndexPath = codeIndex.filePath;
    const codeIndexTables = codeIndex.schemaTables();
    telemetry.close();
    codeIndex.close();
    corruptHeader(telemetryPath);
    corruptHeader(codeIndexPath);

    const rebuiltTelemetry = TelemetryDb.open({
      filePath: telemetryPath,
      logger,
      now: () => now,
      flushIntervalMs: 60_000,
    });
    dirs.close(() => rebuiltTelemetry.close());
    const rebuiltIndex = CodeIndexDb.open({ filePath: codeIndexPath, logger });
    dirs.close(() => rebuiltIndex.close());

    expect(rebuiltTelemetry.count()).toBe(0);
    rebuiltTelemetry.enqueue({ ts: now, kind: "heartbeat", data: { after: true } });
    rebuiltTelemetry.flush();
    expect(rebuiltTelemetry.count()).toBe(1);
    expect(rebuiltIndex.symbolCount()).toBe(0);
    rebuiltIndex.upsertCommit({ commitSha: "d".repeat(40), builtAt: 2, files: 0 });
    expect(rebuiltIndex.schemaTables()).toEqual(codeIndexTables);

    const quarantineDir = path.join(global.layout.projectDir("alpha"), "quarantine");
    const quarantined = fs.readdirSync(quarantineDir).filter((name) => !/-(?:wal|shm|journal)$/u.test(name));
    expect(quarantined.some((name) => name.startsWith("telemetry.db."))).toBe(true);
    expect(quarantined.some((name) => name.startsWith("code-index.db."))).toBe(true);
    for (const name of quarantined) {
      expect(fs.readFileSync(path.join(quarantineDir, name)).subarray(0, 16).equals(Buffer.alloc(16, 0))).toBe(true);
    }
    expect(events.filter((event) => event.code === "telemetry_db_rebuilt")).toHaveLength(1);
    expect(events.filter((event) => event.code === "code_index_db_rebuilt")).toHaveLength(1);
    expect(state.get("SELECT note FROM marker")?.note).toBe("untouched");
    expect(global.getProject("alpha")?.status).toBe("ok");
    expect(global.quickCheck()).toBe("ok");
  });
});
