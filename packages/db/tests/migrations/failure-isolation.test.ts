import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { vacuumBytesNeeded } from "../../src/migrations/backup.js";
import { createNodeSqliteConnectionFactory, openNodeSqliteConnection } from "../../src/migrations/connection.js";
import {
  DatabaseNewerThanAppError,
  InsufficientDiskSpaceError,
  MigrationFailedError,
  MigrationRegistryError,
  ReadersActiveError,
  SchemaVersionGapError,
  WorkNotParkedError,
} from "../../src/migrations/errors.js";
import { connectGlobalBrokerDb, listNeedsRepairProjects, readProjectStatus } from "../../src/migrations/needs-repair.js";
import { productionMigrations } from "../../src/migrations/production.js";
import { runTwelveStepRebuild } from "../../src/migrations/rebuild.js";
import { rehearseMigration } from "../../src/migrations/rehearse.js";
import { MigrationRunner, migrateDatabase } from "../../src/migrations/runner.js";
import { REPAIR_OPTIONS } from "../../src/migrations/types.js";
import type { GlobalBrokerDb, MigrationDefinition, SqliteConnection, SqliteConnectionFactory } from "../../src/migrations/types.js";
import {
  APP_VERSION,
  HASH_A,
  HASH_B,
  closedReaders,
  createGlobalDb,
  createStateDb,
  createTinyDb,
  fileHash,
  fixedClock,
  globalAdditive,
  num,
  priorityRebuildPlan,
  readPins,
  stateAdditive,
  stateRebuild,
  userVersion,
  withConnection,
  withDir,
} from "./fixture.js";
const guardBroker: GlobalBrokerDb = {
  setProjectStatus() {
    throw new Error("global failure must not mark a project");
  },
  registerBackupCasPins() {
    throw new Error("global migration must not pin project artifacts");
  },
};

function failingQuickCheckFactory(): SqliteConnectionFactory {
  const inner = createNodeSqliteConnectionFactory();
  return {
    open(dbPath, options) {
      const conn = inner.open(dbPath, options);
      if (options.readOnly) return conn;
      let remaining = 1;
      const wrapped: SqliteConnection = {
        exec(sql) {
          conn.exec(sql);
        },
        prepare(sql) {
          const statement = conn.prepare(sql);
          if (sql !== "PRAGMA quick_check") return statement;
          return {
            run(...params) {
              return statement.run(...params);
            },
            get(...params) {
              return statement.get(...params);
            },
            all(...params) {
              if (remaining > 0) {
                remaining -= 1;
                return [{ quick_check: "simulated quick_check failure" }];
              }
              return statement.all(...params);
            },
          };
        },
        registerFunction(name, fn) {
          conn.registerFunction(name, fn);
        },
        close() {
          conn.close();
        },
      };
      return wrapped;
    },
  };
}

