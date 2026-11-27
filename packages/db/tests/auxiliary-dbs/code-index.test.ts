import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";
import {
  CodeIndexDb,
  InvalidCodeIndexEntryError,
  loadCanonicalSchema,
  schemaTableNames,
} from "../../src/auxiliary-dbs/index.js";
import { useTempDirs } from "./lifecycle.js";

const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

describe("code index database", () => {
  const dirs = useTempDirs();

  function open(name: string): CodeIndexDb {
    const db = CodeIndexDb.open({ filePath: path.join(dirs.root(name), "code-index.db") });
    dirs.close(() => db.close());
    return db;
  }

  it("bootstraps code-index.db from the canonical schema", () => {
    const canonical = fs.readFileSync(canonicalAssetAbsolute("codeIndexSql"), "utf8");
    expect(loadCanonicalSchema("codeIndex")).toBe(canonical);
    const db = open("code-index-bootstrap");
    expect(db.schemaTables()).toEqual(
      [...schemaTableNames(canonical), "module_cards", "schema_migrations"].sort(),
    );
    expect(db.writer.get("PRAGMA user_version")).toMatchObject({ user_version: 2 });
    expect(db.attachedDatabaseNames()).toEqual(["main"]);
    db.verifyIsolatedConnection();
  });

  it("shares symbols and refs for an unchanged file hash across commits", () => {
    const db = open("code-index-share");
    db.upsertCommit({ commitSha: COMMIT_A, builtAt: 10, files: 1 });
    db.upsertCommit({ commitSha: COMMIT_B, builtAt: 20, files: 1 });
    db.linkFile({ commitSha: COMMIT_A, path: "src/app.ts", fileHash: "hash-1" });
    db.linkFile({ commitSha: COMMIT_B, path: "src/app.ts", fileHash: "hash-1" });
    db.putSymbols("hash-1", [
      { name: "App", kind: "function", line: 4, exported: true, signature: "function App(): void" },
      { name: "App", kind: "function", line: 20, exported: false },
    ]);
    db.putRefs("hash-1", [{ name: "App", line: 30 }]);
    db.putFileRank({ commitSha: COMMIT_A, path: "src/app.ts", score: 0.75 });
    db.putFileRank({ commitSha: COMMIT_B, path: "src/App.ts", score: 0.25 });

    expect(db.symbolCount()).toBe(2);
    expect(db.symbolsForFile("hash-1").map((symbol) => symbol.line)).toEqual([4, 20]);
    expect(db.symbolsForCommit(COMMIT_A)).toEqual(db.symbolsForCommit(COMMIT_B));
    expect(db.symbolsForCommit(COMMIT_A)[0]).toMatchObject({
      path: "src/app.ts",
      name: "App",
      exported: true,
      signature: "function App(): void",
    });
    expect(db.refsForName("App")).toEqual([{ fileHash: "hash-1", name: "App", line: 30 }]);
    expect(db.rankingForCommit(COMMIT_A)).toEqual([
      { commitSha: COMMIT_A, path: "src/app.ts", score: 0.75 },
    ]);

    db.linkFile({ commitSha: COMMIT_B, path: "src/app.ts", fileHash: "hash-2" });
    expect(db.symbolsForCommit(COMMIT_B)).toEqual([]);
    expect(db.symbolsForCommit(COMMIT_A)).toHaveLength(2);
    expect(db.filesForCommit(COMMIT_A)).toEqual([
      { commitSha: COMMIT_A, path: "src/app.ts", fileHash: "hash-1" },
    ]);
    expect(() => db.linkFile({ commitSha: "missing", path: "src/app.ts", fileHash: "hash-1" })).toThrow(
      InvalidCodeIndexEntryError,
    );
    expect(() => db.putSymbols("hash-3", [{ name: "Nope", kind: "method" as "function", line: 1, exported: false }])).toThrow(
      InvalidCodeIndexEntryError,
    );
  });
});
