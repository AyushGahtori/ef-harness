import path from "node:path";
import {
  lookupNamedQuery,
  ReaderPool,
  type DbHandle,
  type SqliteConnection as DriverSqliteConnection,
} from "../driver/index.js";
import { upgradeDatabaseOnOpen } from "../migrations/open-upgrade.js";
import { AuxiliaryDbError, InvalidCodeIndexEntryError } from "./errors.js";
import { createStderrAuxiliaryLogger } from "./logger.js";
import {
  assertNonEmpty,
  assertSafeInteger,
  optionalText,
  requiredFlag,
  requiredInt,
  requiredReal,
  requiredText,
} from "./rows.js";
import { openResilientDatabase } from "./resilient-open.js";
import {
  assertConnectionIsolated,
  isSqliteConstraint,
  isSqliteCorruption,
  type SqliteConnection,
} from "./sqlite-connection.js";
import {
  SYMBOL_KINDS,
  type AuxiliaryLogger,
  type CodeRef,
  type CodeRefInput,
  type CodeSymbol,
  type CodeSymbolInput,
  type CommitFile,
  type FileRank,
  type IndexedCommit,
  type SymbolKind,
} from "./types.js";

export interface OpenCodeIndexDbOptions {
  readonly filePath: string;
  readonly logger?: AuxiliaryLogger;
}

export interface CommitSymbol extends CodeSymbol {
  readonly path: string;
}

export class CodeIndexDb implements DbHandle {
  private closed = false;
  private readersPool: ReaderPool | undefined;

  private constructor(
    private readonly conn: SqliteConnection,
    readonly filePath: string,
  ) {}

  static open(options: OpenCodeIndexDbOptions): CodeIndexDb {
    const logger = options.logger ?? createStderrAuxiliaryLogger();
    const resilient = {
      filePath: options.filePath,
      profile: "code-index" as const,
      schema: "codeIndex" as const,
      requiredTable: "indexed_commits",
      logger,
      rebuildCode: "code_index_db_rebuilt",
      rebuildMessage:
        "code-index.db was corrupt and was recreated. The index is rebuildable and is excluded from backups.",
    };
    const prepared = openResilientDatabase(resilient);
    prepared.close();
    upgradeDatabaseOnOpen({
      dbPath: options.filePath,
      targetDb: "code-index",
      appVersion: "0.0.0",
      backupsDir: path.join(path.dirname(options.filePath), "backups"),
    });
    const conn = openResilientDatabase(resilient);
    return new CodeIndexDb(conn, options.filePath);
  }

  get writer(): DriverSqliteConnection {
    this.assertOpen();
    return this.conn.driver;
  }

  get readers(): ReaderPool {
    this.assertOpen();
    if (this.readersPool === undefined) {
      this.readersPool = new ReaderPool({
        location: this.filePath,
        role: "code-index",
        size: 2,
        lazy: true,
      });
    }
    return this.readersPool;
  }

  query(name: string): string {
    this.assertOpen();
    return lookupNamedQuery(name);
  }

  upsertCommit(input: IndexedCommit): void {
    const commitSha = assertNonEmpty(input.commitSha, "commitSha");
    const builtAt = assertSafeInteger(input.builtAt, "builtAt");
    const files = assertSafeInteger(input.files, "files");
    if (files < 0) throw new InvalidCodeIndexEntryError("commit file count cannot be negative");
    this.write(() => {
      this.conn.run(
        `INSERT INTO indexed_commits(commit_sha, built_at, files) VALUES (?, ?, ?)
         ON CONFLICT(commit_sha) DO UPDATE SET built_at = excluded.built_at, files = excluded.files`,
        commitSha,
        builtAt,
        files,
      );
    });
  }

  linkFile(input: CommitFile): void {
    const commitSha = assertNonEmpty(input.commitSha, "commitSha");
    const filePath = assertNonEmpty(input.path, "path");
    const fileHash = assertNonEmpty(input.fileHash, "fileHash");
    this.write(() => {
      if (this.conn.get("SELECT 1 AS ok FROM indexed_commits WHERE commit_sha = ?", commitSha) === undefined) {
        throw new InvalidCodeIndexEntryError(`commit ${commitSha} is not indexed`);
      }
      this.conn.run(
        `INSERT INTO commit_files(commit_sha, path, file_hash) VALUES (?, ?, ?)
         ON CONFLICT(commit_sha, path) DO UPDATE SET file_hash = excluded.file_hash`,
        commitSha,
        filePath,
        fileHash,
      );
    });
  }

