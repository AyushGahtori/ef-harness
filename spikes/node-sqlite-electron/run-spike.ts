import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BENCHMARK_SEED,
  notesFromJson,
  runCurrentRuntime,
  SYNTHETIC_BLOB_BYTES,
  SYNTHETIC_ROWS,
  type CheckResult,
  type RuntimeNotes,
  type RuntimeReport,
} from "./checks.ts";
import { electronBinary, errorMessage, repoRoot, runProcess, spikeFile } from "./runtime.ts";

export interface SpikeReport {
  readonly task: "Task-002";
  readonly decision: "go" | "no-go";
  readonly systemNode: RuntimeReport;
  readonly electron: RuntimeReport;
}

export async function runBothAndWrite(): Promise<SpikeReport> {
  const systemNode = await runCurrentRuntime();
  const electron = await runElectronRuntime();
  const report: SpikeReport = {
    task: "Task-002",
    decision: systemNode.passed && electron.passed ? "go" : "no-go",
    systemNode,
    electron,
  };
  const directory = path.dirname(fileURLToPath(import.meta.url));
  fs.writeFileSync(path.join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(directory, "REPORT.md"), renderReport(report), "utf8");
  return report;
}

export function summarizeFailures(report: SpikeReport): string {
  const lines = [...failures("node", report.systemNode), ...failures("electron", report.electron)];
  return lines.length === 0 ? "all checks passed" : lines.join("\n");
}

function failures(runtime: string, report: RuntimeReport): string[] {
  return report.checks.filter((item) => !item.pass).map((item) => `${runtime} ${item.id}: ${item.detail}`);
}

async function runElectronRuntime(): Promise<RuntimeReport> {
  const result = runProcess(
    electronBinary(),
    [spikeFile("run-spike.ts")],
    { ...process.env, ELECTRON_RUN_AS_NODE: "1", EF_SPIKE_CHILD: "1" },
    repoRoot(),
  );
  const line = result.stdout.split(/\r?\n/).find((item) => item.startsWith("EF_SPIKE_RESULT "));
  if (!line) {
    throw new Error(`electron spike produced no result (${result.status}): ${result.stderr.slice(-800)}\n${result.stdout.slice(-800)}`);
  }
  return parseRuntime(JSON.parse(line.slice("EF_SPIKE_RESULT ".length)));
}

function parseRuntime(value: unknown): RuntimeReport {
  const record = asRecord(value);
  if (record.runtime !== "node" && record.runtime !== "electron") {
    throw new Error("electron result did not name a runtime");
  }
  if (!Array.isArray(record.checks)) throw new Error("electron result did not include checks");
  const checks = record.checks.map((item) => parseCheck(item));
  if (typeof record.passed !== "boolean") throw new Error("electron result did not include passed");
  return {
    runtime: record.runtime,
    checks,
    notes: notesFromJson(asRecord(record.notes)),
    passed: record.passed,
  };
}

function parseCheck(value: unknown): CheckResult {
  const record = asRecord(value);
  if (typeof record.id !== "string" || typeof record.pass !== "boolean" || typeof record.detail !== "string") {
    throw new Error("electron result included an unreadable check");
  }
  return { id: record.id, pass: record.pass, detail: record.detail };
}

function asRecord(value: unknown): { [key: string]: unknown } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected an object");
  }
  const record: { [key: string]: unknown } = {};
  for (const key of Object.keys(value)) {
    record[key] = Reflect.get(value, key);
  }
  return record;
}

