import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  CRASH_DUMP_MAX_BYTES,
  CRASH_DUMP_MAX_COUNT,
  CrashDumpIndexer,
  DISK_PAUSE_BYTES,
  DISK_STOP_BYTES,
  DISK_WARN_BYTES,
  DiagnosticsSelfCheck,
  LOCAL_CRASH_REPORTER,
  classifyDiskHeadroom,
} from "../../src/diagnostics/index.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "ef-crash-"));
  directories.push(directory);
  return directory;
}

function writeDump(directory: string, name: string, size: number, ageMs: number, sidecar?: Record<string, unknown>): void {
  const fullPath = join(directory, name);
  writeFileSync(fullPath, Buffer.alloc(size, 1));
  const when = new Date(Date.now() - ageMs);
  utimesSync(fullPath, when, when);
  if (sidecar) writeFileSync(`${fullPath}.json`, JSON.stringify(sidecar));
}

describe("diagnostics crash dump indexer", () => {
  it("refuses any crash reporter that would upload", () => {
    expect(LOCAL_CRASH_REPORTER.uploadToServer).toBe(false);
    expect(() =>
      new CrashDumpIndexer({
        electronDumpDir: tempDir(),
        daemonCrashDir: tempDir(),
        uploadToServer: true,
      }),
    ).toThrow(/uploadToServer/);
  });

  it("keeps the 10 newest of 40 dumps and a 15-dump canary set", () => {
    const root = tempDir();
    const electron = join(root, "electron");
    const daemon = join(root, "daemon");
    for (const directory of [electron, daemon]) mkdirSync(directory);
    for (let index = 0; index < 40; index += 1) {
      const processType = (["main", "renderer", "daemon", "converter"] as const)[index % 4] ?? "main";
      writeDump(electron, `${processType}-${index}.dmp`, 128, index * 1000, {
        dumpId: `dump-${index}`,
        processType,
        appVersion: "0.0.0",
        signalOrExitCode: "11",
        summaryStack: `stack ${index}`,
      });
    }
    const kept = new CrashDumpIndexer({
      electronDumpDir: electron,
      daemonCrashDir: daemon,
      uploadToServer: false,
    }).index();
    expect(kept).toHaveLength(CRASH_DUMP_MAX_COUNT);
    expect(kept.reduce((sum, dump) => sum + dump.fileSizeBytes, 0)).toBeLessThanOrEqual(CRASH_DUMP_MAX_BYTES);
    expect(kept[0]?.dumpId).toBe("dump-0");
    expect(new Set(kept.map((dump) => dump.processType))).toEqual(new Set(["main", "renderer", "daemon", "converter"]));
    expect(readdirSync(electron).filter((name) => name.endsWith(".dmp"))).toHaveLength(10);
  });

  it("drops dumps once the 50 MB cap is reached", () => {
    const root = tempDir();
    const electron = join(root, "electron");
    const daemon = join(root, "daemon");
    mkdirSync(electron);
    mkdirSync(daemon);
    const nineMb = 9 * 1024 * 1024;
    for (let index = 0; index < 6; index += 1) {
      writeDump(electron, `renderer-${index}.dmp`, nineMb, index * 1000);
    }
    const kept = new CrashDumpIndexer({
      electronDumpDir: electron,
      daemonCrashDir: daemon,
      uploadToServer: false,
    }).index();
    const total = kept.reduce((sum, dump) => sum + dump.fileSizeBytes, 0);
    expect(kept.length).toBeLessThanOrEqual(CRASH_DUMP_MAX_COUNT);
    expect(total).toBeLessThanOrEqual(CRASH_DUMP_MAX_BYTES);
    expect(kept.length).toBe(5);
    expect(total).toBe(5 * nineMb);
  });

  it("indexes a daemon crash log header", () => {
    const root = tempDir();
    const electron = join(root, "electron");
    const daemon = join(root, "daemon");
    mkdirSync(electron);
    mkdirSync(daemon);
    const fullPath = join(daemon, "harnessd.log");
    writeFileSync(fullPath, "EF-CRASH processType=daemon appVersion=1.2.3 signal=1\nError: boom\n");
    const kept = new CrashDumpIndexer({
      electronDumpDir: electron,
      daemonCrashDir: daemon,
      uploadToServer: false,
    }).index();
    expect(kept[0]).toMatchObject({
      processType: "daemon",
      appVersion: "1.2.3",
      signalOrExitCode: "1",
      summaryStack: "Error: boom",
    });
    expect(statSync(fullPath).isFile()).toBe(true);
  });
});