describe("migration failure isolation", () => {
  it("restores a failed project bit-for-bit and leaves the other project ok", async () => {
    await withDir(async (dir) => {
      const alphaDir = path.join(dir, "alpha");
      const betaDir = path.join(dir, "beta");
      const alphaPath = createStateDb(alphaDir, "state.db", { artifactHash: HASH_A, freelist: true });
      const betaPath = createStateDb(betaDir, "state.db", { artifactHash: HASH_B });
      const globalPath = createGlobalDb(dir, [
        { id: "alpha", stateDbPath: alphaPath, name: "Alpha" },
        { id: "beta", stateDbPath: betaPath, name: "Beta" },
      ]);
      const originalAlpha = fs.readFileSync(alphaPath);
      const broker = connectGlobalBrokerDb(globalPath);
      const startup = new MigrationRunner({
        globalDbPath: globalPath,
        globalDb: broker,
        migrations: [globalAdditive],
        appVersion: APP_VERSION,
        readers: closedReaders,
        clock: fixedClock,
      });
      await startup.migrateOnStartup();
      expect(userVersion(globalPath, "global")).toBe(2);

      const beta = await migrateDatabase({
        dbPath: betaPath,
        targetDb: "state",
        migrations: [stateAdditive, stateRebuild],
        appVersion: APP_VERSION,
        readers: closedReaders,
        clock: fixedClock,
        globalDb: broker,
        projectId: "beta",
      });
      expect(beta.ok).toBe(true);
      const betaHash = fileHash(betaPath);
      expect(userVersion(betaPath, "state")).toBe(3);
      expect(readProjectStatus(globalPath, "beta")).toBe("ok");

      const boom: MigrationDefinition = {
        kind: "data",
        version: 3,
        name: "injected_failure",
        targetDb: "state",
        apply() {
          throw new Error("injected migration failure");
        },
      };
      const alpha = await migrateDatabase({
        dbPath: alphaPath,
        targetDb: "state",
        migrations: [stateAdditive, boom],
        appVersion: APP_VERSION,
        readers: closedReaders,
        clock: fixedClock,
        globalDb: broker,
        projectId: "alpha",
      });
      expect(alpha.ok).toBe(false);
      if (alpha.ok) return;
      expect(alpha.status).toBe("needs_repair");
      expect(alpha.options).toEqual(["Retry", "Export", "Report"]);
      expect(alpha.options).toBe(REPAIR_OPTIONS);
      expect(alpha.projectId).toBe("alpha");
      expect(alpha.message).toContain("injected migration failure");
      const restored = fs.readFileSync(alphaPath);
      const backup = fs.readFileSync(alpha.backupPath);
      expect(restored.equals(backup)).toBe(true);
      expect(restored.equals(originalAlpha)).toBe(false);
      expect(restored.length).toBeLessThan(originalAlpha.length);
      expect(userVersion(alphaPath, "state")).toBe(1);
      withConnection(alphaPath, "state", true, (conn) => {
        expect(num(conn.prepare("SELECT count(*) AS c FROM schema_migrations").get()?.c)).toBe(0);
        const note = conn.prepare("SELECT count(*) AS c FROM pragma_table_info('nodes') WHERE name = 'note'").get();
        expect(num(note?.c)).toBe(0);
        expect(conn.prepare("SELECT title FROM nodes WHERE id = 'REQ1'").get()?.title).toBe("parseHttpResponse");
      });
      expect(fs.existsSync(`${alphaPath}-wal`)).toBe(false);
      expect(fs.existsSync(`${alphaPath}-shm`)).toBe(false);
      expect(fileHash(betaPath)).toBe(betaHash);
      expect(userVersion(betaPath, "state")).toBe(3);
      expect(readProjectStatus(globalPath, "beta")).toBe("ok");
      expect(readProjectStatus(globalPath, "alpha")).toBe("needs_repair");
      expect(userVersion(globalPath, "global")).toBe(2);
      expect(listNeedsRepairProjects(globalPath).map((project) => project.id)).toEqual(["alpha"]);
      expect(listNeedsRepairProjects(globalPath)[0]?.options).toEqual(["Retry", "Export", "Report"]);
      const pins = readPins(globalPath);
      expect(pins.map((pin) => pin.hash).sort()).toEqual([HASH_A, HASH_B].sort());
      expect(pins.find((pin) => pin.hash === HASH_A)?.holderKind).toBe("backup");
      withConnection(globalPath, "global", true, (conn) => {
        expect(num(conn.prepare("SELECT count(*) AS c FROM projects").get()?.c)).toBe(2);
        const note = conn.prepare("SELECT count(*) AS c FROM pragma_table_info('projects') WHERE name = 'note'").get();
        expect(num(note?.c)).toBe(1);
      });
    });
  });

  it("restores when a synthetic rebuild fails foreign_key_check", async () => {
    await withDir(async (dir) => {
      const projectDir = path.join(dir, "alpha");
      const statePath = createStateDb(projectDir, "state.db", { freelist: true });
      const globalPath = createGlobalDb(dir, [{ id: "alpha", stateDbPath: statePath, name: "Alpha" }]);
      const original = fs.readFileSync(statePath);
      const buggy: MigrationDefinition = {
        kind: "rebuild",
        version: 2,
        name: "buggy_foreign_key_rebuild",
        targetDb: "state",
        apply(conn) {
          stateAdditive.apply(conn);
          runTwelveStepRebuild(conn, priorityRebuildPlan({ corruptForeignKey: true }));
        },
      };
      const outcome = await migrateDatabase({
        dbPath: statePath,
        targetDb: "state",
        migrations: [buggy],
        appVersion: APP_VERSION,
        readers: closedReaders,
        clock: fixedClock,
        globalDb: connectGlobalBrokerDb(globalPath),
        projectId: "alpha",
      });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.message).toContain("foreign_key_check");
      expect(fs.readFileSync(statePath).equals(fs.readFileSync(outcome.backupPath))).toBe(true);
      expect(fs.readFileSync(statePath).equals(original)).toBe(false);
      expect(userVersion(statePath, "state")).toBe(1);
      withConnection(statePath, "state", true, (conn) => {
        expect(conn.prepare("SELECT id FROM nodes WHERE id = 'BAD1'").get()).toBeUndefined();
        expect(conn.prepare("SELECT id FROM nodes WHERE id = 'REQ1'").get()?.id).toBe("REQ1");
      });
      expect(readProjectStatus(globalPath, "alpha")).toBe("needs_repair");
    });
  });

  it("restores when post-migration quick_check fails", async () => {
    await withDir(async (dir) => {
      const projectDir = path.join(dir, "alpha");
      const statePath = createStateDb(projectDir, "state.db", { freelist: true });
      const globalPath = createGlobalDb(dir, [{ id: "alpha", stateDbPath: statePath, name: "Alpha" }]);
      const original = fs.readFileSync(statePath);
      const outcome = await migrateDatabase({
        dbPath: statePath,
        targetDb: "state",
        migrations: [stateAdditive, stateRebuild],
        appVersion: APP_VERSION,
        readers: closedReaders,
        clock: fixedClock,
        globalDb: connectGlobalBrokerDb(globalPath),
        projectId: "alpha",
        connectionFactory: failingQuickCheckFactory(),
      });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.message).toContain("quick_check");
      expect(fs.readFileSync(statePath).equals(fs.readFileSync(outcome.backupPath))).toBe(true);
      expect(fs.readFileSync(statePath).equals(original)).toBe(false);
      expect(userVersion(statePath, "state")).toBe(1);
      expect(readProjectStatus(globalPath, "alpha")).toBe("needs_repair");
    });
  });

  it("restores when a rebuild forgets a view or drops the integer primary key", async () => {
    await withDir(async (dir) => {
      const forgottenDir = path.join(dir, "forgotten");
      const forgottenPath = createStateDb(forgottenDir, "state.db", { freelist: true });
      const pkDir = path.join(dir, "primary");
      const pkPath = createStateDb(pkDir, "state.db", { freelist: true });
      const globalPath = createGlobalDb(dir, [
        { id: "forgotten", stateDbPath: forgottenPath, name: "Forgotten" },
        { id: "primary", stateDbPath: pkPath, name: "Primary" },
      ]);
      const broker = connectGlobalBrokerDb(globalPath);
      const forgottenOriginal = fs.readFileSync(forgottenPath);
      const pkOriginal = fs.readFileSync(pkPath);
      const forgotten: MigrationDefinition = {
        kind: "rebuild",
        version: 2,
        name: "forgot_requirements_view",
        targetDb: "state",
        apply(conn) {
          stateAdditive.apply(conn);
          runTwelveStepRebuild(conn, priorityRebuildPlan({ omitDependentObjects: ["requirements"] }));
        },
      };
      const missingKey: MigrationDefinition = {
        kind: "rebuild",
        version: 2,
        name: "drop_integer_primary_key",
        targetDb: "state",
        apply(conn) {
          stateAdditive.apply(conn);
          runTwelveStepRebuild(conn, priorityRebuildPlan({ integerPrimaryKey: false }));
        },
      };
      const forgottenOutcome = await migrateDatabase({
        dbPath: forgottenPath,
        targetDb: "state",
        migrations: [forgotten],
        appVersion: APP_VERSION,
        readers: closedReaders,
        clock: fixedClock,
        globalDb: broker,
        projectId: "forgotten",
      });
      const pkOutcome = await migrateDatabase({
        dbPath: pkPath,
        targetDb: "state",
        migrations: [missingKey],
        appVersion: APP_VERSION,
        readers: closedReaders,
        clock: fixedClock,
        globalDb: broker,
        projectId: "primary",
      });
      expect(forgottenOutcome.ok).toBe(false);
      expect(pkOutcome.ok).toBe(false);
      if (forgottenOutcome.ok || pkOutcome.ok) return;
      expect(forgottenOutcome.message).toContain("requirements");
      expect(pkOutcome.message).toContain("INTEGER PRIMARY KEY");
      expect(fs.readFileSync(forgottenPath).equals(fs.readFileSync(forgottenOutcome.backupPath))).toBe(true);
      expect(fs.readFileSync(forgottenPath).equals(forgottenOriginal)).toBe(false);
      expect(fs.readFileSync(pkPath).equals(fs.readFileSync(pkOutcome.backupPath))).toBe(true);
      expect(fs.readFileSync(pkPath).equals(pkOriginal)).toBe(false);
      withConnection(forgottenPath, "state", true, (conn) => {
        expect(conn.prepare("SELECT id FROM requirements").all().map((row) => row.id)).toEqual(["REQ1"]);
      });
      expect(readProjectStatus(globalPath, "forgotten")).toBe("needs_repair");
      expect(readProjectStatus(globalPath, "primary")).toBe("needs_repair");
    });
  });

  it("refuses a v99 database from a v1 app and lists backups without modifying the file", async () => {
    await withDir(async (dir) => {
      const statePath = path.join(dir, "state.db");
      createTinyDb(statePath, 99, "state");
      const backups = path.join(dir, "backups");
      fs.mkdirSync(backups);
      const older = path.join(backups, "pre-migration-v1-to-v2-10.db");
      const newer = path.join(backups, "pre-migration-v2-to-v3-20.db");
      fs.writeFileSync(older, "older-backup");
      fs.writeFileSync(newer, "newer-backup");
      fs.writeFileSync(path.join(backups, "notes.txt"), "decoy");
      fs.writeFileSync(path.join(backups, "backup.db"), "decoy");
      const before = fileHash(statePath);
      let caught: unknown;
      try {
        await migrateDatabase({
          dbPath: statePath,
          targetDb: "state",
          migrations: productionMigrations,
          appVersion: APP_VERSION,
          readers: {
            drainAndClose() {
              throw new Error("downgrade guard must not drain or migrate");
            },
          },
          clock: fixedClock,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(DatabaseNewerThanAppError);
      if (!(caught instanceof DatabaseNewerThanAppError)) return;
      expect(caught.userVersion).toBe(99);
      expect(caught.maxKnownVersion).toBe(1);
      expect(caught.backupPaths).toEqual([older, newer]);
      expect(caught.message).toContain(statePath);
      expect(caught.message).toContain(older);
      expect(caught.message).toContain(newer);
      expect(fileHash(statePath)).toBe(before);
      expect(userVersion(statePath, "state")).toBe(99);
    });
  });

  it("aborts before mutating when the pre-migration backup lacks disk space", async () => {
    await withDir(async (dir) => {
      const dbPath = path.join(dir, "global.db");
      createTinyDb(dbPath, 1, "global");
      const before = fileHash(dbPath);
      let needed = 0;
      withConnection(dbPath, "global", true, (conn) => {
        needed = vacuumBytesNeeded(conn);
      });
      let caught: unknown;
      try {
        await migrateDatabase({
          dbPath,
          targetDb: "global",
          migrations: [globalAdditive],
          appVersion: APP_VERSION,
          readers: closedReaders,
          clock: fixedClock,
          diskSpace: { availableBytes: () => 1 },
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(InsufficientDiskSpaceError);
      if (!(caught instanceof InsufficientDiskSpaceError)) return;
      expect(caught.bytesNeeded).toBe(needed);
      expect(caught.bytesAvailable).toBe(1);
      expect(caught.message).toContain(String(needed));
      expect(caught.message).toContain("was not modified");
      expect(fileHash(dbPath)).toBe(before);
      expect(fs.existsSync(path.join(dir, "backups"))).toBe(false);
      expect(userVersion(dbPath, "global")).toBe(1);
    });
  });

  it("aborts when readers do not close before the migration lock", async () => {
    await withDir(async (dir) => {
      const dbPath = path.join(dir, "global.db");
      createTinyDb(dbPath, 1, "global");
      const before = fileHash(dbPath);
      let caught: unknown;
      try {
        await migrateDatabase({
          dbPath,
          targetDb: "global",
          migrations: [globalAdditive],
          appVersion: APP_VERSION,
          readers: {
            drainAndClose() {
              return new Promise(() => undefined);
            },
          },
          readerDrainTimeoutMs: 30,
          clock: fixedClock,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ReadersActiveError);
      if (!(caught instanceof ReadersActiveError)) return;
      expect(caught.message).toContain("30");
      expect(fileHash(dbPath)).toBe(before);
      expect(fs.existsSync(path.join(dir, "backups"))).toBe(false);
    });
  });

  it("aborts when an open reader still holds the database lock", async () => {
    await withDir(async (dir) => {
      const dbPath = path.join(dir, "global.db");
      createTinyDb(dbPath, 1, "global");
      const before = fileHash(dbPath);
      const blocker = openNodeSqliteConnection(dbPath, { readOnly: false, targetDb: "global" });
      blocker.exec("PRAGMA busy_timeout = 0");
      blocker.exec("BEGIN IMMEDIATE");
      const factory = createNodeSqliteConnectionFactory();
      try {
        await expect(
          migrateDatabase({
            dbPath,
            targetDb: "global",
            migrations: [globalAdditive],
            appVersion: APP_VERSION,
            readers: closedReaders,
            clock: fixedClock,
            connectionFactory: {
              open(file, options) {
                const conn = factory.open(file, options);
                if (!options.readOnly) conn.exec("PRAGMA busy_timeout = 0");
                return conn;
              },
            },
          }),
        ).rejects.toBeInstanceOf(ReadersActiveError);
      } finally {
        blocker.exec("ROLLBACK");
        blocker.close();
      }
      expect(fileHash(dbPath)).toBe(before);
      expect(userVersion(dbPath, "global")).toBe(1);
    });
  }, 15_000);

  it("refuses unparked work, then migrates once that work is parked", async () => {
    await withDir(async (dir) => {
      const projectDir = path.join(dir, "alpha");
      const statePath = createStateDb(projectDir, "state.db", {
        tasks: [{ task: "T07", state: "CODING" }],
        attempts: [{ id: "attempt-1", task: "T07", state: "running" }],
      });
      const globalPath = createGlobalDb(dir, [{ id: "alpha", stateDbPath: statePath, name: "Alpha" }]);
      const before = fileHash(statePath);
      const broker = connectGlobalBrokerDb(globalPath);
      let caught: unknown;
      try {
        await migrateDatabase({
          dbPath: statePath,
          targetDb: "state",
          migrations: [stateAdditive],
          appVersion: APP_VERSION,
          readers: closedReaders,
          clock: fixedClock,
          globalDb: broker,
          projectId: "alpha",
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(WorkNotParkedError);
      if (!(caught instanceof WorkNotParkedError)) return;
      expect(caught.activeWork.join(" ")).toContain("CODING");
      expect(caught.activeWork.join(" ")).toContain("attempt-1");
      expect(fileHash(statePath)).toBe(before);
      expect(fs.existsSync(path.join(projectDir, "backups"))).toBe(false);
      withConnection(statePath, "state", false, (conn) => {
        conn.exec("UPDATE task_runtime SET state = 'PARKED'");
        conn.exec("UPDATE attempts SET state = 'parked'");
      });
      const outcome = await migrateDatabase({
        dbPath: statePath,
        targetDb: "state",
        migrations: [stateAdditive],
        appVersion: APP_VERSION,
        readers: closedReaders,
        clock: fixedClock,
        globalDb: broker,
        projectId: "alpha",
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.toVersion).toBe(2);
      expect(readProjectStatus(globalPath, "alpha")).toBe("ok");
    });
  });

  it("rejects skipped, reversed, duplicate, and below-baseline versions before upgrade", async () => {
    await withDir(async (dir) => {
      const dbPath = path.join(dir, "global.db");
      createTinyDb(dbPath, 1, "global");
      const before = fileHash(dbPath);
      const additive = (version: number, name: string): MigrationDefinition => ({
        kind: "additive",
        version,
        name,
        targetDb: "global",
        apply() {
          throw new Error("must not run");
        },
      });
      const cases: readonly (readonly MigrationDefinition[])[] = [
        [additive(2, "one"), additive(4, "skip")],
        [additive(3, "third"), additive(2, "second")],
        [additive(2, "same"), additive(2, "other")],
        [additive(2, "same"), { ...additive(2, "same"), targetDb: "state" }],
        [additive(1, "collides_with_baseline")],
      ];
      for (const migrations of cases) {
        expect(() =>
          new MigrationRunner({
            globalDbPath: dbPath,
            globalDb: guardBroker,
            migrations,
            appVersion: APP_VERSION,
            readers: closedReaders,
          }),
        ).toThrow(MigrationRegistryError);
        await expect(
          migrateDatabase({
            dbPath,
            targetDb: "global",
            migrations,
            appVersion: APP_VERSION,
            readers: closedReaders,
            clock: fixedClock,
          }),
        ).rejects.toBeInstanceOf(MigrationRegistryError);
      }
      createTinyDb(path.join(dir, "zero.db"), 0, "global");
      const zeroPath = path.join(dir, "zero.db");
      const zeroBefore = fileHash(zeroPath);
      await expect(
        migrateDatabase({
          dbPath: zeroPath,
          targetDb: "global",
          migrations: [additive(2, "from_zero")],
          appVersion: APP_VERSION,
          readers: closedReaders,
          clock: fixedClock,
        }),
      ).rejects.toBeInstanceOf(SchemaVersionGapError);
      expect(fileHash(dbPath)).toBe(before);
      expect(fileHash(zeroPath)).toBe(zeroBefore);
      expect(userVersion(dbPath, "global")).toBe(1);
    });
  });

  it("restores global.db when its own migration fails and does not mark projects", async () => {
    await withDir(async (dir) => {
      const statePath = createStateDb(path.join(dir, "alpha"), "state.db");
      const globalPath = createGlobalDb(dir, [{ id: "alpha", stateDbPath: statePath, name: "Alpha" }]);
      withConnection(globalPath, "global", false, (conn) => {
        conn.exec("CREATE TABLE scratch (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)");
        const insert = conn.prepare("INSERT INTO scratch(payload) VALUES (?)");
        const payload = "y".repeat(4000);
        conn.exec("BEGIN IMMEDIATE");
        for (let index = 0; index < 40; index += 1) insert.run(payload);
        conn.exec("COMMIT");
        conn.exec("DELETE FROM scratch");
      });
      const original = fs.readFileSync(globalPath);
      const failing: MigrationDefinition = {
        kind: "data",
        version: 2,
        name: "global_boom",
        targetDb: "global",
        apply() {
          throw new Error("injected global failure");
        },
      };
      const runner = new MigrationRunner({
        globalDbPath: globalPath,
        globalDb: guardBroker,
        migrations: [failing],
        appVersion: APP_VERSION,
        readers: closedReaders,
        clock: fixedClock,
      });
      await expect(runner.migrateOnStartup()).rejects.toBeInstanceOf(MigrationFailedError);
      let caught: unknown;
      try {
        await runner.migrateGlobalDatabase();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(MigrationFailedError);
      if (!(caught instanceof MigrationFailedError)) return;
      expect(caught.restored).toBe(true);
      expect(caught.message).toContain("injected global failure");
      expect(caught.backupPath).not.toBeNull();
      const backupPath = caught.backupPath ?? "";
      expect(fs.readFileSync(globalPath).equals(fs.readFileSync(backupPath))).toBe(true);
      expect(fs.readFileSync(globalPath).equals(original)).toBe(false);
      expect(userVersion(globalPath, "global")).toBe(1);
      expect(readProjectStatus(globalPath, "alpha")).toBe("ok");
    });
  });

  it("keeps a failed rehearsal off the production database", async () => {
    await withDir(async (dir) => {
      const projectDir = path.join(dir, "alpha");
      const statePath = createStateDb(projectDir, "state.db");
      const globalPath = createGlobalDb(dir, [{ id: "alpha", stateDbPath: statePath, name: "Alpha" }]);
      const before = fileHash(statePath);
      const failing: MigrationDefinition = {
        kind: "data",
        version: 2,
        name: "rehearse_boom",
        targetDb: "state",
        apply() {
          throw new Error("rehearsal injected failure");
        },
      };
      const report = await rehearseMigration(statePath, [failing], {
        targetDb: "state",
        appVersion: APP_VERSION,
        readers: closedReaders,
        clock: fixedClock,
      });
      expect(report.ok).toBe(false);
      expect(report.sourceUnmodified).toBe(true);
      expect(report.message).toContain("rehearsal injected failure");
      expect(fileHash(statePath)).toBe(before);
      expect(userVersion(statePath, "state")).toBe(1);
      expect(readProjectStatus(globalPath, "alpha")).toBe("ok");
      expect(readPins(globalPath)).toEqual([]);
    });
  });

  it("rolls back a failing invariant check and restores the backup", async () => {
    await withDir(async (dir) => {
      const projectDir = path.join(dir, "alpha");
      const statePath = createStateDb(projectDir, "state.db", { freelist: true });
      const globalPath = createGlobalDb(dir, [{ id: "alpha", stateDbPath: statePath, name: "Alpha" }]);
      const original = fs.readFileSync(statePath);
      const failing: MigrationDefinition = {
        kind: "data",
        version: 2,
        name: "check_fails",
        targetDb: "state",
        apply(conn) {
          conn.exec("UPDATE meta SET value = 'temp' WHERE key = 'project_id'");
        },
        check() {
          throw new Error("invariant failed");
        },
      };
      const outcome = await migrateDatabase({
        dbPath: statePath,
        targetDb: "state",
        migrations: [failing],
        appVersion: APP_VERSION,
        readers: closedReaders,
        clock: fixedClock,
        globalDb: connectGlobalBrokerDb(globalPath),
        projectId: "alpha",
      });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.message).toContain("invariant failed");
      expect(fs.readFileSync(statePath).equals(fs.readFileSync(outcome.backupPath))).toBe(true);
      expect(fs.readFileSync(statePath).equals(original)).toBe(false);
      withConnection(statePath, "state", true, (conn) => {
        expect(conn.prepare("SELECT value FROM meta WHERE key = 'project_id'").get()?.value).toBe("fixture");
      });
      expect(readProjectStatus(globalPath, "alpha")).toBe("needs_repair");
    });
  });
});
