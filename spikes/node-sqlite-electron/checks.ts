import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { partialBackupPath, vacuumInto } from "./backup.ts";
import {
  openBetterSqlite3Driver,
  openNodeSqliteDriver,
  sqlNumber,
  sqlText,
  type SqliteDriver,
  type SqlRow,
} from "./driver.ts";
import { efSearchText } from "./search-text.ts";
import { openNodeBackedBetterSqliteVendor } from "./fallback-vendor.ts";
import {
  canonicalAsset,
  errorMessage,
  makeTempDir,
  readSqliteFailure,
  removeDirectorySync,
  repoRoot,
  runProcess,
  spikeFile,
  sqliteAtLeast,
} from "./runtime.ts";

export const BENCHMARK_SEED = 20261119;
export const SYNTHETIC_ROWS = 12800;
export const SYNTHETIC_BLOB_BYTES = 4096;

export interface CheckResult {
  readonly id: string;
  readonly pass: boolean;
  readonly detail: string;
}

export interface RuntimeNotes {
  readonly sqliteVersion: string | null;
  readonly electronVersion: string | null;
  readonly nodeVersion: string;
  readonly vacuumIntoMs: number | null;
  readonly quickCheckMs: number | null;
  readonly integrityCheckMs: number | null;
  readonly syntheticBytes: number | null;
  readonly chunkedTerminateMs: number | null;
  readonly truncateMs: number | null;
  readonly blockingTerminateMs: number | null;
  readonly nodeDriverMs: number | null;
  readonly fallbackDriverMs: number | null;
  readonly parityEqual: boolean | null;
  readonly nativeAddonCount: number | null;
  readonly contentlessLikeRows: number | null;
  readonly iteratorErrcode: number | null;
  readonly busyErrcode: number | null;
  readonly unsafeInteger: string | null;
  readonly bareNames: string | null;
  readonly sameConnectionDataVersion: string | null;
}

export interface RuntimeReport {
  readonly runtime: "node" | "electron";
  readonly checks: readonly CheckResult[];
  readonly notes: RuntimeNotes;
  readonly passed: boolean;
}

interface NoteDraft {
  sqliteVersion: string | null;
  electronVersion: string | null;
  nodeVersion: string;
  vacuumIntoMs: number | null;
  quickCheckMs: number | null;
  integrityCheckMs: number | null;
  syntheticBytes: number | null;
  chunkedTerminateMs: number | null;
  truncateMs: number | null;
  blockingTerminateMs: number | null;
  nodeDriverMs: number | null;
  fallbackDriverMs: number | null;
  parityEqual: boolean | null;
  nativeAddonCount: number | null;
  contentlessLikeRows: number | null;
  iteratorErrcode: number | null;
  busyErrcode: number | null;
  unsafeInteger: string | null;
  bareNames: string | null;
  sameConnectionDataVersion: string | null;
}

export async function runCurrentRuntime(): Promise<RuntimeReport> {
  const runtime = process.versions.electron ? "electron" : "node";
  const notes: NoteDraft = {
    sqliteVersion: null,
    electronVersion: process.versions.electron ?? null,
    nodeVersion: process.versions.node,
    vacuumIntoMs: null,
    quickCheckMs: null,
    integrityCheckMs: null,
    syntheticBytes: null,
    chunkedTerminateMs: null,
    truncateMs: null,
    blockingTerminateMs: null,
    nodeDriverMs: null,
    fallbackDriverMs: null,
    parityEqual: null,
    nativeAddonCount: null,
    contentlessLikeRows: null,
    iteratorErrcode: null,
    busyErrcode: null,
    unsafeInteger: null,
    bareNames: null,
    sameConnectionDataVersion: null,
  };
  const checks: CheckResult[] = [];
  checks.push(await check("runtime-identity", () => runtimeIdentity(runtime)));
  checks.push(await check("sqlite-version", () => sqliteVersion(notes)));
  checks.push(await check("constructor-options", () => constructorOptions()));
  checks.push(await check("harness-pragmas", () => harnessPragmas()));
  checks.push(await check("sql-features", () => sqlFeatures()));
  checks.push(await check("named-parameter-prefixes", () => namedPrefixes(notes)));
  checks.push(await check("bigint", () => bigintHandling(notes)));
  checks.push(await check("begin-immediate", () => beginImmediate(notes)));
  checks.push(await check("schema-suite-memory", () => schemaSuite("memory")));
  checks.push(await check("schema-suite-wal", () => schemaSuite("wal")));
  checks.push(...(await ftsChecks(notes)));
  checks.push(await check("iterator-checkpoint", () => iteratorCheckpoint(notes)));
  checks.push(...(await syntheticChecks(notes)));
  checks.push(await check("vacuum-into-destination", () => destinationGuard()));
  checks.push(await check("worker-terminate", () => workerTerminate(notes)));
  checks.push(await check("worker-inflight-call", () => workerInflight(notes)));
  checks.push(await check("driver-parity", () => driverParity(notes)));
  checks.push(await check("native-addons", () => nativeAddons(notes)));
  return {
    runtime,
    checks,
    notes,
    passed: checks.every((item) => item.pass),
  };
}