  putSymbols(fileHash: string, symbols: readonly CodeSymbolInput[]): void {
    const hash = assertNonEmpty(fileHash, "fileHash");
    const rows = symbols.map((symbol) => normalizeSymbol(hash, symbol));
    this.write(() => {
      this.conn.run("DELETE FROM symbols WHERE file_hash = ?", hash);
      const statement = this.conn.prepare(
        `INSERT INTO symbols(file_hash, name, kind, line, signature, exported)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      try {
        for (const row of rows) {
          statement.run(row.fileHash, row.name, row.kind, row.line, row.signature, row.exported ? 1 : 0);
        }
      } finally {
        statement.finalize?.();
      }
    });
  }

  putRefs(fileHash: string, refs: readonly CodeRefInput[]): void {
    const hash = assertNonEmpty(fileHash, "fileHash");
    const rows = refs.map((ref) => ({
      fileHash: hash,
      name: assertNonEmpty(ref.name, "ref name"),
      line: positiveLine(ref.line),
    }));
    this.write(() => {
      this.conn.run("DELETE FROM refs WHERE file_hash = ?", hash);
      const statement = this.conn.prepare(
        "INSERT INTO refs(file_hash, name, line) VALUES (?, ?, ?)",
      );
      try {
        for (const row of rows) statement.run(row.fileHash, row.name, row.line);
      } finally {
        statement.finalize?.();
      }
    });
  }

  putFileRank(input: FileRank): void {
    const commitSha = assertNonEmpty(input.commitSha, "commitSha");
    const filePath = assertNonEmpty(input.path, "path");
    if (typeof input.score !== "number" || !Number.isFinite(input.score)) {
      throw new InvalidCodeIndexEntryError("file rank score must be finite");
    }
    this.write(() => {
      try {
        this.conn.run(
          `INSERT INTO file_rank(commit_sha, path, score) VALUES (?, ?, ?)
           ON CONFLICT(commit_sha, path) DO UPDATE SET score = excluded.score`,
          commitSha,
          filePath,
          input.score,
        );
      } catch (error) {
        if (isSqliteConstraint(error)) {
          throw new InvalidCodeIndexEntryError(`commit ${commitSha} cannot store file rank`);
        }
        throw error;
      }
    });
  }

  symbolsForFile(fileHash: string): readonly CodeSymbol[] {
    this.assertOpen();
    return this.conn
      .all(
        `SELECT file_hash, name, kind, line, signature, exported
         FROM symbols
         WHERE file_hash = ?
         ORDER BY line, name`,
        fileHash,
      )
      .map((row) => mapSymbol(row));
  }

  symbolsForCommit(commitSha: string): readonly CommitSymbol[] {
    this.assertOpen();
    return this.conn
      .all(
        `SELECT f.path AS path, s.file_hash, s.name, s.kind, s.line, s.signature, s.exported
         FROM commit_files f
         JOIN symbols s ON s.file_hash = f.file_hash
         WHERE f.commit_sha = ?
         ORDER BY f.path, s.line, s.name`,
        commitSha,
      )
      .map((row) => ({ ...mapSymbol(row), path: requiredText(row, "path") }));
  }

  refsForName(name: string): readonly CodeRef[] {
    this.assertOpen();
    return this.conn
      .all(
        `SELECT file_hash, name, line
         FROM refs
         WHERE name = ?
         ORDER BY file_hash, line`,
        name,
      )
      .map((row) => ({
        fileHash: requiredText(row, "file_hash"),
        name: requiredText(row, "name"),
        line: requiredInt(row, "line"),
      }));
  }

  rankingForCommit(commitSha: string): readonly FileRank[] {
    this.assertOpen();
    return this.conn
      .all(
        `SELECT commit_sha, path, score
         FROM file_rank
         WHERE commit_sha = ?
         ORDER BY score DESC, path ASC`,
        commitSha,
      )
      .map((row) => ({
        commitSha: requiredText(row, "commit_sha"),
        path: requiredText(row, "path"),
        score: requiredReal(row, "score"),
      }));
  }

  filesForCommit(commitSha: string): readonly CommitFile[] {
    this.assertOpen();
    return this.conn
      .all(
        `SELECT commit_sha, path, file_hash
         FROM commit_files
         WHERE commit_sha = ?
         ORDER BY path`,
        commitSha,
      )
      .map((row) => ({
        commitSha: requiredText(row, "commit_sha"),
        path: requiredText(row, "path"),
        fileHash: requiredText(row, "file_hash"),
      }));
  }

  symbolCount(): number {
    this.assertOpen();
    const row = this.conn.get("SELECT COUNT(*) AS c FROM symbols");
    return row === undefined ? 0 : requiredInt(row, "c");
  }

  schemaTables(): readonly string[] {
    this.assertOpen();
    return this.conn
      .all(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .map((row) => requiredText(row, "name"));
  }

  attachedDatabaseNames(): readonly string[] {
    this.assertOpen();
    return this.conn.databaseNames().filter((name) => name !== "temp");
  }

  verifyIsolatedConnection(): void {
    this.assertOpen();
    assertConnectionIsolated(this.conn);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const readers = this.readersPool;
    this.readersPool = undefined;
    if (readers) void readers.close();
    try {
      this.conn.close({ skipCheckpoint: this.conn.inTransaction() });
    } catch (error) {
      if (!isSqliteCorruption(error)) throw error;
    }
  }

  private write<T>(fn: () => T): T {
    this.assertOpen();
    if (this.conn.inTransaction()) return fn();
    return this.conn.runImmediate(fn);
  }

  private assertOpen(): void {
    if (this.closed) throw new AuxiliaryDbError("CODE_INDEX_CLOSED", "code index is closed");
  }
}

function normalizeSymbol(fileHash: string, input: CodeSymbolInput): CodeSymbol {
  assertSymbolKind(input.kind);
  return {
    fileHash,
    name: assertNonEmpty(input.name, "symbol name"),
    kind: input.kind,
    line: positiveLine(input.line),
    signature: input.signature ?? null,
    exported: input.exported,
  };
}

function positiveLine(line: number): number {
  assertSafeInteger(line, "line");
  if (line < 1) throw new InvalidCodeIndexEntryError("line must be positive");
  return line;
}

function assertSymbolKind(kind: string): asserts kind is SymbolKind {
  if (!(SYMBOL_KINDS as readonly string[]).includes(kind)) {
    throw new InvalidCodeIndexEntryError(`unknown symbol kind ${kind}`);
  }
}

function mapSymbol(row: Parameters<typeof requiredText>[0]): CodeSymbol {
  const kind = requiredText(row, "kind");
  assertSymbolKind(kind);
  return {
    fileHash: requiredText(row, "file_hash"),
    name: requiredText(row, "name"),
    kind,
    line: requiredInt(row, "line"),
    signature: optionalText(row, "signature"),
    exported: requiredFlag(row, "exported"),
  };
}
