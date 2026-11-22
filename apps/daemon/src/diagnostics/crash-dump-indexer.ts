import { closeSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CRASH_DUMP_MAX_BYTES,
  CRASH_DUMP_MAX_COUNT,
  type CrashDumpRecord,
  type CrashProcessType,
} from "./types.js";

export const LOCAL_CRASH_REPORTER = Object.freeze({
  productName: "EF Harness",
  uploadToServer: false as const,
  compress: true,
});

const PROCESS_TYPES = new Set<CrashProcessType>(["main", "renderer", "daemon", "converter"]);

export interface CrashDumpIndexerOptions {
  readonly electronDumpDir: string;
  readonly daemonCrashDir: string;
  readonly uploadToServer: boolean;
  readonly maxDumps?: number;
  readonly maxBytes?: number;
}

export class CrashDumpIndexer {
  private readonly maxDumps: number;
  private readonly maxBytes: number;

  constructor(private readonly options: CrashDumpIndexerOptions) {
    if (options.uploadToServer !== false) {
      throw new Error("crash dumps stay on this PC; uploadToServer must be false");
    }
    this.maxDumps = options.maxDumps ?? CRASH_DUMP_MAX_COUNT;
    this.maxBytes = options.maxBytes ?? CRASH_DUMP_MAX_BYTES;
  }

  index(): readonly CrashDumpRecord[] {
    const found = [
      ...readDumpDir(this.options.electronDumpDir, "main"),
      ...readDumpDir(this.options.daemonCrashDir, "daemon"),
    ].sort((left, right) => right.occurredAt - left.occurredAt || right.fileName.localeCompare(left.fileName));
    const kept: CrashDumpRecord[] = [];
    let bytes = 0;
    for (const record of found) {
      const fullPath = join(record.directory, record.fileName);
      if (kept.length >= this.maxDumps || bytes + record.fileSizeBytes > this.maxBytes) {
        rmSync(fullPath, { force: true });
        const sidecar = `${fullPath}.json`;
        rmSync(sidecar, { force: true });
        continue;
      }
      bytes += record.fileSizeBytes;
      kept.push(toPublic(record));
    }
    return kept;
  }
}

interface InternalDump extends CrashDumpRecord {
  readonly directory: string;
}

function readDumpDir(directory: string, fallback: CrashProcessType): InternalDump[] {
  let names: string[] = [];
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }
  const dumps: InternalDump[] = [];
  for (const fileName of names) {
    if (fileName.endsWith(".json")) continue;
    const fullPath = join(directory, fileName);
    let size = 0;
    let mtimeMs = 0;
    try {
      const stat = statSync(fullPath);
      if (!stat.isFile()) continue;
      size = stat.size;
      mtimeMs = stat.mtimeMs;
    } catch {
      continue;
    }
    const sidecar = readSidecar(fullPath);
    const header = sidecar ? null : readHeader(fullPath);
    const processType = sidecar?.processType ?? header?.processType ?? processFromName(fileName) ?? fallback;
    dumps.push({
      directory,
      dumpId: sidecar?.dumpId ?? fileName,
      processType,
      occurredAt: sidecar?.occurredAt ?? header?.occurredAt ?? mtimeMs,
      appVersion: sidecar?.appVersion ?? header?.appVersion ?? "unknown",
      signalOrExitCode: sidecar?.signalOrExitCode ?? header?.signalOrExitCode ?? "unknown",
      summaryStack: sidecar?.summaryStack ?? header?.summaryStack ?? "binary minidump",
      fileSizeBytes: size,
      fileName,
    });
  }
  return dumps;
}

interface SidecarFields {
  readonly dumpId?: string;
  readonly processType?: CrashProcessType;
  readonly occurredAt?: number;
  readonly appVersion?: string;
  readonly signalOrExitCode?: string;
  readonly summaryStack?: string;
}

function readSidecar(fullPath: string): SidecarFields | null {
  try {
    const parsed = JSON.parse(readFileSync(`${fullPath}.json`, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const processType = record.processType;
    return {
      ...(typeof record.dumpId === "string" ? { dumpId: record.dumpId } : {}),
      ...(typeof processType === "string" && PROCESS_TYPES.has(processType as CrashProcessType)
        ? { processType: processType as CrashProcessType }
        : {}),
      ...(typeof record.occurredAt === "number" ? { occurredAt: record.occurredAt } : {}),
      ...(typeof record.appVersion === "string" ? { appVersion: record.appVersion } : {}),
      ...(typeof record.signalOrExitCode === "string" || typeof record.signalOrExitCode === "number"
        ? { signalOrExitCode: String(record.signalOrExitCode) }
        : {}),
      ...(typeof record.summaryStack === "string" ? { summaryStack: record.summaryStack } : {}),
    };
  } catch {
    return null;
  }
}

function readHeader(fullPath: string): SidecarFields | null {
  let text = "";
  let fd: number | null = null;
  try {
    fd = openSync(fullPath, "r");
    const buffer = Buffer.alloc(1024);
    const count = readSync(fd, buffer, 0, buffer.length, 0);
    text = buffer.subarray(0, count).toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
  if (!text.startsWith("EF-CRASH")) return null;
  const [first, ...rest] = text.split(/\r?\n/);
  const line = first ?? "";
  const processType = matchField(line, "processType");
  const appVersion = matchField(line, "appVersion");
  const signalOrExitCode = matchField(line, "signal");
  const summary = rest.join("\n").trim();
  return {
    ...(processType && PROCESS_TYPES.has(processType as CrashProcessType)
      ? { processType: processType as CrashProcessType }
      : {}),
    ...(appVersion ? { appVersion } : {}),
    ...(signalOrExitCode ? { signalOrExitCode } : {}),
    ...(summary ? { summaryStack: summary } : {}),
  };
}

function matchField(line: string, key: string): string | null {
  const match = new RegExp(`${key}=([^\\s]+)`).exec(line);
  return match?.[1] ?? null;
}

function processFromName(fileName: string): CrashProcessType | null {
  const match = /^(main|renderer|daemon|converter)[-.]/i.exec(fileName);
  const value = match?.[1]?.toLowerCase();
  if (value && PROCESS_TYPES.has(value as CrashProcessType)) return value as CrashProcessType;
  return null;
}

function toPublic(record: InternalDump): CrashDumpRecord {
  return {
    dumpId: record.dumpId,
    processType: record.processType,
    occurredAt: record.occurredAt,
    appVersion: record.appVersion,
    signalOrExitCode: record.signalOrExitCode,
    summaryStack: record.summaryStack,
    fileSizeBytes: record.fileSizeBytes,
    fileName: record.fileName,
  };
}
