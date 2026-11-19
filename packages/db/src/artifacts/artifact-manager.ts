import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { zstdDecompressSync } from "node:zlib";
import { consoleArtifactLogger, type ArtifactLogger } from "./artifact-logger.js";
import {
  CasBlobMissingError,
  CasIntegrityMismatchError,
  type CasBlobStore,
  type CasFormat,
  type CasHolder,
} from "./cas-port.js";
import {
  DEFAULT_SCRUB_SAMPLE_SIZE,
  DEFAULT_STORAGE_CAP_BYTES,
  SEEKABLE_FRAME_BYTES,
  SEEKABLE_TEXT_THRESHOLD_BYTES,
} from "./constants.js";
import {
  ArtifactNotFoundError,
  ArtifactNotTextError,
  AssetRemovalError,
  FrameDecodeError,
  InvalidLineRangeError,
  InvalidLogQueryError,
} from "./errors.js";
import { parseLineIndex, serializeLineIndex, type LineIndex } from "./line-index.js";
import { loadCanonicalQueries, type CanonicalQueries } from "./queries.js";
import {
  deleteArtifactTree,
  enforceRetention,
  researchHolderId,
  type RetentionReport,
} from "./retention-policy.js";
import { compileSafeLogPattern } from "./safe-regex.js";
import { SeekableLogReader } from "./seekable-log-reader.js";
import { asNullableString, asNumber, asString, withImmediate } from "./sql.js";
import {
  decodeSeekableFrames,
  encodeSeekableLog,
  encodeSingleZstd,
  sha256Hex,
} from "./seekable-zstd.js";
import { TurnLogArchiver, type TurnLogArchiveResult } from "./turn-log-archiver.js";

export type ArtifactKind =
  | "log"
  | "trace"
  | "screenshot"
  | "diff"
  | "page"
  | "audio"
  | "source"
  | "asset"
  | "items";

export type ArtifactRetention = "evidence" | "diagnostic" | "ephemeral" | "asset";

export interface ArtifactOwner {
  readonly ownerKind: string;
  readonly ownerId: string;
}

export interface StoreArtifactInput {
  readonly content: string | Uint8Array;
  readonly kind: ArtifactKind;
  readonly retention: ArtifactRetention;
  readonly mime?: string;
  readonly owners?: readonly ArtifactOwner[];
}

export interface StoredArtifact {
  readonly artifactId: string;
  readonly hash: string;
  readonly bytes: number;
  readonly storedBytes: number;
  readonly format: CasFormat;
  readonly frameCount: number;
  readonly lineIndexArtifactId: string | null;
  readonly retention: ArtifactRetention;
}

export interface LogRangeResult {
  readonly lines: readonly string[];
  readonly totalLines: number;
  readonly truncated: boolean;
  readonly framesDecompressed: number;
  readonly indexSource: "sidecar" | "regenerated" | "frame-scan" | "single-frame";
}

export interface LogSearchResult {
  readonly matches: readonly { lineNumber: number; text: string }[];
  readonly truncated: boolean;
  readonly capped: boolean;
  readonly framesDecompressed: number;
}

export interface ScrubFlag {
  readonly hash: string;
  readonly artifactId: string;
  readonly reason: "regeneration_required";
}

export interface ScrubReport {
  readonly checked: readonly string[];
  readonly verified: readonly string[];
  readonly quarantined: readonly string[];
  readonly regenerationRequired: readonly ScrubFlag[];
}

export interface ArtifactManagerOptions {
  readonly stateDb: DatabaseSync;
  readonly globalDb: DatabaseSync;
  readonly cas: CasBlobStore;
  readonly projectId: string;
  readonly logger?: ArtifactLogger;
  readonly now?: () => number;
  readonly storageCapBytes?: number;
  readonly frameBytes?: number;
  readonly queries?: CanonicalQueries;
}

const TEXT_KINDS = new Set<ArtifactKind>(["log", "trace", "diff", "page", "source", "items"]);
const KINDS = new Set<ArtifactKind>([
  "log",
  "trace",
  "screenshot",
  "diff",
  "page",
  "audio",
  "source",
  "asset",
  "items",
]);
const RETENTIONS = new Set<ArtifactRetention>(["evidence", "diagnostic", "ephemeral", "asset"]);

interface ArtifactRecord {
  readonly id: string;
  readonly hash: string;
  readonly kind: string;
  readonly retention: ArtifactRetention;
  readonly lineIndex: string | null;
  readonly createdAt: number;
}

