import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateSchemaInvariants } from "../../src/recovery/invariants.js";
import { salvageCorruptDatabase } from "../../src/recovery/salvage.js";
import { openDatabase, registerSearchText } from "../../src/recovery/sqlite-io.js";
import {
  makeProject,
  makeTempRoot,
  readMetaValue,
  removeTempRoot,
  setMeta,
  withState,
  type ProjectFixture,
} from "./fixture.js";

const roots: string[] = [];

function fixture(): ProjectFixture {
  const root = makeTempRoot();
  roots.push(root);
  return makeProject(root);
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) removeTempRoot(root);
  }
});

describe("salvage invariant gate", { timeout: 180_000 }, () => {
  it("accepts a readable database only when every schema invariant passes", () => {
    const project = fixture();
    setMeta(project.stateDbPath, "last_rev", "6");
    withState(project.stateDbPath, (db) => {
      db.prepare(
        `INSERT INTO change_sets(id, rev, origin, author, created_at)
         VALUES ('cs-1', 6, 'kernel', 'test', 6)`,
      ).run();
      db.prepare(
        `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
         VALUES ('R1', 'rule', 1, 'hash-r1', 'Cutoff', '', '{}', 'cs-1', 6, 6)`,
      ).run();
    });
    const output = path.join(project.projectDir, "salvage.db");
    const result = salvageCorruptDatabase(project.stateDbPath, output);
    expect(result.accepted).toBe(true);
    expect(result.failures).toEqual([]);
    expect(readMetaValue(output, "last_rev")).toBe("6");
    const db = openDatabase(output, true);
    try {
      expect(evaluateSchemaInvariants(db).ok).toBe(true);
      expect(db.prepare("SELECT title FROM nodes WHERE id = 'R1'").get()).toEqual({ title: "Cutoff" });
    } finally {
      db.close();
    }
  });

  it("rejects a database that passes quick_check but fails relations, foreign keys, or version history", () => {
    const relations = fixture();
    withState(relations.stateDbPath, (db) => {
      db.prepare(
        `INSERT INTO change_sets(id, rev, origin, author, created_at)
         VALUES ('cs-bad', 1, 'kernel', 'test', 1)`,
      ).run();
      db.prepare(
        `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
         VALUES ('T80', 'task', 1, 'hash-t80', 'Bad task', '', '{"depends_on":["T03"]}', 'cs-bad', 1, 1)`,
      ).run();
    });
    const relationsResult = salvageCorruptDatabase(
      relations.stateDbPath,
      path.join(relations.projectDir, "salvage.db"),
    );
    expect(relationsResult.accepted).toBe(false);
    expect(relationsResult.failures.some((failure) => failure.name === "relations_in_fields")).toBe(
      true,
    );

    const foreign = fixture();
    withState(foreign.stateDbPath, (db) => {
      db.exec("PRAGMA foreign_keys = OFF");
      db.prepare(
        `INSERT INTO artifact_refs(artifact, owner_kind, owner_id) VALUES ('missing-art', 'task', 'T1')`,
      ).run();
    });
    const foreignResult = salvageCorruptDatabase(
      foreign.stateDbPath,
      path.join(foreign.projectDir, "salvage.db"),
    );
    expect(foreignResult.accepted).toBe(false);
    expect(foreignResult.failures.some((failure) => failure.name === "foreign_keys")).toBe(true);

    const versions = fixture();
    withState(versions.stateDbPath, (db) => {
      registerSearchText(db);
      db.prepare(
        `INSERT INTO change_sets(id, rev, origin, author, created_at)
         VALUES ('cs-v', 1, 'kernel', 'test', 1)`,
      ).run();
      db.prepare(
        `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
         VALUES ('R9', 'rule', 1, 'hash-r9', 'Versioned', '', '{}', 'cs-v', 1, 1)`,
      ).run();
      db.exec("DROP TRIGGER nodes_version_guard");
      db.exec("DROP TRIGGER nodes_au");
      db.prepare("UPDATE nodes SET version = 5 WHERE id = 'R9'").run();
    });
    const versionResult = salvageCorruptDatabase(
      versions.stateDbPath,
      path.join(versions.projectDir, "salvage.db"),
    );
    expect(versionResult.accepted).toBe(false);
    expect(versionResult.failures.some((failure) => failure.name === "nodes_version_guard")).toBe(
      true,
    );
    expect(fs.existsSync(path.join(versions.projectDir, "salvage.db"))).toBe(false);
  });
});
