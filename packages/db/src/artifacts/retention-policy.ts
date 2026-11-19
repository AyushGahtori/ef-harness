import type { DatabaseSync } from "node:sqlite";
import type { ArtifactLogger } from "./artifact-logger.js";
import { CasBlobMissingError, type CasBlobStore, type CasHolder } from "./cas-port.js";
import { DIAGNOSTIC_RETENTION_MS, EPHEMERAL_RETENTION_MS } from "./constants.js";
import { asNumber, asNullableString, asString, withImmediate } from "./sql.js";

export interface RetentionEviction {
  readonly artifactId: string;
  readonly hash: string;
  readonly retention: "diagnostic" | "ephemeral";
  readonly reason: "retention_expired" | "storage_cap";
}

export interface StorageCapWarning {
  readonly code: "StorageCapExceeded";
  readonly severity: "high";
  readonly message: string;
  readonly liveStoredBytes: number;
  readonly capBytes: number;
  readonly preservedEvidenceBytes: number;
  readonly preservedAssetBytes: number;
}

export interface RetentionReport {
  readonly evictions: readonly RetentionEviction[];
  readonly researchExpired: number;
  readonly liveStoredBytes: number;
  readonly capBytes: number;
  readonly warning: StorageCapWarning | null;
}

interface ArtifactHead {
  readonly id: string;
  readonly hash: string;
  readonly retention: string;
  readonly createdAt: number;
}

const NOT_SIDECAR = `a.id NOT IN (SELECT line_index FROM artifacts WHERE line_index IS NOT NULL)`;

export function researchHolderId(packageName: string, versionRange: string, docUrl: string): string {
  return `research:${packageName}:${versionRange}:${docUrl}`;
}

export function enforceRetention(input: {
  readonly stateDb: DatabaseSync;
  readonly globalDb: DatabaseSync;
  readonly cas: CasBlobStore;
  readonly projectHolder: CasHolder;
  readonly now: number;
  readonly capBytes: number;
  readonly currentPackageVersions: Readonly<Record<string, string>> | null;
  readonly logger: ArtifactLogger;
}): RetentionReport {
  const evictions: RetentionEviction[] = [];
  const researchExpired = expireResearch(input);

  for (const row of listExpiredDiagnostics(input.stateDb, input.now)) {
    evictions.push(evict(input, row, "retention_expired"));
  }

  while (input.cas.totalPinnedStoredBytes() > input.capBytes) {
    const oldest = oldestDiagnostic(input.stateDb);
    if (!oldest) break;
    evictions.push(evict(input, oldest, "storage_cap"));
  }

  for (const row of listExpiredEphemeral(input.stateDb, input.now)) {
    evictions.push(evict(input, row, "retention_expired"));
  }

  const liveStoredBytes = input.cas.totalPinnedStoredBytes();
  const preservedEvidenceBytes = sumRetentionBytes(input, "evidence");
  const preservedAssetBytes = sumRetentionBytes(input, "asset");
  let warning: StorageCapWarning | null = null;
  if (liveStoredBytes > input.capBytes) {
    warning = {
      code: "StorageCapExceeded",
      severity: "high",
      message:
        `Storage cap exceeded: ${String(liveStoredBytes)} bytes are stored and the cap is ${String(input.capBytes)} bytes. ` +
        `Evidence (${String(preservedEvidenceBytes)} bytes) and asset (${String(preservedAssetBytes)} bytes) pins were kept. ` +
        "Open Settings → Storage to choose what can be cleaned.",
      liveStoredBytes,
      capBytes: input.capBytes,
      preservedEvidenceBytes,
      preservedAssetBytes,
    };
    input.logger.log({
      level: "warn",
      code: warning.code,
      message: warning.message,
      details: {
        liveStoredBytes,
        capBytes: input.capBytes,
        preservedEvidenceBytes,
        preservedAssetBytes,
      },
    });
  }

  return {
    evictions,
    researchExpired,
    liveStoredBytes,
    capBytes: input.capBytes,
    warning,
  };
}

function expireResearch(input: {
  readonly globalDb: DatabaseSync;
  readonly cas: CasBlobStore;
  readonly now: number;
  readonly currentPackageVersions: Readonly<Record<string, string>> | null;
}): number {
  const rows = input.globalDb
    .prepare(
      "SELECT package, version_range, doc_url, artifact_hash, expires_at FROM research_cache",
    )
    .all();
  let expired = 0;
  for (const row of rows) {
    const packageName = asString(row.package, "research_cache.package");
    const versionRange = asString(row.version_range, "research_cache.version_range");
    const docUrl = asString(row.doc_url, "research_cache.doc_url");
    const hash = asString(row.artifact_hash, "research_cache.artifact_hash");
    const expiresAt = asNumber(row.expires_at, "research_cache.expires_at");
    const current = input.currentPackageVersions?.[packageName];
    const versionChanged = current !== undefined && current !== versionRange;
    if (expiresAt > input.now && !versionChanged) continue;
    input.globalDb
      .prepare(
        "DELETE FROM research_cache WHERE package = ? AND version_range = ? AND doc_url = ?",
      )
      .run(packageName, versionRange, docUrl);
    input.cas.unpinHolder(hash, {
      holderKind: "research",
      holderId: researchHolderId(packageName, versionRange, docUrl),
    });
    expired += 1;
  }
  return expired;
}