/**
 * Seekable log storage, retention, integrity scrub, and closed-attempt turn_log archival.
 * Blob bytes are written through the injected CasBlobStore (Task 028). State rows live in
 * the project database (Task 013) and research pins live in the global database (Task 014).
 */
export class ArtifactManager {
  readonly logReader = new SeekableLogReader();
  private readonly stateDb: DatabaseSync;
  private readonly globalDb: DatabaseSync;
  private readonly cas: CasBlobStore;
  private readonly projectHolder: CasHolder;
  private readonly logger: ArtifactLogger;
  private readonly nowFn: () => number;
  private readonly storageCapBytes: number;
  private readonly frameBytes: number;
  private readonly queries: CanonicalQueries;
  private readonly archiver: TurnLogArchiver;

  constructor(options: ArtifactManagerOptions) {
    if (!options.projectId) throw new Error("ArtifactManager requires a projectId.");
    if (options.frameBytes !== undefined && (options.frameBytes < 4 || options.frameBytes > 4 * 1024 * 1024)) {
      throw new Error("frameBytes must be between 4 bytes and 4MB.");
    }
    this.stateDb = options.stateDb;
    this.globalDb = options.globalDb;
    this.cas = options.cas;
    this.projectHolder = { holderKind: "project", holderId: options.projectId };
    this.logger = options.logger ?? consoleArtifactLogger();
    this.nowFn = options.now ?? (() => Date.now());
    this.storageCapBytes = options.storageCapBytes ?? DEFAULT_STORAGE_CAP_BYTES;
    this.frameBytes = options.frameBytes ?? SEEKABLE_FRAME_BYTES;
    this.queries = options.queries ?? loadCanonicalQueries();
    this.archiver = new TurnLogArchiver({
      stateDb: this.stateDb,
      queries: this.queries,
      now: () => this.nowFn(),
      storeText: (input) => {
        const stored = this.storeArtifact(input);
        return { artifactId: stored.artifactId, hash: stored.hash };
      },
    });
  }

  storeArtifact(input: StoreArtifactInput): StoredArtifact {
    if (!KINDS.has(input.kind)) throw new Error(`Unknown artifact kind ${input.kind}.`);
    if (!RETENTIONS.has(input.retention)) throw new Error(`Unknown artifact retention ${input.retention}.`);
    const uncompressed =
      typeof input.content === "string" ? Buffer.from(input.content, "utf8") : Buffer.from(input.content);
    const text = textOf(input.kind, input.content, uncompressed);
    const createdAt = this.nowFn();
    const mime =
      input.mime ??
      (text === null ? "application/octet-stream" : "text/plain; charset=utf-8");
    const framed =
      text !== null && uncompressed.length > SEEKABLE_TEXT_THRESHOLD_BYTES
        ? encodeSeekableLog(text, this.frameBytes)
        : null;
    const storedPayload = framed ? framed.stored : encodeSingleZstd(uncompressed);
    const format: CasFormat = framed ? "zstd-seekable" : "zstd";
    const indexBytes = framed ? serializeLineIndex(framed.index) : null;
    const written = this.cas.putBlob({
      uncompressed,
      storedPayload,
      format,
      holder: this.projectHolder,
      createdAt,
    });
    const owners = input.owners ?? [];
    try {
      return withImmediate(this.stateDb, () => {
        let lineIndexArtifactId: string | null = null;
        if (framed && indexBytes) {
          lineIndexArtifactId = this.insertEncoded({
            uncompressed: indexBytes,
            storedPayload: encodeSingleZstd(indexBytes),
            format: "zstd",
            kind: "items",
            mime: "application/vnd.ef-harness.line-index+json",
            retention: input.retention,
            lineIndex: null,
            createdAt,
            owners: [...owners, { ownerKind: "line-index-of", ownerId: "pending" }],
          }).artifactId;
        }
        const parent = this.insertRow({
          hash: written.hash,
          bytes: written.bytes,
          kind: input.kind,
          mime,
          retention: input.retention,
          lineIndex: lineIndexArtifactId,
          createdAt,
          owners,
        });
        if (lineIndexArtifactId) {
          this.stateDb
            .prepare("UPDATE artifact_refs SET owner_id = ? WHERE artifact = ? AND owner_kind = ? AND owner_id = ?")
            .run(parent.artifactId, lineIndexArtifactId, "line-index-of", "pending");
        }
        return {
          artifactId: parent.artifactId,
          hash: written.hash,
          bytes: written.bytes,
          storedBytes: written.storedBytes,
          format,
          frameCount: framed ? framed.frames.length : 1,
          lineIndexArtifactId,
          retention: input.retention,
        };
      });
    } catch (error) {
      this.releaseHashIfUnreferenced(written.hash);
      if (indexBytes) this.releaseHashIfUnreferenced(sha256Hex(indexBytes));
      throw error;
    }
  }

