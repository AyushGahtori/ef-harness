import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  AttachedDatabaseForbiddenError,
  ClosedDatabaseError,
  DatabaseSchemaVersionError,
  DatabaseVersionTooNewError,
  defaultHarnessRoot,
  NestedWriteTransactionError,
  ProjectSafeModeError,
  ProjectStateDb,
  ReadOnlyDatabaseError,
  SafeModeController,
  WorldReadableProjectPathError,
  assertPrivateProjectPath,
  assertSqlHasNoAttach,
  openProjectStateDb,
  renameWithRetry,
  type SafeModeReason,
  type StateDbLogger,
} from "../../src/state-db/index.js";
import { openStateConnection } from "../../src/state-db/sqlite-session.js";

const require = createRequire(import.meta.url);
const opened: ProjectStateDb[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const db of opened) {
    if (!db.isClosed()) db.close();
  }
  opened.length = 0;
  for (const directory of directories) {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  directories.length = 0;
});

describe("state-db bootstrap", () => {
  it("bootstraps state.db from schema/state.sql with meta, project_runtime, and user_version 1", () => {
    const clock = 1_700_000_000_000;
    const db = open({ now: () => clock });
    expect(db.mode).toBe("readwrite");
    expect(db.getUserVersion()).toBe(1);
    expect(db.getLastQuickCheck()).toBe("ok");
    expect(db.isSafeMode()).toBe(false);
    expect(db.getMeta("project_id")).toBe(db.projectId);
    expect(db.getMeta("stream_epoch")).toBe("1");
    expect(db.getMeta("last_rev")).toBe("0");
    expect(db.getMeta("writer_epoch")).toBe("1");
    expect(db.getMeta("created_at")).toBe(String(clock));
    expect(db.getProjectRuntime()).toEqual({
      id: 1,
      state: "DISCOVERY",
      paused: 0,
      updatedRev: 0,
    });
    expect(db.listSchemaMigrations()).toEqual([
      expect.objectContaining({
        version: 1,
        name: "state-schema-v1",
        kind: "additive",
        appVersion: "0.0.0",
      }),
    ]);
    expect(db.evaluateSearchText("camelCase")).toBe("camelCase camel Case");
    const owner = db.getOwner();
    expect(owner?.epoch).toBe(1);
    expect(owner?.pid).toBe(process.pid);
    expect(db.acquireWriterLock().acquired).toBe(true);
    const again = openProjectStateDb({ projectId: db.projectId, rootDir: rootOf(db) });
    expect(again).toBe(db);
  });

  it("discards a partial init file and never publishes it as state.db", () => {
    const root = tempRoot();
    const projectId = "PartialInit";
    const projectDir = path.join(root, "projects", projectId);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "state.db.init.tmp"), "partial");
    const db = open({ projectId, rootDir: root });
    expect(fs.existsSync(path.join(projectDir, "state.db.init.tmp"))).toBe(false);
    expect(fs.existsSync(db.databasePath)).toBe(true);
    expect(db.getUserVersion()).toBe(1);
  });

  it("removes the temp database when publication is interrupted", () => {
    const root = tempRoot();
    const projectId = "InterruptedInit";
    expect(() =>
      open({
        projectId,
        rootDir: root,
        beforePublish() {
          throw new Error("interrupted before rename");
        },
      }),
    ).toThrow(/interrupted before rename/);
    const projectDir = path.join(root, "projects", projectId);
    expect(fs.existsSync(path.join(projectDir, "state.db"))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, "state.db.init.tmp"))).toBe(false);
    const recovered = open({ projectId, rootDir: root });
    expect(recovered.getUserVersion()).toBe(1);
  });

  it("refuses a newer user_version before running a query", () => {
    const root = tempRoot();
    const projectId = "TooNew";
    const projectDir = path.join(root, "projects", projectId);
    fs.mkdirSync(projectDir, { recursive: true });
    const raw = new DatabaseSync(path.join(projectDir, "state.db"));
    raw.exec("PRAGMA user_version = 2");
    raw.close();
    expect(() => open({ projectId, rootDir: root })).toThrow(DatabaseVersionTooNewError);
    try {
      open({ projectId, rootDir: root });
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseVersionTooNewError);
      if (error instanceof DatabaseVersionTooNewError) {
        expect(error.dbVersion).toBe(2);
        expect(error.supportedVersion).toBe(1);
        expect(error.backupDirectory).toBe(path.join(projectDir, "backups"));
      }
    }
  });

  it("rejects an uninitialized database instead of treating version 0 as current", () => {
    const root = tempRoot();
    const projectId = "VersionZero";
    const projectDir = path.join(root, "projects", projectId);
    fs.mkdirSync(projectDir, { recursive: true });
    const raw = new DatabaseSync(path.join(projectDir, "state.db"));
    raw.close();
    expect(() => open({ projectId, rootDir: root })).toThrow(DatabaseSchemaVersionError);
  });

  it("keeps the same epoch when the same process reopens and increments it for a dead or reused owner", () => {
    const root = tempRoot();
    const projectId = "OwnerEpoch";
    const logger = captureLogger();
    const first = open({ projectId, rootDir: root, logger: logger.logger });
    const databasePath = first.databasePath;
    first.close();
    const reopened = open({ projectId, rootDir: root, logger: logger.logger });
    expect(reopened.getOwner()?.epoch).toBe(1);
    expect(reclaimEvents(logger.events)).toHaveLength(0);
    reopened.close();

    tamperOwner(databasePath, (owner) => {
      owner.pid = 2_147_483_646;
    });
    const reclaimed = open({ projectId, rootDir: root, logger: logger.logger });
    expect(reclaimed.getOwner()?.epoch).toBe(2);
    expect(reclaimed.getMeta("writer_epoch")).toBe("2");
    expect(reclaimEvents(logger.events).map((event) => event.reason)).toContain("pid_dead");
    reclaimed.close();

    tamperOwner(databasePath, (owner) => {
      owner.pid = process.pid;
      owner.processStartTime = "reused-start";
      owner.epoch = 2;
    });
    const reused = open({ projectId, rootDir: root, logger: logger.logger });
    expect(reused.getOwner()?.epoch).toBe(3);
    expect(reclaimEvents(logger.events).map((event) => event.reason)).toContain("pid_reused");
  });

  it("does not enter safe mode for a read-only external inspection", () => {
    const db = open();
    const external = new DatabaseSync(db.databasePath, { readOnly: true });
    external.exec("PRAGMA query_only = ON");
    external.prepare("SELECT value FROM meta WHERE key = ?").get("project_id");
    external.close();
    db.setMeta("after_read", "ok");
    expect(db.isSafeMode()).toBe(false);
    expect(db.getMeta("after_read")).toBe("ok");
  });

  it("enters safe mode when another connection commits", () => {
    const seen: string[] = [];
    const db = open({
      onSafeMode(payload) {
        seen.push(payload.priority);
      },
    });
    const projectDir = path.dirname(db.databasePath);
    fs.mkdirSync(path.join(projectDir, "worktrees"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, "checkpoints"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "worktrees", "keep.txt"), "keep");
    fs.writeFileSync(path.join(projectDir, "checkpoints", "keep.txt"), "keep");
    const external = new DatabaseSync(db.databasePath);
    external.prepare("INSERT INTO meta(key, value) VALUES (?, ?)").run("external_probe", "1");
    external.close();
    expect(() => db.setMeta("after_foreign", "x")).toThrow(ProjectSafeModeError);
    expect(db.isSafeMode()).toBe(true);
    expect(db.getMeta("after_foreign")).toBeNull();
    expect(db.getMeta("external_probe")).toBe("1");
    expect(db.getSafeModeStatus()).toMatchObject({
      priority: "high",
      reason: "foreign_write",
      dispatchBlocked: true,
      writesBlocked: true,
      worktreesPreserved: true,
      checkpointsPreserved: true,
      diagnostics: { quickCheck: "ok", worktreesPreserved: true, checkpointsPreserved: true },
    });
    expect(seen).toContain("high");
    expect(() => db.assertCanDispatch()).toThrow(ProjectSafeModeError);
    expect(fs.readFileSync(path.join(projectDir, "worktrees", "keep.txt"), "utf8")).toBe("keep");
    expect(fs.readFileSync(path.join(projectDir, "checkpoints", "keep.txt"), "utf8")).toBe("keep");
    const databasePath = db.databasePath;
    const projectId = db.projectId;
    const rootDir = rootOf(db);
    db.close();
    const restarted = open({ projectId, rootDir });
    expect(restarted.isSafeMode()).toBe(true);
    expect(restarted.getMeta("safe_mode")).toBe("1");
    expect(() => restarted.setMeta("later", "no")).toThrow(ProjectSafeModeError);
    expect(fs.existsSync(databasePath)).toBe(true);
  });

  it("rolls back a disk-full write and enters safe mode without reporting success", () => {
    const db = open();
    const projectDir = path.dirname(db.databasePath);
    fs.mkdirSync(path.join(projectDir, "checkpoints"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "checkpoints", "ref.txt"), "intact");
    db.applyStorageCeiling(db.getPageCount());
    expect(() => db.setMeta("overflow", "x".repeat(4_000_000))).toThrow(ProjectSafeModeError);
    expect(db.isSafeMode()).toBe(true);
    expect(db.getSafeModeStatus()?.reason).toBe("disk_io_error");
    expect(db.getMeta("overflow")).toBeNull();
    expect(db.getProjectRuntime().state).toBe("DISCOVERY");
    expect(fs.readFileSync(path.join(projectDir, "checkpoints", "ref.txt"), "utf8")).toBe("intact");
    expect(() => db.setMeta("after_full", "no")).toThrow(ProjectSafeModeError);
  });

  it("bumps stream_epoch atomically and reports resync_required", () => {
    const events: unknown[] = [];
    const db = open({
      onResyncRequired(payload) {
        events.push(payload);
      },
    });
    expect(db.getStreamEpoch()).toBe(1);
    const restored = db.bumpStreamEpoch("restored");
    expect(restored).toEqual({
      type: "resync_required",
      projectId: db.projectId,
      streamEpoch: 2,
      reason: "restored",
    });
    expect(events).toEqual([restored]);
    expect(db.bumpStreamEpoch("rehydrated").streamEpoch).toBe(3);
    expect(db.getMeta("stream_epoch")).toBe("3");
  });

  it("runs integrity_check when the weekly timestamp is due", () => {
    let now = 1_700_000_000_000;
    const db = open({ now: () => now });
    expect(db.isIntegrityCheckDue()).toBe(true);
    expect(db.runIntegrityCheckIfDue()).toMatchObject({ ran: true, ok: true, report: "ok" });
    expect(db.getMeta("last_integrity_check_at")).toBe(String(now));
    expect(db.isIntegrityCheckDue()).toBe(false);
    expect(db.runIntegrityCheckIfDue()).toMatchObject({ ran: false, ok: true });
    now += 8 * 24 * 60 * 60 * 1000;
    expect(db.isIntegrityCheckDue()).toBe(true);
    expect(db.runIntegrityCheckIfDue().ran).toBe(true);
  });

  it("throws ReadOnlyDatabaseError from a closed handle after close", () => {
    const db = open();
    db.close();
    expect(() => db.setMeta("x", "y")).toThrow(ClosedDatabaseError);
    expect(() => db.getMeta("project_id")).toThrow(ClosedDatabaseError);
  });

  it("rejects world-readable Windows profile locations before creating state.db", () => {
    const publicRoot = process.env.PUBLIC ?? "C:\\Users\\Public";
    const rootDir = path.join(publicRoot, "ef-task-013-reject");
    const projectDir = path.join(rootDir, "projects", "PrivateCheck");
    if (process.platform === "win32") {
      expect(() => assertPrivateProjectPath(projectDir)).toThrow(WorldReadableProjectPathError);
      expect(() => open({ projectId: "PrivateCheck", rootDir })).toThrow(WorldReadableProjectPathError);
      expect(fs.existsSync(path.join(rootDir, "projects"))).toBe(false);
      expect(defaultHarnessRoot().toLowerCase()).toBe(
        path.join(process.env.LOCALAPPDATA ?? "", "EFHarness").toLowerCase(),
      );
      const db = open();
      const createdDir = path.dirname(db.databasePath);
      expect(createdDir.toLowerCase().startsWith(os.homedir().toLowerCase())).toBe(true);
      expect(windowsAccount(createdDir)).toBe(windowsAccount());
      return;
    }
    const root = tempRoot();
    const db = open({ rootDir: root });
    expect(fs.statSync(path.dirname(db.databasePath)).mode & 0o077).toBe(0);
  });

  it("retries a Windows EPERM rename and then gives up", () => {
    const attempts: string[] = [];
    const sleeps: number[] = [];
    let failures = 2;
    renameWithRetry("from", "to", {
      rename(from, to) {
        attempts.push(`${from}->${to}`);
        if (failures > 0) {
          failures -= 1;
          const error = new Error("busy") as NodeJS.ErrnoException;
          error.code = "EPERM";
          throw error;
        }
      },
      sleep(milliseconds) {
        sleeps.push(milliseconds);
      },
    });
    expect(attempts).toEqual(["from->to", "from->to", "from->to"]);
    expect(sleeps).toEqual([50, 100]);

    expect(() =>
      renameWithRetry("from", "to", {
        rename() {
          const error = new Error("still busy") as NodeJS.ErrnoException;
          error.code = "EPERM";
          throw error;
        },
        sleep() {
          return undefined;
        },
      }),
    ).toThrow(/still busy/);
  });

  it("rejects ATTACH DATABASE and nested write transactions", () => {
    expect(() => assertSqlHasNoAttach("ATTACH DATABASE 'other.db' AS other")).toThrow(
      AttachedDatabaseForbiddenError,
    );
    const root = tempRoot();
    const connection = openStateConnection(path.join(root, "nested.db"), "readwrite");
    try {
      expect(() =>
        connection.immediate(() => {
          connection.immediate(() => undefined);
        }),
      ).toThrow(NestedWriteTransactionError);
    } finally {
      connection.close();
    }
  });

  it("starts every write transaction with BEGIN IMMEDIATE", () => {
    const sourceDir = fileURLToPath(new URL("../../src/state-db/", import.meta.url));
    const files = fs.readdirSync(sourceDir).filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const source = fs.readFileSync(path.join(sourceDir, name), "utf8");
      for (const match of source.match(/\bBEGIN\b[^;\n]*/g) ?? []) {
        expect(match.startsWith("BEGIN IMMEDIATE")).toBe(true);
      }
    }
  });

  it("falls back to read-only while another process holds the lock and reclaims it after that process dies", async () => {
    const root = tempRoot();
    const projectId = "DualProcess";
    const readyFile = path.join(root, "ready.txt");
    const logger = captureLogger();
    const child = spawnHolder(root, projectId, readyFile);
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    try {
      const ready = await waitForReady(readyFile, child, () => stderr);
      expect(ready).toContain("READY 1");
      const reader = open({ projectId, rootDir: root, logger: logger.logger });
      expect(reader.mode).toBe("readonly");
      expect(reader.acquireWriterLock().acquired).toBe(false);
      expect(reader.getMeta("project_id")).toBe(projectId);
      expect(() => reader.setMeta("stolen", "no")).toThrow(ReadOnlyDatabaseError);
      expect(() => reader.bumpStreamEpoch("rehydrated")).toThrow(ReadOnlyDatabaseError);
      expect(() => reader.runIntegrityCheckIfDue()).toThrow(ReadOnlyDatabaseError);
      reader.close();
      child.kill();
      await waitForExit(child);
      const writer = await reclaimWriter(root, projectId, logger.logger);
      expect(writer.mode).toBe("readwrite");
      expect(writer.getOwner()?.epoch).toBe(2);
      expect(writer.getMeta("writer_epoch")).toBe("2");
      const reasons = reclaimEvents(logger.events).map((event) => event.reason);
      expect(reasons.some((reason) => reason === "pid_dead" || reason === "pid_reused")).toBe(true);
      writer.close();
    } finally {
      if (child.exitCode === null) child.kill();
    }
  }, 60_000);

  it("does not steal a lock whose owner process is still alive", () => {
    const root = tempRoot();
    const projectId = "LiveOwner";
    const first = open({ projectId, rootDir: root });
    const databasePath = first.databasePath;
    first.close();
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000000)"], {
      windowsHide: true,
      stdio: "ignore",
    });
    try {
      const pid = child.pid;
      if (pid === undefined) throw new Error("live owner process did not start");
      const started = windowsProcessStart(pid);
      tamperOwner(databasePath, (owner) => {
        owner.pid = pid;
        owner.processStartTime = started;
        owner.epoch = 4;
      });
      const reader = open({ projectId, rootDir: root });
      expect(reader.mode).toBe("readonly");
      expect(reader.acquireWriterLock()).toMatchObject({ acquired: false, mode: "readonly" });
      expect(reader.getOwner()?.epoch).toBe(4);
      expect(reader.getOwner()?.pid).toBe(pid);
      expect(() => reader.setMeta("stolen", "no")).toThrow(ReadOnlyDatabaseError);
      expect(reader.getMeta("writer_epoch")).toBe("1");
    } finally {
      child.kill();
    }
  });

  it("enters safe mode when quick_check fails after an out-of-band page corruption", () => {
    const root = tempRoot();
    const projectId = "CorruptPage";
    const seeded = open({ projectId, rootDir: root });
    const databasePath = seeded.databasePath;
    const projectDir = path.dirname(databasePath);
    fs.mkdirSync(path.join(projectDir, "worktrees"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "worktrees", "keep.txt"), "keep");
    seeded.close();
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
    const bytes = fs.readFileSync(databasePath);
    expect(bytes.length).toBeGreaterThan(4096);
    const pageType = bytes[4096] ?? 0;
    bytes[4096] = pageType === 0x2a ? 0x2b : 0x2a;
    fs.writeFileSync(databasePath, bytes);
    let opened: ProjectStateDb | undefined;
    try {
      opened = open({ projectId, rootDir: root });
      expect(opened.isSafeMode()).toBe(true);
      expect(opened.getSafeModeStatus()?.reason).toBe("corrupt");
      expect(opened.getSafeModeStatus()?.priority).toBe("high");
      expect(() => opened.setMeta("after_corrupt", "no")).toThrow(ProjectSafeModeError);
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectSafeModeError);
      if (error instanceof ProjectSafeModeError) expect(error.reason).toBe("corrupt");
    }
    expect(fs.readFileSync(path.join(projectDir, "worktrees", "keep.txt"), "utf8")).toBe("keep");
  });

  it("publishes a high-priority safe-mode payload for every trigger reason", () => {
    const logger = captureLogger();
    const controller = new SafeModeController("project-safe", logger.logger);
    const reasons: SafeModeReason[] = ["foreign_write", "disk_io_error", "corrupt"];
    for (const reason of reasons) {
      const seen: SafeModeReason[] = [];
      const unsubscribe = controller.subscribe((payload) => {
        seen.push(payload.reason);
        expect(payload.priority).toBe("high");
        expect(payload.dispatchBlocked).toBe(true);
        expect(payload.writesBlocked).toBe(true);
        expect(payload.worktreesPreserved).toBe(true);
        expect(payload.checkpointsPreserved).toBe(true);
      });
      controller.arm(reason, {
        message: reason,
        worktreesPreserved: true,
        checkpointsPreserved: true,
      });
      controller.publish("readwrite");
      expect(seen).toEqual([reason]);
      expect(() => controller.refuseIfActive()).toThrow(ProjectSafeModeError);
      unsubscribe();
    }
  });
});