function listExpiredDiagnostics(stateDb: DatabaseSync, now: number): ArtifactHead[] {
  const cutoff = now - DIAGNOSTIC_RETENTION_MS;
  return stateDb
    .prepare(
      `SELECT a.id, a.hash, a.retention, a.created_at
         FROM artifacts a
        WHERE a.retention = 'diagnostic'
          AND ${NOT_SIDECAR}
          AND (
            (
              EXISTS (
                SELECT 1 FROM artifact_refs r
                 WHERE r.artifact = a.id AND r.owner_kind = 'attempt'
              )
              AND NOT EXISTS (
                SELECT 1 FROM artifact_refs r
                  JOIN attempts t ON t.id = r.owner_id
                 WHERE r.artifact = a.id
                   AND r.owner_kind = 'attempt'
                   AND (t.ended_at IS NULL OR t.ended_at > ?)
              )
            )
            OR (
              NOT EXISTS (
                SELECT 1 FROM artifact_refs r
                 WHERE r.artifact = a.id AND r.owner_kind = 'attempt'
              )
              AND a.created_at <= ?
            )
          )
        ORDER BY a.created_at ASC, a.id ASC`,
    )
    .all(cutoff, cutoff)
    .map(readHead);
}

function listExpiredEphemeral(stateDb: DatabaseSync, now: number): ArtifactHead[] {
  const cutoff = now - EPHEMERAL_RETENTION_MS;
  return stateDb
    .prepare(
      `SELECT a.id, a.hash, a.retention, a.created_at
         FROM artifacts a
        WHERE a.retention = 'ephemeral'
          AND a.created_at <= ?
          AND ${NOT_SIDECAR}
        ORDER BY a.created_at ASC, a.id ASC`,
    )
    .all(cutoff)
    .map(readHead);
}

function oldestDiagnostic(stateDb: DatabaseSync): ArtifactHead | null {
  const row = stateDb
    .prepare(
      `SELECT a.id, a.hash, a.retention, a.created_at
         FROM artifacts a
        WHERE a.retention = 'diagnostic'
          AND ${NOT_SIDECAR}
        ORDER BY a.created_at ASC, a.id ASC
        LIMIT 1`,
    )
    .get();
  return row ? readHead(row) : null;
}

function evict(
  input: {
    readonly stateDb: DatabaseSync;
    readonly cas: CasBlobStore;
    readonly projectHolder: CasHolder;
  },
  row: ArtifactHead,
  reason: RetentionEviction["reason"],
): RetentionEviction {
  if (row.retention === "evidence" || row.retention === "asset") {
    throw new Error(`Refusing to evict ${row.retention} artifact ${row.id}.`);
  }
  const retention = row.retention === "ephemeral" ? "ephemeral" : "diagnostic";
  const hashes = withImmediate(input.stateDb, () => deleteArtifactTree(input.stateDb, row.id));
  for (const hash of hashes) {
    const left = input.stateDb.prepare("SELECT count(*) AS c FROM artifacts WHERE hash = ?").get(hash);
    if (!left || asNumber(left.c, "count") === 0) {
      input.cas.unpinHolder(hash, input.projectHolder);
    }
  }
  return { artifactId: row.id, hash: row.hash, retention, reason };
}

export function deleteArtifactTree(stateDb: DatabaseSync, artifactId: string): string[] {
  const root = stateDb.prepare("SELECT hash, line_index FROM artifacts WHERE id = ?").get(artifactId);
  if (!root) return [];
  const ids = [artifactId];
  const sidecar = asNullableString(root.line_index);
  if (sidecar && sidecar !== artifactId) ids.push(sidecar);
  const hashes: string[] = [];
  for (const id of ids) {
    const row = stateDb.prepare("SELECT hash FROM artifacts WHERE id = ?").get(id);
    if (!row) continue;
    hashes.push(asString(row.hash, "artifacts.hash"));
    stateDb.prepare("DELETE FROM artifact_refs WHERE artifact = ?").run(id);
    stateDb.prepare("DELETE FROM module_cards WHERE artifact = ?").run(id);
    stateDb.prepare("DELETE FROM turn_log_archives WHERE artifact = ?").run(id);
    stateDb.prepare("DELETE FROM artifacts WHERE id = ?").run(id);
  }
  return hashes;
}

function readHead(row: Record<string, import("node:sqlite").SQLOutputValue>): ArtifactHead {
  return {
    id: asString(row.id, "artifacts.id"),
    hash: asString(row.hash, "artifacts.hash"),
    retention: asString(row.retention, "artifacts.retention"),
    createdAt: asNumber(row.created_at, "artifacts.created_at"),
  };
}

function sumRetentionBytes(
  input: { readonly stateDb: DatabaseSync; readonly cas: CasBlobStore },
  retention: "evidence" | "asset",
): number {
  const rows = input.stateDb
    .prepare("SELECT DISTINCT hash FROM artifacts WHERE retention = ?")
    .all(retention);
  let total = 0;
  for (const row of rows) {
    const hash = asString(row.hash, "artifacts.hash");
    try {
      total += input.cas.readCompressed(hash).storedBytes;
    } catch (error) {
      if (!(error instanceof CasBlobMissingError)) throw error;
    }
  }
  return total;
}
