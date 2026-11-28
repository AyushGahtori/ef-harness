import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { ExtractedRef, ExtractedSymbol, FileRankRow } from "./types.js";

function schemaSql(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.resolve(here, "../../../../schema/code-index.sql");
  return fs.readFileSync(schemaPath, "utf8");
}

export interface StoredFileRow {
  readonly path: string;
  readonly fileHash: string;
}

export class CodeIndexDatabase {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    let bootstrap = !fs.existsSync(dbPath);
    if (fs.existsSync(dbPath)) {
      let corrupt = false;
      try {
        const probe = new DatabaseSync(dbPath);
        try {
          corrupt = !this.quickCheck(probe);
        } finally {
          probe.close();
        }
      } catch {
        corrupt = true;
      }
      if (corrupt) {
        try {
          fs.rmSync(dbPath, { force: true });
        } catch {
          // Fall through: SQLite may still open/truncate a bad file on Windows.
        }
        bootstrap = !fs.existsSync(dbPath);
      }
    }
    try {
      this.db = new DatabaseSync(dbPath);
    } catch {
      try {
        fs.rmSync(dbPath, { force: true });
      } catch {
        // ignore
      }
      this.db = new DatabaseSync(dbPath);
      bootstrap = true;
    }
    if (bootstrap) {
      this.db.exec(schemaSql());
    }
  }

  close(): void {
    this.db.close();
  }

  quickCheck(db: DatabaseSync = this.db): boolean {
    const row = db.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
    return row?.quick_check === "ok";
  }

  wipeAndRebuild(): void {
    const tables = ["file_rank", "refs", "symbols", "commit_files", "indexed_commits"];
    for (const table of tables) {
      this.db.exec(`DELETE FROM ${table}`);
    }
  }

  beginCommit(commitSha: string): void {
    this.db
      .prepare(
        `INSERT INTO indexed_commits (commit_sha, built_at, files)
         VALUES (?, ?, 0)
         ON CONFLICT(commit_sha) DO UPDATE SET built_at = excluded.built_at`,
      )
      .run(commitSha, Date.now());
  }

  finishCommit(commitSha: string, files: number): void {
    this.db
      .prepare(`UPDATE indexed_commits SET files = ? WHERE commit_sha = ?`)
      .run(files, commitSha);
  }

  getStoredHash(commitSha: string, filePath: string): string | null {
    const row = this.db
      .prepare(`SELECT file_hash FROM commit_files WHERE commit_sha = ? AND path = ?`)
      .get(commitSha, filePath) as { file_hash?: string } | undefined;
    return row?.file_hash ?? null;
  }

  upsertFile(
    commitSha: string,
    filePath: string,
    fileHash: string,
    symbols: readonly ExtractedSymbol[],
    refs: readonly ExtractedRef[],
  ): void {
    this.db
      .prepare(
        `INSERT INTO commit_files (commit_sha, path, file_hash)
         VALUES (?, ?, ?)
         ON CONFLICT(commit_sha, path) DO UPDATE SET file_hash = excluded.file_hash`,
      )
      .run(commitSha, filePath, fileHash);

    this.db.prepare(`DELETE FROM symbols WHERE file_hash = ?`).run(fileHash);
    this.db.prepare(`DELETE FROM refs WHERE file_hash = ?`).run(fileHash);

    const insertSymbol = this.db.prepare(
      `INSERT INTO symbols (file_hash, name, kind, line, signature, exported)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const symbol of symbols) {
      insertSymbol.run(
        fileHash,
        symbol.name,
        symbol.kind,
        symbol.line,
        symbol.signature ?? null,
        symbol.exported ? 1 : 0,
      );
    }

    const insertRef = this.db.prepare(
      `INSERT INTO refs (file_hash, name, line) VALUES (?, ?, ?)`,
    );
    for (const ref of refs) {
      insertRef.run(fileHash, ref.name, ref.line);
    }
  }

  listIndexedPaths(commitSha: string): string[] {
    return (
      this.db
        .prepare(`SELECT path FROM commit_files WHERE commit_sha = ?`)
        .all(commitSha) as Array<{ path: string }>
    ).map((r) => r.path);
  }

  listCommitFiles(commitSha: string): StoredFileRow[] {
    return (
      this.db
        .prepare(`SELECT path, file_hash FROM commit_files WHERE commit_sha = ?`)
        .all(commitSha) as unknown as Array<{ path: string; file_hash: string }>
    ).map((row) => ({ path: row.path, fileHash: row.file_hash }));
  }

  replaceFileRanks(commitSha: string, ranks: readonly FileRankRow[]): void {
    this.db.prepare(`DELETE FROM file_rank WHERE commit_sha = ?`).run(commitSha);
    const insert = this.db.prepare(
      `INSERT INTO file_rank (commit_sha, path, score) VALUES (?, ?, ?)`,
    );
    for (const rank of ranks) {
      insert.run(commitSha, rank.path, rank.score);
    }
  }

  readFileRanks(commitSha: string): FileRankRow[] {
    return (
      this.db
        .prepare(`SELECT path, score FROM file_rank WHERE commit_sha = ? ORDER BY score DESC`)
        .all(commitSha) as unknown as Array<{ path: string; score: number }>
    ).map((row) => ({ path: row.path, score: row.score }));
  }

  symbolsForFile(fileHash: string): ExtractedSymbol[] {
    return (
      this.db
        .prepare(
          `SELECT name, kind, line, signature, exported FROM symbols WHERE file_hash = ? ORDER BY line`,
        )
        .all(fileHash) as Array<{
        name: string;
        kind: string;
        line: number;
        signature: string | null;
        exported: number;
      }>
    ).map((row) => {
      const base = {
        name: row.name,
        kind: row.kind as ExtractedSymbol["kind"],
        line: row.line,
        exported: row.exported === 1,
      };
      return row.signature ? { ...base, signature: row.signature } : base;
    });
  }

  findRefsByName(name: string): Array<{ fileHash: string; line: number }> {
    return this.db
      .prepare(`SELECT file_hash AS fileHash, line FROM refs WHERE name = ?`)
      .all(name) as Array<{ fileHash: string; line: number }>;
  }

  listReferenceEdges(commitSha: string): Array<{ from: string; to: string; weight: number }> {
    const files = this.listCommitFiles(commitSha);
    const owners = new Map<string, string>();
    for (const file of files) {
      for (const symbol of this.symbolsForFile(file.fileHash)) {
        if (!owners.has(symbol.name)) owners.set(symbol.name, file.path);
      }
    }
    const edges: Array<{ from: string; to: string; weight: number }> = [];
    for (const file of files) {
      for (const ref of this.refsForFile(file.fileHash)) {
        if (ref.name.startsWith("import:")) {
          edges.push({ from: file.path, to: ref.name.slice("import:".length), weight: 1 });
          continue;
        }
        const owner = owners.get(ref.name);
        if (owner && owner !== file.path) edges.push({ from: file.path, to: owner, weight: 1 });
      }
    }
    return edges;
  }

  refsForFile(fileHash: string): Array<{ name: string; line: number }> {
    return this.db
      .prepare(`SELECT name, line FROM refs WHERE file_hash = ?`)
      .all(fileHash) as Array<{ name: string; line: number }>;
  }
}