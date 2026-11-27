import { asPrefixedSha256 } from "../views-shared/digest.js";
import { compareText } from "./canonical-hash.js";

export interface ManifestRecord {
  readonly filePath: string;
  readonly nodeId: string;
  readonly exportedRev: number;
  readonly contentSha256: string;
  readonly fieldsSha256: string;
  readonly proseSha256: string;
  readonly exportedAt: string;
  /** Opener `base_hash` for a node row. File rows omit it. */
  readonly baseHash?: string;
}

export interface ViewManifest {
  readonly revision: number;
  readonly records: readonly ManifestRecord[];
}

export function serializeManifest(manifest: ViewManifest): string {
  const records = [...manifest.records].sort(
    (left, right) => compareText(left.filePath, right.filePath) || compareText(left.nodeId, right.nodeId),
  );
  const files: Record<string, { sha256: string; nodeIds: string[] }> = {};
  for (const filePath of [...new Set(records.map((record) => record.filePath))].sort(compareText)) {
    const fileRecord = records.find((record) => record.filePath === filePath && record.nodeId === "");
    const nodeIds = records
      .filter((record) => record.filePath === filePath && record.nodeId !== "")
      .map((record) => record.nodeId)
      .sort(compareText);
    files[filePath] = { sha256: fileRecord?.contentSha256 ?? "", nodeIds };
  }
  const body = {
    schemaVersion: 1,
    exportedAt: latestExportedAt(records),
    revision: manifest.revision,
    files,
    records: records.map((record) => {
      const row = {
        filePath: record.filePath,
        nodeId: record.nodeId,
        exportedRev: record.exportedRev,
        contentSha256: record.contentSha256,
        fieldsSha256: record.fieldsSha256,
        proseSha256: record.proseSha256,
        exportedAt: record.exportedAt,
      };
      if (record.baseHash && record.baseHash.length > 0) return { ...row, baseHash: record.baseHash };
      return row;
    }),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

export function parseManifest(text: string): ViewManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (Array.isArray(parsed.records)) {
    if (typeof parsed.revision !== "number" || !Number.isFinite(parsed.revision)) return null;
    const records: ManifestRecord[] = [];
    for (const entry of parsed.records) {
      const record = readRecord(entry);
      if (!record) return null;
      records.push(record);
    }
    return { revision: parsed.revision, records };
  }
  const imported = readImportRows(parsed);
  if (imported) return imported;
  if (isRecord(parsed.files)) return manifestFromCanonical(parsed.files, parsed.exportedAt);
  return null;
}

export function fileContentHash(manifest: ViewManifest, filePath: string): string | null {
  const record = manifest.records.find((item) => item.filePath === filePath && item.nodeId === "");
  return record?.contentSha256 ?? null;
}

export function recordsForFile(manifest: ViewManifest, filePath: string): readonly ManifestRecord[] {
  return manifest.records.filter((record) => record.filePath === filePath);
}

function readRecord(value: unknown): ManifestRecord | null {
  if (!isRecord(value)) return null;
  const filePath = value.filePath;
  const nodeId = value.nodeId;
  const exportedRev = value.exportedRev;
  const contentSha256 = value.contentSha256;
  const fieldsSha256 = value.fieldsSha256;
  const proseSha256 = value.proseSha256;
  const exportedAt = value.exportedAt;
  if (typeof filePath !== "string" || typeof nodeId !== "string") return null;
  if (typeof contentSha256 !== "string" || typeof fieldsSha256 !== "string") return null;
  if (typeof proseSha256 !== "string" || typeof exportedAt !== "string") return null;
  if (typeof exportedRev !== "number" || !Number.isFinite(exportedRev)) return null;
  const baseHash = value.baseHash;
  if (typeof baseHash === "string" && baseHash.length > 0) {
    return { filePath, nodeId, exportedRev, contentSha256, fieldsSha256, proseSha256, exportedAt, baseHash };
  }
  return { filePath, nodeId, exportedRev, contentSha256, fieldsSha256, proseSha256, exportedAt };
}

function latestExportedAt(records: readonly ManifestRecord[]): number {
  let latest = 0;
  for (const record of records) {
    const parsed = Date.parse(record.exportedAt);
    if (Number.isFinite(parsed) && parsed > latest) latest = parsed;
  }
  return latest;
}

function readImportRows(parsed: Record<string, unknown>): ViewManifest | null {
  const files = Array.isArray(parsed.fileRecords) ? parsed.fileRecords : Array.isArray(parsed.files) ? parsed.files : null;
  if (!files || !Array.isArray(parsed.nodes)) return null;
  const records: ManifestRecord[] = [];
  for (const entry of files) {
    const row = readImportFile(entry);
    if (!row) return null;
    records.push(row);
  }
  for (const entry of parsed.nodes) {
    const row = readImportNode(entry);
    if (!row) return null;
    records.push(row);
  }
  const revision = records.reduce((max, record) => Math.max(max, record.exportedRev), 0);
  return { revision, records };
}

function readImportFile(value: unknown): ManifestRecord | null {
  if (!isRecord(value) || typeof value.filePath !== "string" || typeof value.contentSha256 !== "string") return null;
  if (typeof value.exportedRev !== "number" || !Number.isFinite(value.exportedRev)) return null;
  return {
    filePath: value.filePath,
    nodeId: "",
    exportedRev: value.exportedRev,
    contentSha256: asPrefixedSha256(value.contentSha256),
    fieldsSha256: asPrefixedSha256(""),
    proseSha256: asPrefixedSha256(""),
    exportedAt: epochText(value.exportedAt),
  };
}

function readImportNode(value: unknown): ManifestRecord | null {
  if (!isRecord(value) || typeof value.filePath !== "string" || typeof value.nodeId !== "string") return null;
  if (typeof value.contentSha256 !== "string") return null;
  if (typeof value.exportedRev !== "number" || !Number.isFinite(value.exportedRev)) return null;
  const fieldsSha256 = typeof value.fieldsSha256 === "string" ? value.fieldsSha256 : "";
  const proseSha256 = typeof value.proseSha256 === "string" ? value.proseSha256 : "";
  return {
    filePath: value.filePath,
    nodeId: value.nodeId,
    exportedRev: value.exportedRev,
    contentSha256: asPrefixedSha256(value.contentSha256),
    fieldsSha256: asPrefixedSha256(fieldsSha256),
    proseSha256: asPrefixedSha256(proseSha256),
    exportedAt: epochText(value.exportedAt),
    baseHash: value.contentSha256,
  };
}

function manifestFromCanonical(files: Record<string, unknown>, exportedAt: unknown): ViewManifest {
  const records: ManifestRecord[] = [];
  const stamp = epochText(exportedAt);
  for (const filePath of Object.keys(files).sort(compareText)) {
    const entry = files[filePath];
    if (!isRecord(entry) || typeof entry.sha256 !== "string" || !Array.isArray(entry.nodeIds)) continue;
    const nodeIds = entry.nodeIds.filter((id): id is string => typeof id === "string");
    records.push({
      filePath,
      nodeId: "",
      exportedRev: 0,
      contentSha256: asPrefixedSha256(entry.sha256),
      fieldsSha256: asPrefixedSha256(""),
      proseSha256: asPrefixedSha256(""),
      exportedAt: stamp,
    });
    for (const nodeId of nodeIds) {
      records.push({
        filePath,
        nodeId,
        exportedRev: 0,
        contentSha256: asPrefixedSha256(entry.sha256),
        fieldsSha256: asPrefixedSha256(""),
        proseSha256: asPrefixedSha256(""),
        exportedAt: stamp,
      });
    }
  }
  return { revision: 0, records };
}

function epochText(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  return new Date(0).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