function renderReport(report: SpikeReport): string {
  const electron = report.electron.notes;
  const node = report.systemNode.notes;
  const lines = [
    "# Task 002 spike verdict",
    "",
    `Decision for Task 012: **${report.decision}**.`,
    "",
    report.decision === "go"
      ? `\`node:sqlite\` works inside Electron ${electron.electronVersion ?? "unknown"} (Node ${electron.nodeVersion}, SQLite ${electron.sqliteVersion ?? "unknown"}) with WAL, FTS5, \`VACUUM INTO\`, and 67/67 schema scenarios on both \`:memory:\` and on-disk WAL databases. The same suite passed on system Node ${node.nodeVersion} (SQLite ${node.sqliteVersion ?? "unknown"}).`
      : `The suite did not pass. ${summarizeFailures(report)}`,
    "",
    "## Runtimes",
    "",
    "| Runtime | Electron | Node | SQLite |",
    "| --- | --- | --- | --- |",
    `| system Node | none | ${node.nodeVersion} | ${node.sqliteVersion ?? "unknown"} |`,
    `| Electron \`ELECTRON_RUN_AS_NODE=1\` | ${electron.electronVersion ?? "unknown"} | ${electron.nodeVersion} | ${electron.sqliteVersion ?? "unknown"} |`,
    "",
    "## Pass/fail matrix",
    "",
    "| Check | System Node | Electron |",
    "| --- | --- | --- |",
    ...matrixRows(report),
    "",
    "## VACUUM INTO",
    "",
    `Synthetic database seed \`${BENCHMARK_SEED}\`, ${SYNTHETIC_ROWS} rows, ${SYNTHETIC_BLOB_BYTES}-byte payloads.`,
    `System Node copy took ${formatMs(node.vacuumIntoMs)} and was ${formatBytes(node.syntheticBytes)}. quick_check ${formatMs(node.quickCheckMs)}, integrity_check ${formatMs(node.integrityCheckMs)}.`,
    `Electron copy took ${formatMs(electron.vacuumIntoMs)} and was ${formatBytes(electron.syntheticBytes)}. quick_check ${formatMs(electron.quickCheckMs)}, integrity_check ${formatMs(electron.integrityCheckMs)}.`,
    "",
    "## Driver benchmark",
    "",
    `The \`SqliteDriver\` surface (\`beginImmediate\`, \`savepoint\`, \`prepare\`, \`pragma\`, \`registerFunction\`, \`close\`) produced ${node.parityEqual ? "identical" : "different"} results on \`node:sqlite\` (${formatMs(node.nodeDriverMs)}) and the \`better-sqlite3\`-shaped fallback (${formatMs(node.fallbackDriverMs)}).`,
    `Electron parity was ${electron.parityEqual ? "identical" : "different"} (\`node:sqlite\` ${formatMs(electron.nodeDriverMs)}, fallback ${formatMs(electron.fallbackDriverMs)}).`,
    `Native \`.node\` addons loaded by the default path: system Node ${node.nativeAddonCount ?? "unknown"}, Electron ${electron.nativeAddonCount ?? "unknown"}. \`better-sqlite3\` was not resolved.`,
    "",
    "## Quirks for Task 012",
    "",
    ...quirkLines(node, electron),
    "",
    "## Recommendation",
    "",
    report.decision === "go"
      ? "Go. Implement the kernel driver from `spikes/node-sqlite-electron/driver.ts`. Keep `node:sqlite` as the default. Do not load `better-sqlite3` unless a future platform has no `node:sqlite`. Register `ef_search_text` before opening `state.sql`. Apply the harness pragmas from `schema/state.sql`. Use `BEGIN IMMEDIATE` for every write transaction. Keep `kb_ident` external-content with the trigram tokenizer."
      : "No-go until the failing checks above are understood. Do not start the kernel driver on an unproven SQLite build.",
    "",
  ];
  return lines.join("\n");
}

function matrixRows(report: SpikeReport): string[] {
  const electron = new Map(report.electron.checks.map((item) => [item.id, item]));
  const rows: string[] = [];
  for (const item of report.systemNode.checks) {
    rows.push(`| \`${item.id}\` | ${cell(item)} | ${cell(electron.get(item.id))} |`);
    electron.delete(item.id);
  }
  for (const item of electron.values()) {
    rows.push(`| \`${item.id}\` | missing | ${cell(item)} |`);
  }
  return rows;
}

function cell(item: CheckResult | undefined): string {
  if (!item) return "missing";
  return `${item.pass ? "pass" : "fail"}: ${item.detail.replaceAll("|", "\\|")}`;
}