  readLogRange(
    artifactId: string,
    startLine: number,
    endLine: number,
    options?: { readonly regenerateMissingIndex?: boolean },
  ): LogRangeResult {
    assertLineRange(startLine, endLine);
    const artifact = this.requireArtifact(artifactId);
    assertTextKind(artifact);
    const blob = this.readBlob(artifact.hash);
    const loaded = this.loadLineIndex(artifact, blob.format);
    let index = loaded.index;
    let indexSource: LogRangeResult["indexSource"] =
      blob.format === "zstd-seekable" ? (index ? "sidecar" : "frame-scan") : "single-frame";
    try {
      const read = this.logReader.readRange({
        stored: blob.storedPayload,
        format: blob.format,
        index,
        startLine,
        endLine,
      });
      if (
        blob.format === "zstd-seekable" &&
        index === null &&
        read.rebuiltIndex &&
        (options?.regenerateMissingIndex ?? true)
      ) {
        this.persistLineIndex(artifact, read.rebuiltIndex);
        indexSource = "regenerated";
        index = read.rebuiltIndex;
      }
      return {
        lines: read.lines,
        totalLines: read.totalLines,
        truncated: false,
        framesDecompressed: read.framesDecompressed,
        indexSource,
      };
    } catch (error) {
      this.rethrowFrameFailure(artifact.hash, error);
    }
  }

  queryLogStream(
    artifactId: string,
    pattern: string,
    maxMatches: number,
    options?: { readonly byteBudget?: number; readonly timeBudgetMs?: number },
  ): LogSearchResult {
    if (!Number.isInteger(maxMatches) || maxMatches < 1) {
      throw new InvalidLogQueryError("maxMatches must be a positive integer.");
    }
    const compiled = compileSafeLogPattern(pattern);
    const artifact = this.requireArtifact(artifactId);
    assertTextKind(artifact);
    const blob = this.readBlob(artifact.hash);
    try {
      const found = this.logReader.query({
        stored: blob.storedPayload,
        format: blob.format,
        pattern: compiled,
        maxMatches,
        ...(options?.byteBudget !== undefined ? { byteBudget: options.byteBudget } : {}),
        ...(options?.timeBudgetMs !== undefined ? { timeBudgetMs: options.timeBudgetMs } : {}),
      });
      return found;
    } catch (error) {
      this.rethrowFrameFailure(artifact.hash, error);
    }
  }

  enforceRetentionAndStorageCap(options?: {
    readonly now?: number;
    readonly storageCapBytes?: number;
    readonly currentPackageVersions?: Readonly<Record<string, string>>;
  }): RetentionReport {
    return enforceRetention({
      stateDb: this.stateDb,
      globalDb: this.globalDb,
      cas: this.cas,
      projectHolder: this.projectHolder,
      now: options?.now ?? this.nowFn(),
      capBytes: options?.storageCapBytes ?? this.storageCapBytes,
      currentPackageVersions: options?.currentPackageVersions ?? null,
      logger: this.logger,
    });
  }

  runWeeklyIntegrityScrub(options?: { readonly sampleSize?: number; readonly now?: number }): ScrubReport {
    const now = options?.now ?? this.nowFn();
    const sampleSize = options?.sampleSize ?? DEFAULT_SCRUB_SAMPLE_SIZE;
    const evidence = new Set(
      this.stateDb
        .prepare("SELECT hash FROM artifacts WHERE retention = 'evidence'")
        .all()
        .map((row) => asString(row.hash, "artifacts.hash")),
    );
    const candidates = this.cas
      .listVerificationCandidates()
      .filter((candidate) => !evidence.has(candidate.hash))
      .slice(0, sampleSize);
    const checked: string[] = [];
    const verified: string[] = [];
    const quarantined: string[] = [];
    const regenerationRequired: ScrubFlag[] = [];
    for (const candidate of candidates) {
      checked.push(candidate.hash);
      const verdict = this.cas.verifyBlobIntegrity(candidate.hash);
      if (verdict.ok) {
        this.cas.markVerified(candidate.hash, now);
        verified.push(candidate.hash);
        continue;
      }
      this.cas.quarantineBlob(candidate.hash);
      quarantined.push(candidate.hash);
      for (const artifactId of this.artifactsDependingOn(candidate.hash)) {
        regenerationRequired.push({
          hash: candidate.hash,
          artifactId,
          reason: "regeneration_required",
        });
        this.logger.log({
          level: "warn",
          code: "ArtifactRegenerationRequired",
          message: `Quarantined blob ${candidate.hash} and flagged artifact ${artifactId} for regeneration.`,
          details: { hash: candidate.hash, artifactId },
        });
      }
    }
    return { checked, verified, quarantined, regenerationRequired };
  }