function open(options: {
  projectId?: string;
  rootDir?: string;
  logger?: StateDbLogger;
  now?: () => number;
  beforePublish?: () => void;
  onSafeMode?: (payload: unknown) => void;
  onResyncRequired?: (payload: unknown) => void;
} = {}): ProjectStateDb {
  const rootDir = options.rootDir ?? tempRoot();
  const db = openProjectStateDb({
    projectId: options.projectId ?? `P${Math.random().toString(16).slice(2)}`,
    rootDir,
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.beforePublish ? { beforePublish: options.beforePublish } : {}),
    ...(options.onSafeMode
      ? { onSafeMode: options.onSafeMode as NonNullable<Parameters<typeof openProjectStateDb>[0]["onSafeMode"]> }
      : {}),
    ...(options.onResyncRequired
      ? {
          onResyncRequired:
            options.onResyncRequired as NonNullable<
              Parameters<typeof openProjectStateDb>[0]["onResyncRequired"]
            >,
        }
      : {}),
  });
  opened.push(db);
  return db;
}

function tempRoot(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ef013-"));
  directories.push(directory);
  return directory;
}

function rootOf(db: ProjectStateDb): string {
  return path.resolve(db.databasePath, "..", "..", "..");
}

function captureLogger(): { logger: StateDbLogger; events: Array<Record<string, unknown>> } {
  const events: Array<Record<string, unknown>> = [];
  const push = (fields: unknown): void => {
    if (fields && typeof fields === "object") events.push(fields as Record<string, unknown>);
  };
  return {
    events,
    logger: {
      info(_message, fields) {
        push(fields);
      },
      warn(_message, fields) {
        push(fields);
      },
      error(_message, fields) {
        push(fields);
      },
    },
  };
}

