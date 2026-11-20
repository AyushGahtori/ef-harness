import { compareText } from "./canonical-hash.js";

export interface ManifestRecord {
  readonly filePath: string;
  readonly nodeId: string;
  readonly exportedRev: number;
  readonly contentSha256: string;
  readonly fieldsSha256: string;
  readonly proseSha256: string;
  readonly exportedAt: string;
}

export interface ViewManifest {
  readonly revision: number;
  readonly records: readonly ManifestRecord[];
}

export function serializeManifest(manifest: ViewManifest): string {
  const records = [...manifest.records].sort(
    (left, right) => compareText(left.filePath, right.filePath) || compareText(left.nodeId, right.nodeId),
  );
  const body = {
    revision: manifest.revision,
    records: records.map((record) => ({
      filePath: record.filePath,
      nodeId: record.nodeId,
      exportedRev: record.exportedRev,
      contentSha256: record.contentSha256,
      fieldsSha256: record.fieldsSha256,
      proseSha256: record.proseSha256,
      exportedAt: record.exportedAt,
    })),
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
  if (!isRecord(parsed) || typeof parsed.revision !== "number" || !Number.isFinite(parsed.revision)) return null;
  if (!Array.isArray(parsed.records)) return null;
  const records: ManifestRecord[] = [];
  for (const entry of parsed.records) {
    const record = readRecord(entry);
    if (!record) return null;
    records.push(record);
  }
  return { revision: parsed.revision, records };
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
  return { filePath, nodeId, exportedRev, contentSha256, fieldsSha256, proseSha256, exportedAt };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