  archiveClosedAttemptTurnLog(attemptId: string): TurnLogArchiveResult {
    return this.archiver.archiveClosedAttemptTurnLog(attemptId);
  }

  promoteAttemptEvidence(attemptId: string): { readonly artifactIds: readonly string[] } {
    const cited = this.citedArtifactIds(attemptId);
    if (cited.length === 0) return { artifactIds: [] };
    withImmediate(this.stateDb, () => {
      for (const id of cited) {
        this.stateDb
          .prepare("UPDATE artifacts SET retention = 'evidence' WHERE id = ? AND retention != 'evidence'")
          .run(id);
      }
    });
    return { artifactIds: cited };
  }

  removeDeveloperAsset(artifactId: string): void {
    const artifact = this.requireArtifact(artifactId);
    if (artifact.retention !== "asset") {
      throw new AssetRemovalError(
        artifactId,
        `Artifact ${artifactId} is ${artifact.retention}. Only asset pins are removed when the developer deletes them.`,
      );
    }
    const hashes = withImmediate(this.stateDb, () => deleteArtifactTree(this.stateDb, artifactId));
    for (const hash of hashes) this.releaseHashIfUnreferenced(hash);
  }

  storeResearchDocument(input: {
    readonly packageName: string;
    readonly versionRange: string;
    readonly docUrl: string;
    readonly pageVersion?: string | null;
    readonly content: string | Uint8Array;
    readonly fetchedAt: number;
    readonly expiresAt: number;
  }): { readonly hash: string } {
    const uncompressed =
      typeof input.content === "string" ? Buffer.from(input.content, "utf8") : Buffer.from(input.content);
    const text = typeof input.content === "string" ? input.content : decodeUtf8(uncompressed);
    const framed =
      text !== null && uncompressed.length > SEEKABLE_TEXT_THRESHOLD_BYTES
        ? encodeSeekableLog(text, this.frameBytes)
        : null;
    const holder: CasHolder = {
      holderKind: "research",
      holderId: researchHolderId(input.packageName, input.versionRange, input.docUrl),
    };
    const existing = this.globalDb
      .prepare(
        "SELECT artifact_hash FROM research_cache WHERE package = ? AND version_range = ? AND doc_url = ?",
      )
      .get(input.packageName, input.versionRange, input.docUrl);
    const written = this.cas.putBlob({
      uncompressed,
      storedPayload: framed ? framed.stored : encodeSingleZstd(uncompressed),
      format: framed ? "zstd-seekable" : "zstd",
      holder,
      createdAt: input.fetchedAt,
    });
    this.globalDb
      .prepare(
        `INSERT INTO research_cache(package, version_range, doc_url, page_version, artifact_hash, fetched_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(package, version_range, doc_url) DO UPDATE SET
           page_version = excluded.page_version,
           artifact_hash = excluded.artifact_hash,
           fetched_at = excluded.fetched_at,
           expires_at = excluded.expires_at`,
      )
      .run(
        input.packageName,
        input.versionRange,
        input.docUrl,
        input.pageVersion ?? null,
        written.hash,
        input.fetchedAt,
        input.expiresAt,
      );
    const previous = existing ? asString(existing.artifact_hash, "research_cache.artifact_hash") : null;
    if (previous && previous !== written.hash) this.cas.unpinHolder(previous, holder);
    return { hash: written.hash };
  }

  private insertEncoded(input: {
    readonly uncompressed: Buffer;
    readonly storedPayload: Buffer;
    readonly format: CasFormat;
    readonly kind: ArtifactKind;
    readonly mime: string;
    readonly retention: ArtifactRetention;
    readonly lineIndex: string | null;
    readonly createdAt: number;
    readonly owners: readonly ArtifactOwner[];
  }): { readonly artifactId: string; readonly hash: string } {
    const written = this.cas.putBlob({
      uncompressed: input.uncompressed,
      storedPayload: input.storedPayload,
      format: input.format,
      holder: this.projectHolder,
      createdAt: input.createdAt,
    });
    const row = this.insertRow({
      hash: written.hash,
      bytes: written.bytes,
      kind: input.kind,
      mime: input.mime,
      retention: input.retention,
      lineIndex: input.lineIndex,
      createdAt: input.createdAt,
      owners: input.owners,
    });
    return row;
  }