describe("diagnostics self-check", () => {
  it("finishes in under 2 seconds and flags MinGit and DPAPI faults", async () => {
    const root = tempDir();
    const state = join(root, "state.db");
    const global = join(root, "global.db");
    const telemetry = join(root, "telemetry.db");
    for (const path of [state, global, telemetry]) {
      const database = new DatabaseSync(path);
      database.exec("CREATE TABLE ok (id INTEGER PRIMARY KEY)");
      database.close();
    }
    const report = await new DiagnosticsSelfCheck({
      stateDbPath: state,
      globalDbPath: global,
      telemetryPath: telemetry,
      namedPipe: { roundTripMs: () => 4 },
      minGit: { version: () => null },
      dpapi: { unlock: () => ({ ok: false, detail: "vault locked" }) },
      disk: { freeBytes: () => ({ drive: "C:", freeBytes: DISK_WARN_BYTES }) },
      leases: { leases: () => [] },
    }).run();
    expect(report.withinBudget).toBe(true);
    expect(report.durationMs).toBeLessThan(2_000);
    const mingit = report.items.find((item) => item.id === "mingit-version");
    const dpapi = report.items.find((item) => item.id === "dpapi-vault-unlock");
    const sqlite = report.items.find((item) => item.id === "sqlite-quick-check");
    expect(mingit?.status).toBe("red");
    expect(mingit?.fixSteps.join(" ")).toMatch(/MinGit/);
    expect(dpapi?.status).toBe("red");
    expect(dpapi?.detail).toContain("vault locked");
    expect(dpapi?.fixSteps.join(" ")).toMatch(/DPAPI/);
    expect(sqlite?.status).toBe("green");
    expect(report.items).toHaveLength(6);
  });

  it("times out a hung probe inside the 2 second budget", async () => {
    const root = tempDir();
    const report = await new DiagnosticsSelfCheck(
      {
        stateDbPath: join(root, "missing-state.db"),
        globalDbPath: join(root, "missing-global.db"),
        telemetryPath: join(root, "missing-telemetry.db"),
        namedPipe: { roundTripMs: () => new Promise(() => undefined) },
        minGit: { version: () => "2.47.0" },
        dpapi: { unlock: () => ({ ok: true, detail: "unlocked" }) },
        disk: { freeBytes: () => ({ drive: "D:", freeBytes: DISK_WARN_BYTES + 1 }) },
        leases: { leases: () => [{ port: 3000, owner: "preview", stuck: true }] },
      },
      { probeTimeoutMs: 50 },
    ).run();
    expect(report.durationMs).toBeLessThan(2_000);
    expect(report.items.find((item) => item.id === "named-pipe-rtt")?.status).toBe("red");
    expect(report.items.find((item) => item.id === "active-port-leases")?.detail).toContain("3000");
    expect(report.items.find((item) => item.id === "sqlite-quick-check")?.status).toBe("red");
  });

  it("classifies disk headroom at 15 GB, 5 GB, and 2 GB", () => {
    expect(classifyDiskHeadroom("C:", DISK_WARN_BYTES).status).toBe("green");
    expect(classifyDiskHeadroom("C:", DISK_WARN_BYTES - 1).status).toBe("amber");
    expect(classifyDiskHeadroom("C:", DISK_PAUSE_BYTES - 1).status).toBe("red");
    expect(classifyDiskHeadroom("C:", DISK_STOP_BYTES - 1).detail).toContain("2 GB");
  });
});