function quirkLines(node: RuntimeNotes, electron: RuntimeNotes): string[] {
  return [
    `- \`allowBareNamedParameters\` defaults to accepting bare keys for \`:name\` parameters (${node.bareNames ?? "unmeasured"} on Node, ${electron.bareNames ?? "unmeasured"} on Electron). \`schema/queries.sql\` binds that way. Setting the option false rejects bare keys and still accepts \`:name\`, \`@name\`, and \`$name\`. Unknown names throw.`,
    `- \`node:sqlite\` sets a function's arity from \`function.length\`. A rest wrapper has length 0, so the driver registers functions with \`varargs: true\`.`,
    `- Integers above \`Number.MAX_SAFE_INTEGER\` ${node.unsafeInteger ?? "were unmeasured"} on read. Opt in with \`readBigInts: true\` per statement. Do not enable it for every query: every integer would come back as \`bigint\`.`,
    "- `new DatabaseSync(path, undefined)` throws `ERR_INVALID_ARG_TYPE`. Omit the options argument when there is nothing to set.",
    "- `PRAGMA synchronous = FULL`, `PRAGMA foreign_keys = ON`, and `PRAGMA temp_store = MEMORY` return no rows from `prepare().all()`. `PRAGMA journal_mode = WAL` does. The driver reads the pragma name back after an empty assignment.",
    `- \`PRAGMA data_version\` is ${node.sameConnectionDataVersion ?? "unmeasured"} for a write on the same connection. A second connection's commit changes it. That is the signal for a foreign writer.`,
    `- Contentless trigram \`LIKE\` returned ${node.contentlessLikeRows ?? "unmeasured"} rows on Node and ${electron.contentlessLikeRows ?? "unmeasured"} on Electron. \`kb_ident\` has to stay external content (\`content='nodes'\`).`,
    `- An unexhausted statement iterator fails \`wal_checkpoint\` with errcode ${node.iteratorErrcode ?? "unmeasured"} (\`SQLITE_LOCKED\` is 6). Calling the iterator's \`return()\` releases \`PASSIVE\`, \`RESTART\`, and \`TRUNCATE\`.`,
    `- A second \`beginImmediate()\` while the writer holds the lock fails with errcode ${node.busyErrcode ?? "unmeasured"} (\`SQLITE_BUSY\` is 5). The driver rejects \`BEGIN\` and \`BEGIN DEFERRED\` so a deferred read cannot upgrade into that error on the first write.`,
    `- Chunked read-only work yields between SQLite calls, then \`worker.terminate()\` 200ms after the reader starts returned in ${formatMs(node.chunkedTerminateMs)} on Node and ${formatMs(electron.chunkedTerminateMs)} on Electron. \`wal_checkpoint(TRUNCATE)\` then finished in ${formatMs(node.truncateMs)} and ${formatMs(electron.truncateMs)}. The temp directory was removed with \`fs.rmSync\`. A tight synchronous loop is not a reliable cancellation point on Windows: \`terminate()\` can wait until the thread leaves the current native call.`,
    `- One in-flight recursive query delayed \`worker.terminate()\` by ${formatMs(node.blockingTerminateMs)} on Node and ${formatMs(electron.blockingTerminateMs)} on Electron. \`node:sqlite\` does not expose \`sqlite3_interrupt\`, so cancellation has to happen between SQLite calls.`,
    "- `VACUUM INTO` fails with `output file already exists` and must not replace a previous backup. Write a unique partial file, rename it only after success, and delete the partial file if the copy throws.",
  ];
}

function formatMs(value: number | null): string {
  return value === null ? "unmeasured" : `${value} ms`;
}

function formatBytes(value: number | null): string {
  return value === null ? "unmeasured" : `${value} bytes`;
}

const entry = process.argv[1];
if (entry && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  const child = process.env.EF_SPIKE_CHILD === "1" || process.versions.electron !== undefined;
  const pending = child
    ?       runCurrentRuntime().then((report) => {
        fs.writeSync(1, `EF_SPIKE_RESULT ${JSON.stringify(report)}\n`);
        process.exit(report.passed ? 0 : 1);
      })
    : runBothAndWrite().then((report) => {
        process.stdout.write(`${summarizeFailures(report)}\n`);
        process.exit(report.decision === "go" ? 0 : 1);
      });
  pending.catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : errorMessage(error));
    process.exit(1);
  });
}
