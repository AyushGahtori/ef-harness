import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

import { bufferContainsVariant, sanitizeSensitiveText } from "./redact.js";
import { rebuildAndOptimizeSearchIndexes, reindexNode } from "./search-maintenance.js";
import { rewriteDatabaseSecret } from "./rewrite-database.js";
import {
  applyPurgePragmas,
  assertQuickCheckClean,
  ensureSearchTextFunction,
  loadSchemaAsset,
  truncateWal,
  vacuumInto,
} from "./sqlite-util.js";
import type { ComputeNodeContentHash, SecretVariant } from "./types.js";

export function secureDeleteFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return;
  const handle = fs.openSync(filePath, "r+");
  try {
    const zeros = Buffer.alloc(1024 * 1024);
    let offset = 0;
    while (offset < stat.size) {
      const length = Math.min(zeros.length, stat.size - offset);
      fs.writeSync(handle, zeros, 0, length, offset);
      offset += length;
    }
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.chmodSync(filePath, 0o666);
  fs.unlinkSync(filePath);
}

export function fileContainsVariant(filePath: string, variants: readonly SecretVariant[]): boolean {
  if (!fs.existsSync(filePath)) return false;
  return bufferContainsVariant(fs.readFileSync(filePath), variants);
}

export function assertFilesClean(
  files: readonly string[],
  variants: readonly SecretVariant[],
  label: string,
): void {
  for (const filePath of files) {
    if (fileContainsVariant(filePath, variants)) {
      throw new Error(`raw secret bytes remained in ${label}`);
    }
  }
}

export interface BackupScrubOutcome {
  readonly scrubbed: readonly string[];
  readonly pending: readonly string[];
  readonly failureMessage: string | null;
}

export function scrubBackupDirectory(options: {
  readonly directory: string;
  readonly variants: readonly SecretVariant[];
  readonly placeholder: string;
  readonly hashContent: ComputeNodeContentHash;
  readonly casReplacements?: ReadonlyMap<string, { readonly hash: string; readonly bytes: number }>;
  readonly beforeBackupScrub?: (backupPath: string) => void;
  readonly afterBackup?: (backupPath: string) => void;
}): BackupScrubOutcome {
  if (!fs.existsSync(options.directory)) {
    return { scrubbed: [], pending: [], failureMessage: null };
  }
  const files = fs
    .readdirSync(options.directory)
    .filter((name) => name.endsWith(".db"))
    .sort()
    .map((name) => path.join(options.directory, name));
  const scrubbed: string[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const filePath = files[index];
    if (!filePath) continue;
    try {
      options.beforeBackupScrub?.(filePath);
      if (!fileContainsVariant(filePath, options.variants)) continue;
      scrubOneBackup(
        filePath,
        options.variants,
        options.placeholder,
        options.hashContent,
        options.casReplacements,
      );
      options.afterBackup?.(filePath);
      scrubbed.push(filePath);
    } catch (error) {
      const pending = files.slice(index);
      return {
        scrubbed,
        pending,
        failureMessage: sanitizeSensitiveText(
          error instanceof Error ? error.message : "backup scrub failed",
          options.variants,
        ),
      };
    }
  }
  return { scrubbed, pending: [], failureMessage: null };
}

function scrubOneBackup(
  filePath: string,
  variants: readonly SecretVariant[],
  placeholder: string,
  hashContent: ComputeNodeContentHash,
  casReplacements?: ReadonlyMap<string, { readonly hash: string; readonly bytes: number }>,
): void {
  const db = new DatabaseSync(filePath);
  const redactedCopy = `${filePath}.redacted`;
  const displaced = `${filePath}.displaced`;
  try {
    applyPurgePragmas(db);
    ensureSearchTextFunction(db);
    const rewritten = rewriteDatabaseSecret(db, { variants, placeholder, hashContent });
    if (casReplacements) {
      const update = db.prepare("UPDATE artifacts SET hash = ?, bytes = ? WHERE hash = ?");
      for (const [oldHash, replacement] of casReplacements) {
        update.run(replacement.hash, replacement.bytes, oldHash);
      }
    }
    for (const node of rewritten.touchedNodes) reindexNode(db, node);
    rebuildAndOptimizeSearchIndexes(db);
    truncateWal(db);
    if (fs.existsSync(redactedCopy)) fs.unlinkSync(redactedCopy);
    vacuumInto(db, redactedCopy);
  } finally {
    if (db.isOpen) db.close();
  }
  const cleaned = new DatabaseSync(redactedCopy);
  try {
    applyPurgePragmas(cleaned);
    assertQuickCheckClean(cleaned);
    truncateWal(cleaned);
  } finally {
    if (cleaned.isOpen) cleaned.close();
  }
  if (fileContainsVariant(redactedCopy, variants)) {
    secureDeleteFile(redactedCopy);
    throw new Error("backup copy still contained a secret after VACUUM INTO");
  }
  secureDeleteFile(`${redactedCopy}-wal`);
  secureDeleteFile(`${redactedCopy}-shm`);
  if (fs.existsSync(displaced)) secureDeleteFile(displaced);
  fs.renameSync(filePath, displaced);
  try {
    fs.renameSync(redactedCopy, filePath);
  } catch (error) {
    fs.renameSync(displaced, filePath);
    throw error;
  }
  secureDeleteFile(displaced);
  secureDeleteFile(`${filePath}-wal`);
  secureDeleteFile(`${filePath}-shm`);
  secureDeleteFile(`${displaced}-wal`);
  secureDeleteFile(`${displaced}-shm`);
}

