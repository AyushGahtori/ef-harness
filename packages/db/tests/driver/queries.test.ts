import { readFileSync } from "node:fs";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  ParameterMismatchError,
  UnknownQueryError,
  loadQueryCatalog,
  openDatabase,
  runImmediateTx,
} from "../../src/driver/index.js";

const opened: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

describe("query catalog", () => {
  it("loads every named query from schema/queries.sql and prepares it on the matching database", () => {
    const state = track(openDatabase({ location: ":memory:", role: "state" }));
    const global = track(openDatabase({ location: ":memory:", role: "global" }));
    state.exec(readFileSync(canonicalAssetAbsolute("stateSql"), "utf8"));
    global.exec(readFileSync(canonicalAssetAbsolute("globalSql"), "utf8"));
    const stateCatalog = loadQueryCatalog(state);
    const globalCatalog = loadQueryCatalog(global);
    expect(stateCatalog.names.length).toBeGreaterThanOrEqual(30);
    expect(stateCatalog.names).toEqual(globalCatalog.names);
    const failures: string[] = [];
    for (const name of stateCatalog.names) {
      const sql = stateCatalog.sql(name);
      const target = name.startsWith("global_") ? global : state;
      try {
        const statement = target.prepare(sql);
        statement.finalize();
      } catch (error) {
        failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("rejects missing and extra parameters before SQL execution", () => {
    const db = track(openDatabase({ location: ":memory:", role: "state" }));
    db.exec(readFileSync(canonicalAssetAbsolute("stateSql"), "utf8"));
    const catalog = loadQueryCatalog(db);
    expect(catalog.params("fence_attempts")).toEqual(["now"]);
    expect(() => catalog.run("fence_attempts", {})).toThrow(ParameterMismatchError);
    try {
      catalog.run("fence_attempts", { extra: 1 });
    } catch (error) {
      expect(error).toBeInstanceOf(ParameterMismatchError);
      const mismatch = error as ParameterMismatchError;
      expect(mismatch.queryName).toBe("fence_attempts");
      expect(mismatch.missing).toEqual(["now"]);
      expect(mismatch.extra).toEqual(["extra"]);
    }
    expect(() => catalog.get("missing_query", {})).toThrow(UnknownQueryError);
    expect(catalog.get("fence_attempts", { ":now": 1 })).toBeUndefined();
    expect(() => catalog.run("op_lookup", { op_id: "op-1" })).toThrow(ParameterMismatchError);
  });

  it("loads state.sql through SqliteConnection and runs canonical queries plus ef_search_text", () => {
    const db = track(openDatabase({ location: ":memory:", role: "state" }));
    db.exec(readFileSync(canonicalAssetAbsolute("stateSql"), "utf8"));
    const catalog = loadQueryCatalog(db);
    const allocated = catalog.get("allocate_id", { prefix: "T" }) as { n: number };
    expect(allocated.n).toBe(1);
    const again = catalog.get("allocate_id", { prefix: "T" }) as { n: number };
    expect(again.n).toBe(2);

    runImmediateTx(db, () => {
      db.run(
        "INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES ('CS-1', 1, 'planner', 'test', 0)",
      );
      db.run(
        `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
         VALUES ('T03', 'task', 1, 'h-T03', 'Map totals with toPrintRows', '', '{"feature":"F12"}', 'CS-1', 1, 1)`,
      );
      db.run(
        `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
         VALUES ('R17', 'rule', 1, 'h-R17', 'Cutoff rule', 'Orders close at 10:45 Europe/Berlin', '{"feature":"F12"}', 'CS-1', 1, 1)`,
      );
    });
    const words = db
      .all("SELECT n.id AS id FROM kb_words w JOIN nodes n ON n.nid = w.rowid WHERE kb_words MATCH 'print AND rows'")
      .map((row) => (row as { id: string }).id);
    expect(words).toContain("T03");
    const cutoff = db
      .all("SELECT n.id AS id FROM kb_words w JOIN nodes n ON n.nid = w.rowid WHERE kb_words MATCH 'close AND 10'")
      .map((row) => (row as { id: string }).id);
    expect(cutoff).toContain("R17");
    const asOf = catalog.all("asof_nodes", { rev: 1 }) as Array<{ id: string }>;
    expect(asOf.map((row) => row.id)).toEqual(expect.arrayContaining(["T03", "R17"]));
  });
});

function track<T extends { close: () => void }>(db: T): T {
  opened.push(db);
  return db;
}