function reclaimEvents(events: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return events.filter((event) => event.event === "state_db.writer_lock.reclaimed");
}

function tamperOwner(databasePath: string, mutate: (owner: Record<string, unknown>) => void): void {
  const raw = new DatabaseSync(databasePath);
  const row = raw.prepare("SELECT value FROM meta WHERE key = ?").get("owner") as
    | { value: string }
    | undefined;
  if (!row) {
    raw.close();
    throw new Error("owner row is missing");
  }
  const owner = JSON.parse(row.value) as Record<string, unknown>;
  mutate(owner);
  raw.prepare("UPDATE meta SET value = ? WHERE key = 'owner'").run(JSON.stringify(owner));
  raw.close();
}

function spawnHolder(rootDir: string, projectId: string, readyFile: string): ChildProcess {
  const loader = pathToFileURL(require.resolve("tsx")).href;
  const holder = fileURLToPath(new URL("./hold-writer.ts", import.meta.url));
  const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  return spawn(process.execPath, ["--import", loader, holder, rootDir, projectId, readyFile], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

async function waitForReady(
  readyFile: string,
  child: ChildProcess,
  stderr: () => string,
): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    if (fs.existsSync(readyFile)) return fs.readFileSync(readyFile, "utf8");
    if (child.exitCode !== null) {
      throw new Error(`holder exited ${child.exitCode}: ${stderr()}`);
    }
    await delay(50);
  }
  child.kill();
  throw new Error(`holder did not become ready: ${stderr()}`);
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("holder did not exit after kill"));
    }, 10_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function reclaimWriter(
  rootDir: string,
  projectId: string,
  logger: StateDbLogger,
): Promise<ProjectStateDb> {
  const started = Date.now();
  let lastMode = "unopened";
  while (Date.now() - started < 8_000) {
    const db = open({ projectId, rootDir, logger });
    if (db.mode === "readwrite") return db;
    lastMode = db.mode;
    db.close();
    await delay(100);
  }
  throw new Error(`writer lock was not reclaimed (last mode ${lastMode})`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function windowsProcessStart(pid: number): string {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `try { $process = Get-Process -Id ${pid} -ErrorAction Stop; Write-Output ([DateTimeOffset]::new($process.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()) } catch { exit 3 }`,
  ].join("; ");
  const stdout = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", windowsHide: true, timeout: 15_000 },
  );
  const value = stdout.trim();
  if (!/^-?\d+$/.test(value)) throw new Error(`could not read process start time for ${pid}`);
  return value;
}

function windowsAccount(folder?: string): string {
  const script = folder
    ? `(Get-Acl -LiteralPath ${psLiteral(folder)}).Owner`
    : "[System.Security.Principal.WindowsIdentity]::GetCurrent().Name";
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
  }).trim();
}

function psLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