  private insertRow(input: {
    readonly hash: string;
    readonly bytes: number;
    readonly kind: ArtifactKind;
    readonly mime: string;
    readonly retention: ArtifactRetention;
    readonly lineIndex: string | null;
    readonly createdAt: number;
    readonly owners: readonly ArtifactOwner[];
  }): { readonly artifactId: string; readonly hash: string } {
    const artifactId = `art_${randomBytes(12).toString("hex")}`;
    this.stateDb
      .prepare(
        `INSERT INTO artifacts(id, hash, kind, bytes, mime, retention, line_index, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifactId,
        input.hash,
        input.kind,
        input.bytes,
        input.mime,
        input.retention,
        input.lineIndex,
        input.createdAt,
      );
    for (const owner of input.owners) {
      this.stateDb
        .prepare("INSERT INTO artifact_refs(artifact, owner_kind, owner_id) VALUES (?, ?, ?)")
        .run(artifactId, owner.ownerKind, owner.ownerId);
    }
    return { artifactId, hash: input.hash };
  }

  private persistLineIndex(artifact: ArtifactRecord, index: LineIndex): void {
    const bytes = serializeLineIndex(index);
    const owners = this.stateDb
      .prepare("SELECT owner_kind, owner_id FROM artifact_refs WHERE artifact = ?")
      .all(artifact.id)
      .map((row) => ({
        ownerKind: asString(row.owner_kind, "artifact_refs.owner_kind"),
        ownerId: asString(row.owner_id, "artifact_refs.owner_id"),
      }));
    const sidecar = this.insertEncoded({
      uncompressed: bytes,
      storedPayload: encodeSingleZstd(bytes),
      format: "zstd",
      kind: "items",
      mime: "application/vnd.ef-harness.line-index+json",
      retention: artifact.retention,
      lineIndex: null,
      createdAt: this.nowFn(),
      owners: [...owners, { ownerKind: "line-index-of", ownerId: artifact.id }],
    });
    this.stateDb.prepare("UPDATE artifacts SET line_index = ? WHERE id = ?").run(sidecar.artifactId, artifact.id);
    this.logger.log({
      level: "info",
      code: "LineIndexRegenerated",
      message: `Regenerated the sidecar line index for artifact ${artifact.id}.`,
      details: { artifactId: artifact.id, lineIndexArtifactId: sidecar.artifactId },
    });
  }

  private loadLineIndex(
    artifact: ArtifactRecord,
    format: CasFormat,
  ): { readonly index: LineIndex | null } {
    if (format !== "zstd-seekable") return { index: null };
    const missing = (message: string): { index: null } => {
      this.logger.log({
        level: "warn",
        code: "LineIndexMissing",
        message,
        details: { artifactId: artifact.id, lineIndex: artifact.lineIndex },
      });
      return { index: null };
    };
    if (!artifact.lineIndex) {
      return missing(`Artifact ${artifact.id} has no sidecar line index. Scanning frames from the start.`);
    }
    const sidecar = this.stateDb.prepare("SELECT hash FROM artifacts WHERE id = ?").get(artifact.lineIndex);
    if (!sidecar) {
      return missing(`Sidecar ${artifact.lineIndex} for artifact ${artifact.id} is gone. Scanning frames from the start.`);
    }
    try {
      const blob = this.cas.readCompressed(asString(sidecar.hash, "artifacts.hash"));
      return { index: parseLineIndex(decodeStored(blob.format, blob.storedPayload)) };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unreadable sidecar";
      return missing(`Sidecar for artifact ${artifact.id} could not be read (${reason}). Scanning frames from the start.`);
    }
  }

  private requireArtifact(artifactId: string): ArtifactRecord {
    const row = this.stateDb
      .prepare("SELECT id, hash, kind, retention, line_index, created_at FROM artifacts WHERE id = ?")
      .get(artifactId);
    if (!row) throw new ArtifactNotFoundError(artifactId);
    const retention = asString(row.retention, "artifacts.retention");
    if (!RETENTIONS.has(retention as ArtifactRetention)) {
      throw new Error(`Artifact ${artifactId} has unknown retention ${retention}.`);
    }
    return {
      id: asString(row.id, "artifacts.id"),
      hash: asString(row.hash, "artifacts.hash"),
      kind: asString(row.kind, "artifacts.kind"),
      retention: retention as ArtifactRetention,
      lineIndex: asNullableString(row.line_index),
      createdAt: asNumber(row.created_at, "artifacts.created_at"),
    };
  }

  private readBlob(hash: string): ReturnType<CasBlobStore["readCompressed"]> {
    try {
      const blob = this.cas.readCompressed(hash);
      if (blob.state === "quarantined") {
        throw new CasIntegrityMismatchError(hash, `CAS blob ${hash} is quarantined.`);
      }
      return blob;
    } catch (error) {
      if (error instanceof CasBlobMissingError || error instanceof CasIntegrityMismatchError) throw error;
      throw new CasBlobMissingError(hash);
    }
  }

  private rethrowFrameFailure(hash: string, error: unknown): never {
    if (error instanceof FrameDecodeError) {
      this.cas.quarantineBlob(hash);
      throw new CasIntegrityMismatchError(hash, error.message);
    }
    throw error;
  }

  private releaseHashIfUnreferenced(hash: string): void {
    const left = this.stateDb.prepare("SELECT count(*) AS c FROM artifacts WHERE hash = ?").get(hash);
    if (!left || asNumber(left.c, "count") === 0) this.cas.unpinHolder(hash, this.projectHolder);
  }

  private citedArtifactIds(attemptId: string): string[] {
    const rows = this.stateDb
      .prepare(
        `SELECT id FROM (
           SELECT artifact AS id FROM artifact_refs WHERE owner_kind = 'attempt' AND owner_id = ?
           UNION
           SELECT artifact AS id FROM artifact_refs
            WHERE owner_kind = 'candidate'
              AND owner_id IN (SELECT id FROM candidates WHERE attempt = ?)
           UNION
           SELECT items_artifact AS id FROM turn_log WHERE attempt = ? AND items_artifact IS NOT NULL
           UNION
           SELECT result_artifact AS id FROM turn_log WHERE attempt = ? AND result_artifact IS NOT NULL
           UNION
           SELECT a.id AS id FROM artifacts a
             JOIN check_results cr ON cr.artifact_digest = a.hash
            WHERE cr.attempt = ?
         )`,
      )
      .all(attemptId, attemptId, attemptId, attemptId, attemptId);
    const ids = new Set<string>();
    for (const row of rows) {
      const id = asString(row.id, "artifact id");
      ids.add(id);
      const sidecar = this.stateDb.prepare("SELECT line_index FROM artifacts WHERE id = ?").get(id);
      const lineIndex = sidecar ? asNullableString(sidecar.line_index) : null;
      if (lineIndex) ids.add(lineIndex);
    }
    return [...ids];
  }

  private artifactsDependingOn(hash: string): string[] {
    const direct = this.stateDb.prepare("SELECT id FROM artifacts WHERE hash = ?").all(hash);
    const viaIndex = this.stateDb
      .prepare(
        `SELECT parent.id AS id FROM artifacts parent
           JOIN artifacts side ON side.id = parent.line_index
          WHERE side.hash = ?`,
      )
      .all(hash);
    const ids = new Set<string>();
    for (const row of [...direct, ...viaIndex]) ids.add(asString(row.id, "artifacts.id"));
    return [...ids];
  }
}

export function assertLineRange(startLine: number, endLine: number): void {
  if (
    !Number.isInteger(startLine) ||
    !Number.isInteger(endLine) ||
    startLine < 1 ||
    endLine < 1 ||
    endLine < startLine
  ) {
    throw new InvalidLineRangeError(startLine, endLine);
  }
}

function assertTextKind(artifact: ArtifactRecord): void {
  if (artifact.kind === "screenshot" || artifact.kind === "audio") {
    throw new ArtifactNotTextError(artifact.id);
  }
}

function textOf(kind: ArtifactKind, content: string | Uint8Array, uncompressed: Buffer): string | null {
  if (typeof content === "string") return content;
  if (!TEXT_KINDS.has(kind) && kind !== "asset") return null;
  return decodeUtf8(uncompressed);
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function decodeStored(format: CasFormat, stored: Uint8Array): Buffer {
  if (format === "raw") return Buffer.from(stored);
  if (format === "zstd") {
    return Buffer.from(zstdDecompressSync(stored, { maxOutputLength: 8 * 1024 * 1024 }));
  }
  return Buffer.concat(decodeSeekableFrames(stored));
}

export { sha256Hex };
