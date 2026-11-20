import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bytesNeededForVacuum, renameWithRetry, restoreVacuumBackup, vacuumInto } from "../../src/migrations/backup.js";
import { openNodeSqliteConnection } from "../../src/migrations/connection.js";
import {
  ForeignKeyIntegrityError,
  SchemaInvariantError,
  ViewInvariantError,
} from "../../src/migrations/errors.js";
import { runTwelveStepRebuild } from "../../src/migrations/rebuild.js";
import { createStateDb, fileHash, priorityRebuildPlan, scalar, stateAdditive, withDir } from "./fixture.js";

function coded(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

describe("12-step rebuild and backup restore", () => {
  it("repopulates search indexes and leaves foreign keys enabled", async () => {
    await withDir(async (dir) => {
      const dbPath = path.join(dir, "state.db");
      createStateDb(dir, "state.db");
      const conn = openNodeSqliteConnection(dbPath, { readOnly: false, targetDb: "state" });
      try {
        stateAdditive.apply(conn);
        runTwelveStepRebuild(conn, priorityRebuildPlan());
        const fk = conn.prepare("PRAGMA foreign_keys").get();
        expect(Number(fk?.foreign_keys)).toBe(1);
        expect(scalar(conn, "SELECT count(*) AS c FROM nodes")).toBe(2);
        expect(scalar(conn, "SELECT count(*) AS c FROM kb_words")).toBe(2);
        expect(scalar(conn, "SELECT count(*) AS c FROM kb_ident")).toBe(2);
        expect(conn.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        expect(conn.prepare("SELECT id FROM requirements").all().map((row) => row.id)).toEqual(["REQ1"]);
        expect(() => conn.exec("DELETE FROM nodes WHERE id = 'REQ1'")).toThrow(/retired/);
        const index = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'nodes_kind'").get();
        expect(index?.name).toBe("nodes_kind");
      } finally {
        conn.close();
      }
    });
  });

  it("rolls a crashed rebuild back and turns foreign keys on again", async () => {
    await withDir(async (dir) => {
      const dbPath = path.join(dir, "state.db");
      const backupPath = path.join(dir, "pre-migration-v1-to-v2-1.db");
      createStateDb(dir, "state.db");
      const source = openNodeSqliteConnection(dbPath, { readOnly: false, targetDb: "state" });
      try {
        vacuumInto(source, backupPath, "state");
      } finally {
        source.close();
      }
      const backupHash = fileHash(backupPath);
      const conn = openNodeSqliteConnection(dbPath, { readOnly: false, targetDb: "state" });
      try {
        stateAdditive.apply(conn);
        expect(() =>
          runTwelveStepRebuild(
            conn,
            priorityRebuildPlan({
              beforeCommit() {
                throw new Error("crash midway");
              },
            }),
          ),
        ).toThrow(/crash midway/);
        expect(Number(conn.prepare("PRAGMA foreign_keys").get()?.foreign_keys)).toBe(1);
        const columns = conn.prepare("PRAGMA table_info(nodes)").all().map((row) => row.name);
        expect(columns).toContain("note");
        expect(columns).not.toContain("priority");
        expect(conn.prepare("SELECT id FROM requirements").all().map((row) => row.id)).toEqual(["REQ1"]);
      } finally {
        conn.close();
      }
      expect(fileHash(backupPath)).toBe(backupHash);
    });
  });

  it("turns foreign keys back on when foreign_key_check or a forgotten view aborts", async () => {
    await withDir(async (dir) => {
      const dbPath = path.join(dir, "state.db");
      createStateDb(dir, "state.db");
      const conn = openNodeSqliteConnection(dbPath, { readOnly: false, targetDb: "state" });
      try {
        stateAdditive.apply(conn);
        expect(() => runTwelveStepRebuild(conn, priorityRebuildPlan({ corruptForeignKey: true }))).toThrow(
          ForeignKeyIntegrityError,
        );
        expect(Number(conn.prepare("PRAGMA foreign_keys").get()?.foreign_keys)).toBe(1);
        expect(conn.prepare("SELECT id FROM nodes WHERE id = 'BAD1'").get()).toBeUndefined();
        expect(() =>
          runTwelveStepRebuild(conn, priorityRebuildPlan({ omitDependentObjects: ["requirements"] })),
        ).toThrow(ViewInvariantError);
        expect(Number(conn.prepare("PRAGMA foreign_keys").get()?.foreign_keys)).toBe(1);
        expect(conn.prepare("SELECT id FROM requirements").all().map((row) => row.id)).toEqual(["REQ1"]);
        expect(() => runTwelveStepRebuild(conn, priorityRebuildPlan({ integerPrimaryKey: false }))).toThrow(
          SchemaInvariantError,
        );
        expect(Number(conn.prepare("PRAGMA foreign_keys").get()?.foreign_keys)).toBe(1);
        const nid = conn.prepare("PRAGMA table_info(nodes)").all().find((row) => row.name === "nid");
        expect(String(nid?.type).toUpperCase()).toBe("INTEGER");
      } finally {
        conn.close();
      }
    });
  });

  it("reports vacuum size from used pages and retries locked renames", async () => {
    expect(bytesNeededForVacuum(10, 3, 4096)).toBe(7 * 4096);
    expect(bytesNeededForVacuum(0, 0, 0)).toBe(4096);
    const waits: number[] = [];
    let attempts = 0;
    await renameWithRetry("source", "dest", {
      rename() {
        attempts += 1;
        if (attempts < 4) throw coded("EPERM");
      },
      sleep(ms) {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    expect(waits).toEqual([50, 100, 200]);
    for (const code of ["EPERM", "EBUSY", "EACCES"] as const) {
      const slept: number[] = [];
      await expect(
        renameWithRetry("source", "dest", {
          rename() {
            throw coded(code);
          },
          sleep(ms) {
            slept.push(ms);
            return Promise.resolve();
          },
        }),
      ).rejects.toMatchObject({ code });
      expect(slept).toEqual([50, 100, 200, 400, 800, 1000, 1000, 1000, 1000]);
    }
    let immediate = 0;
    await expect(
      renameWithRetry("source", "dest", {
        rename() {
          throw coded("ENOENT");
        },
        sleep() {
          immediate += 1;
          return Promise.resolve();
        },
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(immediate).toBe(0);
  });

  it("deletes wal and shm sidecars and restores the vacuum backup bit-for-bit", async () => {
    await withDir(async (dir) => {
      const livePath = path.join(dir, "state.db");
      const backupPath = path.join(dir, "backup.db");
      createStateDb(dir, "state.db");
      const conn = openNodeSqliteConnection(livePath, { readOnly: false, targetDb: "state" });
      try {
        vacuumInto(conn, backupPath, "state");
        conn.exec("UPDATE meta SET value = 'changed' WHERE key = 'project_id'");
      } finally {
        conn.close();
      }
      fs.writeFileSync(`${livePath}-wal`, "locked-by-scanner");
      fs.writeFileSync(`${livePath}-shm`, "locked-by-scanner");
      await restoreVacuumBackup(livePath, backupPath);
      expect(fs.readFileSync(livePath).equals(fs.readFileSync(backupPath))).toBe(true);
      expect(fs.existsSync(`${livePath}-wal`)).toBe(false);
      expect(fs.existsSync(`${livePath}-shm`)).toBe(false);
      const check = openNodeSqliteConnection(livePath, { readOnly: true, targetDb: "state" });
      try {
        expect(check.prepare("SELECT value FROM meta WHERE key = 'project_id'").get()?.value).toBe("fixture");
      } finally {
        check.close();
      }
    });
  });
});