export function scrubTelemetryDatabase(
  filePath: string | undefined,
  variants: readonly SecretVariant[],
  placeholder: string,
): number {
  if (!filePath || !fs.existsSync(filePath)) return 0;
  const sidecars = [`${filePath}-wal`, `${filePath}-shm`];
  const dirty =
    fileContainsVariant(filePath, variants) ||
    sidecars.some((sidecar) => fileContainsVariant(sidecar, variants));
  if (!dirty) return 0;
  const db = new DatabaseSync(filePath);
  let kept: Array<{ attempt: string | null; ts: number; kind: string; data: string }> = [];
  let scrubbed = 0;
  try {
    const rows = db.prepare("SELECT attempt, ts, kind, data FROM telemetry").all();
    kept = rows.map((row) => {
      const attemptRaw = row["attempt"] == null ? null : sqlTextSafe(row["attempt"]);
      const dataRaw = sqlTextSafe(row["data"]);
      const attempt = attemptRaw === null ? null : replaceText(attemptRaw, variants, placeholder);
      const data = replaceText(dataRaw, variants, placeholder);
      const kind = replaceText(sqlTextSafe(row["kind"]), variants, placeholder);
      if (attempt !== attemptRaw || data !== dataRaw || kind !== sqlTextSafe(row["kind"])) scrubbed += 1;
      return {
        attempt,
        ts: Number(row["ts"]),
        kind,
        data,
      };
    });
  } finally {
    if (db.isOpen) db.close();
  }
  secureDeleteFile(filePath);
  for (const sidecar of sidecars) secureDeleteFile(sidecar);
  const recreated = new DatabaseSync(filePath);
  try {
    recreated.exec(loadSchemaAsset("telemetry.sql"));
    recreated.exec("PRAGMA secure_delete = ON");
    recreated.exec("PRAGMA journal_mode = WAL");
    const insert = recreated.prepare(
      "INSERT INTO telemetry(attempt, ts, kind, data) VALUES (?, ?, ?, ?)",
    );
    for (const row of kept) insert.run(row.attempt, row.ts, row.kind, row.data);
    recreated.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    recreated.exec("VACUUM");
  } finally {
    if (recreated.isOpen) recreated.close();
  }
  if (fileContainsVariant(filePath, variants)) {
    throw new Error("raw secret bytes remained in telemetry.db");
  }
  return scrubbed;
}

export function scrubLogDirectory(
  directory: string | undefined,
  variants: readonly SecretVariant[],
  placeholder: string,
): number {
  if (!directory || !fs.existsSync(directory)) return 0;
  let files = 0;
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith(".jsonl")) continue;
    const filePath = path.join(directory, name);
    const original = fs.readFileSync(filePath, "utf8");
    if (![...variants].some((variant) => variant.value.length > 0 && original.includes(variant.value))) {
      continue;
    }
    let next = original;
    const ordered = [...variants].sort((left, right) => right.value.length - left.value.length);
    for (const variant of ordered) {
      if (variant.value.length === 0) continue;
      next = next.split(variant.value).join(placeholder);
    }
    fs.writeFileSync(filePath, next);
    files += 1;
  }
  return files;
}

function replaceText(value: string, variants: readonly SecretVariant[], placeholder: string): string {
  let next = value;
  for (const variant of variants) {
    if (variant.value.length === 0) continue;
    next = next.split(variant.value).join(placeholder);
  }
  return next;
}

function sqlTextSafe(value: SQLOutputValue | undefined): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}
