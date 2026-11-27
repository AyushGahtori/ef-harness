import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";
import { fileFingerprint } from "../../src/migrations/backup.js";
import { connectGlobalBrokerDb, readProjectStatus } from "../../src/migrations/needs-repair.js";
import { PRODUCTION_SCHEMA_VERSION, productionMigrations } from "../../src/migrations/production.js";
import { FTS_PENDING_META_KEY } from "../../src/migrations/rebuild.js";
import { rehearseMigration } from "../../src/migrations/rehearse.js";
import { MigrationRunner } from "../../src/migrations/runner.js";
import { CODE_INDEX_V2_MIGRATION_NAME, STATE_V2_MIGRATION_NAME } from "../../src/migrations/v2.js";
import {
  APP_VERSION,
  CLOCK_NOW,
  HASH_A,
  appMigrations,
  closedReaders,
  createGlobalDb,
  createStateDb,
  fileHash,
  fixedClock,
  num,
  readAudit,
  readPins,
  scalar,
  stateData,
  userVersion,
  withConnection,
  withDir,
} from "./fixture.js";

describe("forward-only migration", () => {
  it("rehearses, migrates global first, then applies additive v2 and rebuild v3", async () => {
    await withDir(async (dir) => {
      const projectDir = path.join(dir, "alpha");
      const statePath = createStateDb(projectDir, "state.db", { artifactHash: HASH_A });
      const globalPath = createGlobalDb(dir, [
        { id: "alpha", stateDbPath: statePath, name: "Alpha" },
      ]);
      const sourceHash = fileHash(statePath);
      const sourceFingerprint = fileFingerprint(statePath);
      const globalHash = fileHash(globalPath);
      const migrations = appMigrations();
      const runner = new MigrationRunner({
        globalDbPath: globalPath,
        globalDb: connectGlobalBrokerDb(globalPath),
        migrations,
        appVersion: APP_VERSION,
        readers: closedReaders,
        clock: fixedClock,
      });

      const rehearsal = await rehearseMigration(statePath, migrations, {
        targetDb: "state",
        appVersion: APP_VERSION,
        readers: closedReaders,
        clock: fixedClock,
      });
      expect(rehearsal.sourceUnmodified).toBe(true);
      expect(rehearsal.ok).toBe(true);
      expect(rehearsal.fromVersion).toBe(1);
      expect(rehearsal.toVersion).toBe(3);
      expect(rehearsal.applied.map((row) => row.name)).toEqual(["nodes_add_note", "nodes_priority_rebuild"]);
      expect(fileHash(statePath)).toBe(sourceHash);
      expect(fileFingerprint(statePath)).toBe(sourceFingerprint);
      expect(fileHash(globalPath)).toBe(globalHash);
      expect(userVersion(statePath, "state")).toBe(1);
      expect(readPins(globalPath)).toEqual([]);

      const started = await runner.migrateOnStartup();
      expect(started.ok).toBe(true);
      expect(started.targetDb).toBe("global");
      expect(started.fromVersion).toBe(1);
      expect(started.toVersion).toBe(2);
      expect(started.applied.map((row) => row.kind)).toEqual(["additive"]);
      expect(fileHash(statePath)).toBe(sourceHash);
      expect(fileFingerprint(statePath)).toBe(sourceFingerprint);
      expect(userVersion(statePath, "state")).toBe(1);
      expect(userVersion(globalPath, "global")).toBe(2);

      const outcome = await runner.openProject({ id: "alpha", stateDbPath: statePath });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.fromVersion).toBe(1);
      expect(outcome.toVersion).toBe(3);
      expect(outcome.backupPath).not.toBeNull();
      const backupPath = outcome.backupPath ?? "";
      expect(path.basename(backupPath)).toBe(`pre-migration-v1-to-v3-${CLOCK_NOW}.db`);
      expect(outcome.applied).toEqual([
        {
          version: 2,
          name: "nodes_add_note",
          kind: "additive",
          appVersion: APP_VERSION,
          appliedAt: CLOCK_NOW,
        },
        {
          version: 3,
          name: "nodes_priority_rebuild",
          kind: "rebuild",
          appVersion: APP_VERSION,
          appliedAt: CLOCK_NOW,
        },
      ]);

      expect(userVersion(backupPath, "state")).toBe(1);
      withConnection(backupPath, "state", true, (conn) => {
        expect(readAudit(conn)).toEqual([]);
        expect(conn.prepare("PRAGMA quick_check").all().map((row) => row.quick_check)).toEqual(["ok"]);
        const note = conn.prepare("SELECT count(*) AS c FROM pragma_table_info('nodes') WHERE name = 'note'").get();
        expect(num(note?.c)).toBe(0);
      });

      withConnection(statePath, "state", false, (conn) => {
        expect(readAudit(conn)).toEqual([
          {
            version: 2,
            name: "nodes_add_note",
            kind: "additive",
            appVersion: APP_VERSION,
            appliedAt: CLOCK_NOW,
          },
          {
            version: 3,
            name: "nodes_priority_rebuild",
            kind: "rebuild",
            appVersion: APP_VERSION,
            appliedAt: CLOCK_NOW,
          },
        ]);
        expect(conn.prepare("PRAGMA quick_check").all().map((row) => String(row.quick_check))).toEqual(["ok"]);
        expect(conn.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        const columns = conn.prepare("PRAGMA table_info(nodes)").all();
        const nid = columns.find((column) => column.name === "nid");
        expect(String(nid?.type).toUpperCase()).toBe("INTEGER");
        expect(num(nid?.pk)).toBeGreaterThanOrEqual(1);
        expect(columns.map((column) => column.name)).toEqual(
          expect.arrayContaining(["note", "priority"]),
        );
        const req = conn.prepare("SELECT note AS note, priority AS priority FROM nodes WHERE id = 'REQ1'").get();
        expect(req?.note).toBe("kept");
        expect(num(req?.priority)).toBe(1);
        const task = conn.prepare("SELECT note AS note FROM nodes WHERE id = 'TASK7'").get();
        expect(task?.note).toBe("");
        expect(scalar(conn, "SELECT count(*) AS c FROM nodes")).toBe(2);
        expect(scalar(conn, "SELECT count(*) AS c FROM kb_words")).toBe(2);
        expect(scalar(conn, "SELECT count(*) AS c FROM kb_ident")).toBe(2);
        const camel = conn
          .prepare(
            "SELECT n.id AS id FROM kb_words w JOIN nodes n ON n.nid = w.rowid WHERE kb_words MATCH 'parse AND http'",
          )
          .all();
        expect(camel.map((row) => row.id)).toContain("REQ1");
        const ship = conn
          .prepare(
            "SELECT n.id AS id FROM kb_words w JOIN nodes n ON n.nid = w.rowid WHERE kb_words MATCH 'ship AND worker'",
          )
          .all();
        expect(ship.map((row) => row.id)).toContain("TASK7");
        const trigram = conn.prepare("SELECT id FROM kb_ident WHERE id LIKE '%' || ? || '%'").all("REQ1");
        expect(trigram.map((row) => row.id)).toContain("REQ1");
        expect(conn.prepare("SELECT id FROM requirements").all().map((row) => row.id)).toEqual(["REQ1"]);
        expect(() => conn.prepare("SELECT 1 FROM task_requirements LIMIT 1").all()).not.toThrow();
        expect(() => conn.prepare("SELECT 1 FROM check_requirements LIMIT 1").all()).not.toThrow();
        expect(() => conn.prepare("SELECT 1 FROM waivers LIMIT 1").all()).not.toThrow();
        const objects = conn
          .prepare("SELECT name FROM sqlite_master WHERE name IN ('nodes_kind', 'nodes_note', 'nodes_no_delete', 'nodes_ai')")
          .all()
          .map((row) => row.name);
        expect(objects).toEqual(expect.arrayContaining(["nodes_kind", "nodes_note", "nodes_no_delete", "nodes_ai"]));
        const pending = conn.prepare("SELECT value FROM meta WHERE key = ?").get(FTS_PENDING_META_KEY);
        expect(pending).toBeUndefined();
        conn.exec(
          "INSERT INTO nodes(nid, id, kind, version, title, text, fields, status, note, priority) VALUES (3, 'CHK1', 'check', 1, 'OtherCheck', '', '{}', 'active', '', 0)",
        );
        expect(scalar(conn, "SELECT count(*) AS c FROM kb_words")).toBe(3);
        expect(() => conn.exec("DELETE FROM nodes WHERE id = 'CHK1'")).toThrow(/retired/);
        expect(() =>
          conn.exec(
            "INSERT INTO nodes(nid, id, kind, version, title, text, fields, status) VALUES (4, 'BAD2', 'check', 1, '', '', '{}', 'active')",
          ),
        ).toThrow(/CHECK/);
      });

      expect(readProjectStatus(globalPath, "alpha")).toBe("ok");
      expect(readPins(globalPath)).toEqual([
        {
          hash: HASH_A,
          holderKind: "backup",
          holderId: `alpha-backup-${path.basename(backupPath)}`,
          pinnedAt: CLOCK_NOW,
        },
      ]);
      withConnection(globalPath, "global", true, (conn) => {
        expect(readAudit(conn)).toEqual([
          {
            version: 2,
            name: "projects_add_note",
            kind: "additive",
            appVersion: APP_VERSION,
            appliedAt: CLOCK_NOW,
          },
        ]);
        const note = conn.prepare("SELECT count(*) AS c FROM pragma_table_info('projects') WHERE name = 'note'").get();
        expect(num(note?.c)).toBe(1);
      });

      const migratedHash = fileHash(statePath);
      const again = await runner.openProject({ id: "alpha", stateDbPath: statePath });
      expect(again.ok).toBe(true);
      if (!again.ok) return;
      expect(again.applied).toEqual([]);
      expect(again.fromVersion).toBe(3);
      expect(again.toVersion).toBe(3);
      expect(again.backupPath).toBeNull();
      expect(fileHash(statePath)).toBe(migratedHash);
      expect(fs.existsSync(backupPath)).toBe(true);
    });
  });

  it("records a data migration and its invariant check", async () => {
    await withDir(async (dir) => {
      const projectDir = path.join(dir, "alpha");
      const statePath = createStateDb(projectDir, "state.db");
      const globalPath = createGlobalDb(dir, [{ id: "alpha", stateDbPath: statePath, name: "Alpha" }]);
      const runner = new MigrationRunner({
        globalDbPath: globalPath,
        globalDb: connectGlobalBrokerDb(globalPath),
        migrations: [stateData],
        appVersion: APP_VERSION,
        readers: closedReaders,
        clock: fixedClock,
      });
      const outcome = await runner.openProject({ id: "alpha", stateDbPath: statePath });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.toVersion).toBe(2);
      expect(outcome.applied[0]?.kind).toBe("data");
      withConnection(statePath, "state", true, (conn) => {
        expect(readAudit(conn)).toEqual([
          {
            version: 2,
            name: "stamp_project_meta",
            kind: "data",
            appVersion: APP_VERSION,
            appliedAt: CLOCK_NOW,
          },
        ]);
        expect(conn.prepare("SELECT value FROM meta WHERE key = 'project_id'").get()?.value).toBe("stamped");
      });
      expect(readProjectStatus(globalPath, "alpha")).toBe("ok");
    });
  });

  it("migrates a production state database from version 1 to version 2 and leaves global at version 1", async () => {
    await withDir(async (dir) => {
      const projectDir = path.join(dir, "alpha");
      fs.mkdirSync(projectDir, { recursive: true });
      const statePath = path.join(projectDir, "state.db");
      const schema = fs.readFileSync(canonicalAssetAbsolute("stateSql"), "utf8");
      withConnection(statePath, "state", false, (conn) => {
        conn.exec(schema);
        conn.exec("PRAGMA user_version = 1");
        conn
          .prepare(
            "INSERT INTO schema_migrations(version, name, kind, app_version, applied_at) VALUES (1, 'state-schema-v1', 'additive', ?, ?)",
          )
          .run("0.0.0", 1);
      });
      const globalPath = createGlobalDb(dir, [{ id: "alpha", stateDbPath: statePath, name: "Alpha" }]);
      const beforeGlobal = fileHash(globalPath);
      expect(PRODUCTION_SCHEMA_VERSION).toBe(1);
      expect(productionMigrations.map((migration) => `${migration.targetDb}:${migration.version}:${migration.name}`)).toEqual([
        `state:2:${STATE_V2_MIGRATION_NAME}`,
        `code-index:2:${CODE_INDEX_V2_MIGRATION_NAME}`,
      ]);
      const runner = new MigrationRunner({
        globalDbPath: globalPath,
        globalDb: connectGlobalBrokerDb(globalPath),
        migrations: productionMigrations,
        appVersion: APP_VERSION,
        readers: closedReaders,
        clock: fixedClock,
      });
      const startup = await runner.migrateOnStartup();
      expect(startup.toVersion).toBe(1);
      expect(startup.applied).toEqual([]);
      expect(startup.backupPath).toBeNull();
      const opened = await runner.openProject({ id: "alpha", stateDbPath: statePath });
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      expect(opened.toVersion).toBe(2);
      expect(opened.applied.map((row) => row.name)).toEqual([STATE_V2_MIGRATION_NAME]);
      expect(opened.backupPath).not.toBeNull();
      expect(userVersion(statePath, "state")).toBe(2);
      withConnection(statePath, "state", true, (conn) => {
        expect(
          scalar(conn, "SELECT count(*) AS c FROM edge_types WHERE type IN ('expands', 'contradicts', 'informs')"),
        ).toBe(3);
        for (const table of ["canvas_layout", "investigations", "sweep_symbol_maps", "stop_events"]) {
          expect(scalar(conn, `SELECT count(*) AS c FROM sqlite_master WHERE type = 'table' AND name = '${table}'`)).toBe(1);
        }
      });
      expect(fileHash(globalPath)).toBe(beforeGlobal);
      expect(readProjectStatus(globalPath, "alpha")).toBe("ok");
    });
  });
});