export function notesFromJson(value: { readonly [key: string]: unknown }): RuntimeNotes {
  return {
    sqliteVersion: readString(value, "sqliteVersion"),
    electronVersion: readString(value, "electronVersion"),
    nodeVersion: readString(value, "nodeVersion") ?? process.versions.node,
    vacuumIntoMs: readNumber(value, "vacuumIntoMs"),
    quickCheckMs: readNumber(value, "quickCheckMs"),
    integrityCheckMs: readNumber(value, "integrityCheckMs"),
    syntheticBytes: readNumber(value, "syntheticBytes"),
    chunkedTerminateMs: readNumber(value, "chunkedTerminateMs"),
    truncateMs: readNumber(value, "truncateMs"),
    blockingTerminateMs: readNumber(value, "blockingTerminateMs"),
    nodeDriverMs: readNumber(value, "nodeDriverMs"),
    fallbackDriverMs: readNumber(value, "fallbackDriverMs"),
    parityEqual: readBoolean(value, "parityEqual"),
    nativeAddonCount: readNumber(value, "nativeAddonCount"),
    contentlessLikeRows: readNumber(value, "contentlessLikeRows"),
    iteratorErrcode: readNumber(value, "iteratorErrcode"),
    busyErrcode: readNumber(value, "busyErrcode"),
    unsafeInteger: readString(value, "unsafeInteger"),
    bareNames: readString(value, "bareNames"),
    sameConnectionDataVersion: readString(value, "sameConnectionDataVersion"),
  };
}

async function check(id: string, fn: () => Promise<string> | string): Promise<CheckResult> {
  try {
    return { id, pass: true, detail: await fn() };
  } catch (error) {
    return { id, pass: false, detail: errorMessage(error) };
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function runtimeIdentity(runtime: "node" | "electron"): string {
  const electron = process.versions.electron ?? null;
  if (runtime === "electron") {
    const major = Number((electron ?? "").split(".")[0]);
    assert(electron !== null && Number.isFinite(major) && major >= 42, `Electron ${electron ?? "missing"} is below 42`);
  }
  return `runtime=${runtime} electron=${electron ?? "none"} node=${process.versions.node}`;
}

function sqliteVersion(notes: NoteDraft): string {
  const driver = openNodeSqliteDriver(":memory:");
  try {
    const version = sqlText(driver.prepare("select sqlite_version() as v").get(), "v");
    notes.sqliteVersion = version;
    assert(sqliteAtLeast(version, "3.43.0"), `${version} is below the 3.43 minimum`);
    assert(sqliteAtLeast(version, "3.53.0"), `${version} is below the 3.53 target`);
    return `${version} meets minimum 3.43 and target 3.53`;
  } finally {
    driver.close();
  }
}

function constructorOptions(): string {
  let threw = false;
  try {
    const db = new DatabaseSync(":memory:", undefined);
    db.close();
  } catch (error) {
    threw = error instanceof Error && error.message.includes("options");
  }
  assert(threw, "DatabaseSync accepted an explicit undefined options argument");
  const db = new DatabaseSync(":memory:");
  db.close();
  return "explicit undefined options throw ERR_INVALID_ARG_TYPE; omitting options opens the database";
}

function harnessPragmas(): string {
  const dir = makeTempDir("ef-spike-pragma-");
  try {
    const driver = openNodeSqliteDriver(path.join(dir, "pragma.db"));
    try {
      const expected = new Map<string, string>([
        ["journal_mode", "wal"],
        ["synchronous", "2"],
        ["foreign_keys", "1"],
        ["busy_timeout", "5000"],
        ["secure_delete", "1"],
        ["journal_size_limit", "67108864"],
        ["temp_store", "2"],
      ]);
      const seen: string[] = [];
      for (const [source, want] of expected) {
        const got = onlyCell(driver.pragma(source)[0]).value.toLowerCase();
        assert(got === want, `${source} returned ${got}, expected ${want}`);
        seen.push(`${source}=${got}`);
      }
      const assignment = driver.prepare("PRAGMA synchronous = FULL").all();
      assert(assignment.length === 0, "node:sqlite returned rows for PRAGMA synchronous = FULL");
      return seen.join(" ");
    } finally {
      driver.close();
    }
  } finally {
    removeDirectorySync(dir);
  }
}

function sqlFeatures(): string {
  const dir = makeTempDir("ef-spike-sql-");
  try {
    const driver = openNodeSqliteDriver(path.join(dir, "features.db"));
    try {
      driver.exec("CREATE TABLE strict_demo(n INTEGER) STRICT");
      let strictRejected = false;
      try {
        driver.prepare("INSERT INTO strict_demo(n) VALUES (?)").run(["nope"]);
      } catch (error) {
        strictRejected = error instanceof Error;
      }
      assert(strictRejected, "STRICT table accepted a non-integer");

      driver.exec("CREATE TABLE wr(a INTEGER, b TEXT, PRIMARY KEY(a, b)) STRICT, WITHOUT ROWID");
      const ddl = sqlText(driver.prepare("SELECT sql FROM sqlite_master WHERE name = 'wr'").get(), "sql");
      assert(ddl.includes("WITHOUT ROWID"), "WITHOUT ROWID was not stored");

      driver.exec("CREATE TABLE gen(raw TEXT, doubled TEXT GENERATED ALWAYS AS (raw || raw) VIRTUAL) STRICT");
      driver.prepare("INSERT INTO gen(raw) VALUES (?)").run(["ab"]);
      assert(sqlText(driver.prepare("SELECT doubled FROM gen").get(), "doubled") === "abab", "generated column mismatch");

      driver.exec("CREATE TABLE auto_demo(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");
      const first = sqlNumber(driver.prepare("INSERT INTO auto_demo(name) VALUES (?) RETURNING id").get(["x"]), "id");
      driver.exec("DELETE FROM auto_demo");
      const second = sqlNumber(driver.prepare("INSERT INTO auto_demo(name) VALUES (?) RETURNING id").get(["y"]), "id");
      assert(first === 1 && second === 2, `AUTOINCREMENT returned ${first} then ${second}`);

      const values = driver.prepare("SELECT j.value AS v FROM json_each(?) AS j").all([JSON.stringify([1, 2])]);
      assert(values.length === 2 && sqlNumber(values[0], "v") === 1 && sqlNumber(values[1], "v") === 2, "json_each mismatch");

      driver.exec("CREATE TABLE parent_row(id INTEGER PRIMARY KEY)");
      driver.exec(
        "CREATE TABLE child_row(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent_row(id) DEFERRABLE INITIALLY DEFERRED)",
      );
      const pending = driver.beginImmediate();
      driver.prepare("INSERT INTO child_row(id, parent_id) VALUES (1, 9)").run();
      let deferred = false;
      try {
        pending.commit();
      } catch (error) {
        deferred = error instanceof Error && error.message.includes("FOREIGN KEY");
        pending.rollback();
      }
      assert(deferred, "deferred foreign key was not enforced at commit");
      const ready = driver.beginImmediate();
      driver.prepare("INSERT INTO parent_row(id) VALUES (9)").run();
      driver.prepare("INSERT INTO child_row(id, parent_id) VALUES (1, 9)").run();
      ready.commit();
      return "STRICT WITHOUT ROWID VIRTUAL RETURNING AUTOINCREMENT json_each DEFERRABLE";
    } finally {
      driver.close();
    }
  } finally {
    removeDirectorySync(dir);
  }
}

function namedPrefixes(notes: NoteDraft): string {
  const driver = openNodeSqliteDriver(":memory:");
  try {
    driver.exec("CREATE TABLE named(id INTEGER PRIMARY KEY, name TEXT)");
    driver.prepare("INSERT INTO named(id, name) VALUES (:id, :name)").run({ id: 1, name: "bare" });
    driver.prepare("INSERT INTO named(id, name) VALUES (:id, :name)").run({ ":id": 2, ":name": "prefixed" });
    driver.prepare("INSERT INTO named(id, name) VALUES (@id, @name)").run({ "@id": 3, "@name": "at" });
    driver.prepare("INSERT INTO named(id, name) VALUES ($id, $name)").run({ $id: 4, $name: "dollar" });
    let bareOff = false;
    try {
      driver.prepare("SELECT name FROM named WHERE id = :id", { allowBareNamedParameters: false }).get({ id: 1 });
    } catch (error) {
      bareOff = error instanceof Error && error.message.includes("named parameter");
    }
    const prefixed = sqlText(
      driver.prepare("SELECT name FROM named WHERE id = :id", { allowBareNamedParameters: false }).get({ ":id": 1 }),
      "name",
    );
    assert(bareOff, "bare names were accepted when allowBareNamedParameters was false");
    assert(prefixed === "bare", "prefixed :id did not bind when bare names were disabled");
    let unknown = false;
    try {
      driver.prepare("SELECT :id AS id").get({ id: 1, extra: 2 });
    } catch (error) {
      unknown = error instanceof Error && error.message.includes("named parameter");
    }
    assert(unknown, "unknown named parameters were ignored");
    const queries = bindCanonicalQueries();
    notes.bareNames = "default-accepts-bare-and-prefixed";
    return `prefixes=: @ $ bareDefault=accepted bareOff=rejected unknown=rejected queries=${queries}`;
  } finally {
    driver.close();
  }
}

function bigintHandling(notes: NoteDraft): string {
  const driver = openNodeSqliteDriver(":memory:");
  try {
    driver.exec("CREATE TABLE wide(n INTEGER)");
    const big = 9007199254740993n;
    driver.prepare("INSERT INTO wide(n) VALUES (?)").run([big]);
    let threw = false;
    try {
      driver.prepare("SELECT n FROM wide").get();
    } catch (error) {
      threw = error instanceof Error && error.message.includes("too large");
    }
    const row = driver.prepare("SELECT n FROM wide", { readBigInts: true }).get();
    assert(threw, "default read accepted an integer above MAX_SAFE_INTEGER");
    assert(row?.n === big, "readBigInts did not return the original integer");
    notes.unsafeInteger = "throws-unless-readBigInts";
    return "default read throws; readBigInts returns bigint";
  } finally {
    driver.close();
  }
}

function beginImmediate(notes: NoteDraft): string {
  const dir = makeTempDir("ef-spike-begin-");
  try {
    const file = path.join(dir, "begin.db");
    const writer = openNodeSqliteDriver(file);
    try {
      let deferredRejected = false;
      try {
        writer.exec("BEGIN");
      } catch (error) {
        deferredRejected = error instanceof Error && error.message.includes("beginImmediate");
      }
      let exclusiveRejected = false;
      try {
        writer.exec("BEGIN DEFERRED");
      } catch (error) {
        exclusiveRejected = error instanceof Error && error.message.includes("beginImmediate");
      }
      assert(deferredRejected && exclusiveRejected, "driver accepted a deferred begin");
      writer.exec("CREATE TABLE t(n INTEGER)");
      const held = writer.beginImmediate();
      writer.prepare("INSERT INTO t(n) VALUES (1)").run();
      const other = openNodeSqliteDriver(file, { busyTimeoutMs: 100, applyHarnessPragmas: false });
      let busy = 0;
      try {
        other.beginImmediate();
        other.close();
        throw new Error("second beginImmediate acquired the write lock");
      } catch (error) {
        const failure = readSqliteFailure(error);
        busy = failure?.errcode ?? 0;
        if (failure?.errcode !== 5) {
          other.close();
          throw error;
        }
        other.close();
      }
      held.rollback();
      notes.busyErrcode = busy;
      return `deferredBegin=rejected busyErrcode=${busy}`;
    } finally {
      writer.close();
    }
  } finally {
    removeDirectorySync(dir);
  }
}

function schemaSuite(storage: "memory" | "wal"): string {
  const root = repoRoot();
  const args = [path.join(root, "schema", "schema-test.js")];
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
  delete env.EF_SPIKE_WAL_DIR;
  let dir: string | undefined;
  if (storage === "wal") {
    dir = makeTempDir("ef-spike-schema-wal-");
    env.EF_SPIKE_WAL_DIR = dir;
    args.unshift(pathToFileURL(spikeFile("wal-preload.mjs")).href);
    args.unshift("--import");
  }
  try {
    const result = runProcess(process.execPath, args, env, root);
    const summary = result.stdout.match(/(\d+)\/(\d+) passed[^\n]*SQLite ([0-9.]+)/);
    if (result.status !== 0 || !summary) {
      throw new Error(tail(`schema ${storage} exited ${result.status}`, result.stdout, result.stderr));
    }
    const passed = Number(summary[1]);
    const total = Number(summary[2]);
    const sqlite = summary[3] ?? "";
    const passLines = result.stdout.split(/\r?\n/).filter((line) => line.startsWith("PASS")).length;
    const failLines = result.stdout.split(/\r?\n/).filter((line) => line.startsWith("FAIL")).length;
    assert(passed === 67 && total === 67 && passLines === 67 && failLines === 0, `${passed}/${total} passLines=${passLines} failLines=${failLines}`);
    if (dir) {
      const files = fs.readdirSync(dir).filter((name) => name.endsWith(".db"));
      assert(files.length >= 4, `expected at least 4 on-disk databases, found ${files.length}`);
      for (const name of files) {
        const db = new DatabaseSync(path.join(dir, name), { readOnly: true });
        try {
          const mode = db.prepare("PRAGMA journal_mode").get();
          const journal = mode && typeof mode.journal_mode === "string" ? mode.journal_mode : "";
          assert(journal === "wal", `${name} journal_mode=${journal}`);
        } finally {
          db.close();
        }
      }
      return `67/67 SQLite ${sqlite} walFiles=${files.length} skipped=0`;
    }
    return `67/67 SQLite ${sqlite} storage=memory skipped=0`;
  } finally {
    if (dir) removeDirectorySync(dir);
  }
}

async function ftsChecks(notes: NoteDraft): Promise<CheckResult[]> {
  const dir = makeTempDir("ef-spike-fts-");
  const driver = openNodeSqliteDriver(path.join(dir, "fts.db"));
  try {
    driver.registerFunction("ef_search_text", efSearchText, { deterministic: true });
    driver.exec(fs.readFileSync(canonicalAsset("stateSql"), "utf8"));
    const tx = driver.beginImmediate();
    driver.prepare(
      "INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES (?, ?, 'kernel', 'spike', 0)",
    ).run(["CS-SPIKE", 1]);
    driver.prepare(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
       VALUES (?, 'contract', 1, 'hash-c-014', ?, ?, '{}', 'CS-SPIKE', 1, 1)`,
    ).run(["C-014", "Café toPrintRows order_id", "naïve Straße 😀"]);
    tx.commit();
    driver.exec("CREATE VIRTUAL TABLE kb_ident_contentless USING fts5(id, title, content='', tokenize='trigram')");
    driver.prepare("INSERT INTO kb_ident_contentless(rowid, id, title) VALUES (1, 'C-014', 'Café')").run();
    const contentless = driver.prepare("SELECT id FROM kb_ident_contentless WHERE id LIKE '%C-01%'").all();
    notes.contentlessLikeRows = contentless.length;
    const external = identIds(driver);
    const trap = await check("fts-contentless-trap", () => {
      assert(contentless.length === 0, `contentless trigram LIKE returned ${contentless.length} rows`);
      assert(external.includes("C-014"), "external-content trigram LIKE missed C-014");
      return "contentlessLike=0 externalLike=C-014";
    });
    const unicode = await check("fts-unicode", () => {
      assert(wordIds(driver, "cafe").includes("C-014"), "remove_diacritics missed cafe");
      assert(wordIds(driver, "naive").includes("C-014"), "remove_diacritics missed naive");
      assert(wordIds(driver, "print AND rows").includes("C-014"), "camelCase split missed toPrintRows");
      assert(wordIds(driver, "order AND id").includes("C-014"), "snake_case split missed order_id");
      const text = sqlText(driver.prepare("SELECT text FROM nodes WHERE id = 'C-014'").get(), "text");
      assert(text.includes("😀") && text.includes("Straße") && text.includes("naïve"), "stored text lost unicode characters");
      return `cafe naive camel snake stored=emoji+eszett strasseHits=${optionalHits(driver, "strasse")} emojiHits=${optionalHits(driver, "😀")}`;
    });
    const vacuum = await check("fts-vacuum", () => {
      driver.exec("VACUUM");
      assert(wordIds(driver, "print AND rows").includes("C-014"), "kb_words missed toPrintRows after VACUUM");
      assert(identIds(driver).includes("C-014"), "kb_ident missed C-014 after VACUUM");
      const copy = path.join(dir, "fts-copy.db");
      vacuumInto(driver, copy);
      const copied = openNodeSqliteDriver(copy, { readOnly: true, applyHarnessPragmas: false });
      try {
        assert(wordIds(copied, "cafe").includes("C-014"), "copied kb_words missed cafe");
        assert(identIds(copied).includes("C-014"), "copied kb_ident missed C-014");
        const contentlessCopy = copied.prepare("SELECT id FROM kb_ident_contentless WHERE id LIKE '%C-01%'").all();
        assert(contentlessCopy.length === 0, "copied contentless trigram started returning LIKE rows");
        assert(onlyCell(copied.pragma("quick_check")[0]).value === "ok", "FTS copy failed quick_check");
      } finally {
        copied.close();
      }
      return "VACUUM and VACUUM INTO kept external FTS and contentless LIKE stayed empty";
    });
    return [trap, unicode, vacuum];
  } catch (error) {
    return [{ id: "fts", pass: false, detail: errorMessage(error) }];
  } finally {
    driver.close();
    removeDirectorySync(dir);
  }
}

function iteratorCheckpoint(notes: NoteDraft): string {
  const dir = makeTempDir("ef-spike-cursor-");
  try {
    const driver = openNodeSqliteDriver(path.join(dir, "cursor.db"));
    try {
      driver.exec("CREATE TABLE t(n INTEGER)");
      const tx = driver.beginImmediate();
      const insert = driver.prepare("INSERT INTO t(n) VALUES (?)");
      for (let index = 0; index < 50; index += 1) insert.run([index]);
      tx.commit();
      const iterator = driver.prepare("SELECT n FROM t").iterate();
      iterator.next();
      let errcode = 0;
      try {
        driver.pragma("wal_checkpoint(TRUNCATE)");
      } catch (error) {
        errcode = readSqliteFailure(error)?.errcode ?? 0;
      }
      notes.iteratorErrcode = errcode;
      assert(errcode === 6, `open iterator errcode=${errcode}, expected SQLITE_LOCKED 6`);
      iterator.return?.();
      for (const mode of ["PASSIVE", "RESTART", "TRUNCATE"] as const) {
        const row = driver.pragma(`wal_checkpoint(${mode})`)[0];
        assert(sqlNumber(row, "busy") === 0, `${mode} stayed busy after the cursor was closed`);
      }
      return "openIterator=SQLITE_LOCKED 6; return() released PASSIVE RESTART TRUNCATE";
    } finally {
      driver.close();
    }
  } finally {
    removeDirectorySync(dir);
  }
}

async function syntheticChecks(notes: NoteDraft): Promise<CheckResult[]> {
  const dir = makeTempDir("ef-spike-50mb-");
  const file = path.join(dir, "synthetic.db");
  const driver = openNodeSqliteDriver(file);
  try {
    driver.exec("CREATE TABLE synthetic(n INTEGER PRIMARY KEY, payload BLOB) STRICT");
    const blob = new Uint8Array(SYNTHETIC_BLOB_BYTES);
    const tx = driver.beginImmediate();
    const insert = driver.prepare("INSERT INTO synthetic(n, payload) VALUES (?, ?)");
    for (let index = 0; index < SYNTHETIC_ROWS; index += 1) {
      fillBlob(blob, index);
      insert.run([index, blob]);
    }
    tx.commit();
    const bytes = sqlNumber(driver.pragma("page_size")[0], "page_size") * sqlNumber(driver.pragma("page_count")[0], "page_count");
    notes.syntheticBytes = bytes;
    const version = await check("data-version", () => {
      const before = sqlNumber(driver.pragma("data_version")[0], "data_version");
      fillBlob(blob, SYNTHETIC_ROWS);
      driver.prepare("INSERT INTO synthetic(n, payload) VALUES (?, ?)").run([SYNTHETIC_ROWS, blob]);
      const afterSelf = sqlNumber(driver.pragma("data_version")[0], "data_version");
      const other = openNodeSqliteDriver(file);
      try {
        fillBlob(blob, SYNTHETIC_ROWS + 1);
        other.prepare("INSERT INTO synthetic(n, payload) VALUES (?, ?)").run([SYNTHETIC_ROWS + 1, blob]);
      } finally {
        other.close();
      }
      const afterOther = sqlNumber(driver.pragma("data_version")[0], "data_version");
      assert(afterSelf === before, `same-connection write changed data_version ${before} -> ${afterSelf}`);
      assert(afterOther !== before, "other connection commit did not change data_version");
      notes.sameConnectionDataVersion = "unchanged";
      return `same=${before}->${afterSelf} other=${afterOther}`;
    });
    const backup = await check("vacuum-into-concurrent", async () => {
      assert(bytes >= 50 * 1024 * 1024, `synthetic database is ${bytes} bytes`);
      const copy = path.join(dir, "synthetic-copy.db");
      const worker = new Worker(spikeFile("reader-worker.mjs"), {
        workerData: { file, mode: "hold", sql: "SELECT count(*) AS c FROM synthetic" },
      });
      try {
        await waitFor(worker, "holding", 10000);
        const ms = vacuumInto(driver, copy);
        notes.vacuumIntoMs = ms;
        worker.postMessage("release");
        await waitFor(worker, "released", 5000);
        const copied = openNodeSqliteDriver(copy, { readOnly: true, applyHarnessPragmas: false });
        try {
          const copiedRows = sqlNumber(copied.prepare("SELECT count(*) AS c FROM synthetic").get(), "c");
          const quickStarted = performance.now();
          const quick = onlyCell(copied.pragma("quick_check")[0]).value;
          notes.quickCheckMs = Math.round(performance.now() - quickStarted);
          const integrityStarted = performance.now();
          const integrity = onlyCell(copied.pragma("integrity_check")[0]).value;
          notes.integrityCheckMs = Math.round(performance.now() - integrityStarted);
          assert(quick === "ok", `quick_check=${quick}`);
          assert(integrity === "ok", `integrity_check=${integrity}`);
          assert(copiedRows >= SYNTHETIC_ROWS, `copy has ${copiedRows} rows`);
          return `bytes=${bytes} vacuumIntoMs=${ms} quickCheckMs=${notes.quickCheckMs} integrityCheckMs=${notes.integrityCheckMs} rows=${copiedRows}`;
        } finally {
          copied.close();
        }
      } finally {
        await worker.terminate();
      }
    });
    return [version, backup];
  } catch (error) {
    return [{ id: "synthetic-50mb", pass: false, detail: errorMessage(error) }];
  } finally {
    driver.close();
    removeDirectorySync(dir);
  }
}

function destinationGuard(): string {
  const dir = makeTempDir("ef-spike-dest-");
  try {
    const driver = openNodeSqliteDriver(path.join(dir, "source.db"));
    try {
      driver.exec("CREATE TABLE t(n INTEGER)");
      driver.prepare("INSERT INTO t(n) VALUES (1)").run();
      const dest = path.join(dir, "kept.db");
      const prior = Buffer.from("prior-backup-v1");
      fs.writeFileSync(dest, prior);
      let existed = false;
      try {
        vacuumInto(driver, dest);
      } catch (error) {
        existed = error instanceof Error && error.message.includes("already exists");
      }
      assert(existed, "VACUUM INTO replaced an existing destination");
      assert(fs.readFileSync(dest).equals(prior), "existing backup bytes changed");
      assert(!fs.existsSync(partialBackupPath(dest)), "partial file was left next to an existing backup");

      const interrupted = path.join(dir, "interrupted.db");
      const stale = partialBackupPath(interrupted);
      fs.writeFileSync(stale, Buffer.from("stale-partial"));
      const tx = driver.beginImmediate();
      let failed = false;
      try {
        vacuumInto(driver, interrupted);
      } catch (error) {
        failed = error instanceof Error;
      } finally {
        tx.rollback();
      }
      assert(failed, "VACUUM INTO ran inside a transaction");
      assert(!fs.existsSync(stale), "failed backup left a partial file");
      assert(!fs.existsSync(interrupted), "failed backup created a destination");

      const fresh = path.join(dir, "fresh.db");
      vacuumInto(driver, fresh);
      let second = false;
      try {
        vacuumInto(driver, fresh);
      } catch (error) {
        second = error instanceof Error && error.message.includes("already exists");
      }
      assert(second, "a second VACUUM INTO overwrote the fresh backup");
      const copied = openNodeSqliteDriver(fresh, { readOnly: true, applyHarnessPragmas: false });
      try {
        assert(onlyCell(copied.pragma("quick_check")[0]).value === "ok", "fresh backup failed quick_check");
      } finally {
        copied.close();
      }
      return "existing destination preserved; partial file removed; fresh copy passed quick_check";
    } finally {
      driver.close();
    }
  } finally {
    removeDirectorySync(dir);
  }
}

async function workerTerminate(notes: NoteDraft): Promise<string> {
  const dir = makeTempDir("ef-spike-worker-");
  const file = path.join(dir, "reader.db");
  const driver = openNodeSqliteDriver(file);
  const worker = new Worker(spikeFile("reader-worker.mjs"), { workerData: { file, mode: "chunked" } });
  let finishedEarly = false;
  worker.on("message", (value: unknown) => {
    if (readWorkerNote(value).event === "finished") finishedEarly = true;
  });
  try {
    driver.exec("CREATE TABLE t(n INTEGER)");
    driver.prepare("INSERT INTO t(n) VALUES (1)").run();
    await waitFor(worker, "started", 5000);
    await delay(200);
    driver.prepare("INSERT INTO t(n) VALUES (2)").run();
    const started = performance.now();
    await worker.terminate();
    const terminatedMs = Math.round(performance.now() - started);
    notes.chunkedTerminateMs = terminatedMs;
    assert(!finishedEarly, "chunked reader finished before the 200ms terminate");
    assert(terminatedMs < 500, `terminate returned in ${terminatedMs}ms`);
    const modes: string[] = [];
    for (const mode of ["PASSIVE", "RESTART", "TRUNCATE"] as const) {
      const stamp = performance.now();
      const row = driver.pragma(`wal_checkpoint(${mode})`)[0];
      const ms = Math.round(performance.now() - stamp);
      assert(sqlNumber(row, "busy") === 0, `${mode} busy after terminate`);
      if (mode === "TRUNCATE") notes.truncateMs = ms;
      modes.push(`${mode}=${ms}ms`);
    }
    assert((notes.truncateMs ?? 1000) < 500, `TRUNCATE took ${notes.truncateMs}ms`);
    driver.close();
    removeDirectorySync(dir);
    assert(!fs.existsSync(dir), "database directory remained after terminate");
    return `terminateMs=${terminatedMs} ${modes.join(" ")} handlesReleased=yes`;
  } finally {
    driver.close();
    await worker.terminate();
    if (fs.existsSync(dir)) removeDirectorySync(dir);
  }
}

async function workerInflight(notes: NoteDraft): Promise<string> {
  const dir = makeTempDir("ef-spike-inflight-");
  const file = path.join(dir, "inflight.db");
  const driver = openNodeSqliteDriver(file);
  const worker = new Worker(spikeFile("reader-worker.mjs"), { workerData: { file, mode: "blocking" } });
  try {
    driver.exec("CREATE TABLE t(n INTEGER)");
    driver.prepare("INSERT INTO t(n) VALUES (1)").run();
    await waitFor(worker, "started", 5000);
    const started = performance.now();
    await worker.terminate();
    notes.blockingTerminateMs = Math.round(performance.now() - started);
    const row = driver.pragma("wal_checkpoint(TRUNCATE)")[0];
    assert(sqlNumber(row, "busy") === 0, "TRUNCATE stayed busy after the in-flight call returned");
    driver.close();
    removeDirectorySync(dir);
    return `inFlightTerminateMs=${notes.blockingTerminateMs} (sqlite3_interrupt is not exposed; terminate waits for the current call)`;
  } finally {
    driver.close();
    await worker.terminate();
    if (fs.existsSync(dir)) removeDirectorySync(dir);
  }
}

function driverParity(notes: NoteDraft): string {
  const dir = makeTempDir("ef-spike-parity-");
  try {
    const nodeFile = path.join(dir, "node.db");
    const fallbackFile = path.join(dir, "fallback.db");
    const nodeStarted = performance.now();
    const nodeDriver = openNodeSqliteDriver(nodeFile);
    let nodeResult = "";
    try {
      nodeResult = exercise(nodeDriver);
    } finally {
      nodeDriver.close();
    }
    notes.nodeDriverMs = Math.round(performance.now() - nodeStarted);
    const fallbackStarted = performance.now();
    const fallbackDriver = openBetterSqlite3Driver(openNodeBackedBetterSqliteVendor(fallbackFile));
    let fallbackResult = "";
    try {
      fallbackResult = exercise(fallbackDriver);
    } finally {
      fallbackDriver.close();
    }
    notes.fallbackDriverMs = Math.round(performance.now() - fallbackStarted);
    notes.parityEqual = nodeResult === fallbackResult;
    assert(notes.parityEqual, `driver results differ node=${nodeResult} fallback=${fallbackResult}`);
    return `equal=yes nodeMs=${notes.nodeDriverMs} fallbackMs=${notes.fallbackDriverMs} sample=${nodeResult}`;
  } finally {
    removeDirectorySync(dir);
  }
}

function nativeAddons(notes: NoteDraft): string {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
  const result = runProcess(process.execPath, [spikeFile("native-check.ts")], env, repoRoot());
  const line = result.stdout.split(/\r?\n/).find((item) => item.startsWith("{"));
  if (result.status !== 0 || !line) {
    throw new Error(tail("native addon probe failed", result.stdout, result.stderr));
  }
  const parsed = jsonRecord(line);
  const native = parsed.native;
  const count = Array.isArray(native) ? native.length : -1;
  notes.nativeAddonCount = count;
  assert(count === 0, `default path loaded native addons: ${JSON.stringify(native)}`);
  assert(parsed.betterSqliteResolved === false, "better-sqlite3 resolved from the default path");
  return "nativeAddons=0 better-sqlite3=unresolved";
}

function exercise(driver: SqliteDriver): string {
  driver.pragma("journal_mode = WAL");
  driver.exec("CREATE TABLE bench(id INTEGER PRIMARY KEY, name TEXT) STRICT");
  const tx = driver.beginImmediate();
  const insert = driver.prepare("INSERT INTO bench(name) VALUES (:name)");
  for (let index = 0; index < 1000; index += 1) insert.run({ name: `row-${index}` });
  tx.commit();
  const save = driver.savepoint("edit");
  driver.prepare("UPDATE bench SET name = :name WHERE id = :id").run({ name: "changed", id: 1 });
  save.rollback();
  driver.registerFunction("ef_len", (value) => (value == null ? 0 : String(value).length), { deterministic: true });
  const count = sqlNumber(driver.prepare("SELECT count(*) AS c FROM bench").get(), "c");
  const name = sqlText(driver.prepare("SELECT name FROM bench WHERE id = 1").get(), "name");
  const length = sqlNumber(driver.prepare("SELECT ef_len(name) AS n FROM bench WHERE id = 1").get(), "n");
  const mode = onlyCell(driver.pragma("journal_mode")[0]).value;
  return JSON.stringify({ count, name, length, mode });
}

function bindCanonicalQueries(): number {
  const text = fs.readFileSync(canonicalAsset("queriesSql"), "utf8");
  const queries = readNamedQueries(text);
  const headers = text.match(/^-- name: /gm)?.length ?? 0;
  assert(queries.length === headers && headers > 0, `parsed ${queries.length} of ${headers} named queries`);
  const state = openNodeSqliteDriver(":memory:");
  const global = openNodeSqliteDriver(":memory:");
  try {
    state.registerFunction("ef_search_text", efSearchText, { deterministic: true });
    state.exec(fs.readFileSync(canonicalAsset("stateSql"), "utf8"));
    global.exec(fs.readFileSync(canonicalAsset("globalSql"), "utf8"));
    for (const query of queries) {
      const names = namedParameters(query.sql);
      const target = query.name.startsWith("global_") ? global : state;
      let statement;
      try {
        statement = target.prepare(query.sql);
      } catch (error) {
        throw new Error(`${query.name} prepare: ${errorMessage(error)}`);
      }
      const bare: { [name: string]: null } = {};
      const prefixed: { [name: string]: null } = {};
      for (const name of names) {
        bare[name] = null;
        prefixed[`:${name}`] = null;
      }
      const tx = target.beginImmediate();
      try {
        try {
          if (names.length === 0) statement.get();
          else statement.get(bare);
        } catch (error) {
          if (isBindingError(error)) throw new Error(`${query.name} bare bind: ${errorMessage(error)}`);
        }
        try {
          if (names.length === 0) statement.get();
          else statement.get(prefixed);
        } catch (error) {
          if (isBindingError(error)) throw new Error(`${query.name} prefixed bind: ${errorMessage(error)}`);
        }
      } finally {
        tx.rollback();
      }
    }
    return queries.length;
  } finally {
    state.close();
    global.close();
  }
}

function readNamedQueries(sql: string): { name: string; sql: string }[] {
  return sql.split(/^-- name: /m).slice(1).map((block) => {
    const [first, ...rest] = block.split("\n");
    const name = (first ?? "").trim();
    const body = rest.filter((line) => !line.trim().startsWith("--")).join("\n").trim().replace(/;\s*$/, "");
    if (!name || !body) throw new Error("named query block was empty");
    return { name, sql: body };
  });
}

function namedParameters(sql: string): string[] {
  const stripped = sql.replace(/'(?:''|[^'])*'/g, "''").replace(/--[^\n]*/g, " ");
  const names = new Set<string>();
  for (const match of stripped.matchAll(/(?:^|[^:]):([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const name = match[1];
    if (name) names.add(name);
  }
  return [...names];
}

function isBindingError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("named parameter");
}

function optionalHits(driver: SqliteDriver, match: string): string {
  try {
    return String(wordIds(driver, match).length);
  } catch (error) {
    return errorMessage(error);
  }
}

function wordIds(driver: SqliteDriver, match: string): string[] {
  return driver.prepare(
    "SELECT n.id AS id FROM kb_words w JOIN nodes n ON n.nid = w.rowid WHERE kb_words MATCH ?",
  ).all([match]).map((row) => sqlText(row, "id"));
}

function identIds(driver: SqliteDriver): string[] {
  return driver.prepare("SELECT id FROM kb_ident WHERE id LIKE '%C-01%'").all().map((row) => sqlText(row, "id"));
}

function fillBlob(bytes: Uint8Array, index: number): void {
  let state = (BENCHMARK_SEED + index * 0x9e3779b1) >>> 0;
  for (let cursor = 0; cursor < 32; cursor += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    bytes[cursor] = state & 0xff;
  }
  bytes[32] = index & 0xff;
  bytes[33] = (index >>> 8) & 0xff;
}

function onlyCell(row: SqlRow | undefined): { key: string; value: string } {
  if (!row) throw new Error("missing pragma row");
  const key = Object.keys(row)[0];
  if (!key) throw new Error("pragma row had no columns");
  return { key, value: sqlText(row, key) };
}

interface WorkerNote {
  readonly event: string;
}

function readWorkerNote(value: unknown): WorkerNote {
  if (typeof value !== "object" || value === null || !("event" in value) || typeof value.event !== "string") {
    throw new Error("worker sent an unreadable message");
  }
  return { event: value.event };
}

function waitFor(worker: Worker, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onMessage = (value: unknown) => {
      if (readWorkerNote(value).event !== event) return;
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timer);
      worker.off("message", onMessage);
      worker.off("error", onError);
    };
    worker.on("message", onMessage);
    worker.on("error", onError);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function tail(label: string, stdout: string, stderr: string): string {
  return `${label}\n${stdout.slice(-500)}\n${stderr.slice(-500)}`;
}

function jsonRecord(text: string): { readonly [key: string]: unknown } {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("expected a JSON object");
  }
  const record: { [key: string]: unknown } = {};
  for (const key of Object.keys(parsed)) {
    record[key] = Reflect.get(parsed, key);
  }
  return record;
}

function readString(value: { readonly [key: string]: unknown }, key: string): string | null {
  const item = value[key];
  return typeof item === "string" ? item : null;
}

function readNumber(value: { readonly [key: string]: unknown }, key: string): number | null {
  const item = value[key];
  return typeof item === "number" ? item : null;
}

function readBoolean(value: { readonly [key: string]: unknown }, key: string): boolean | null {
  const item = value[key];
  return typeof item === "boolean" ? item : null;
}
