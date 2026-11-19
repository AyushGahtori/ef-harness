import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { canonicalizeJson, computeNodeContentHash, computeSecretHmac } from "./canonical.js";
import { artifactHashes, RawFileCasBlobStore, replaceArtifactHash, walkFiles } from "./cas-store.js";
import {
  detectSecretLabel,
  redactionPlaceholder,
  ROTATION_GUIDANCE,
  rotationUrlForLabel,
} from "./provider-rotation.js";
import {
  bufferContainsVariant,
  isTriviallyShort,
  matchingVariantKind,
  redactBuffer,
  sanitizeSensitiveText,
  secretVariants,
  textContainsVariant,
} from "./redact.js";
import { rewriteDatabaseSecret } from "./rewrite-database.js";
import {
  assertFilesClean,
  fileContainsVariant,
  scrubBackupDirectory,
  scrubLogDirectory,
  scrubTelemetryDatabase,
} from "./scrub-files.js";
import { rebuildAndOptimizeSearchIndexes, reindexNode } from "./search-maintenance.js";
import {
  applyPurgePragmas,
  assertQuickCheckClean,
  ensureSearchTextFunction,
  loadNamedQuery,
  sqlText,
  truncateWal,
} from "./sqlite-util.js";
import type {
  CasBlobStore,
  ExecuteSecretPurgeOptions,
  PurgeReceipt,
  PurgeStep,
  SecretLocationReport,
  SecretOccurrence,
  SecretPurgeEngineOptions,
  SecretVariant,
  StructuredLogSink,
} from "./types.js";
import { PurgeLockUnavailableError, SecretTooShortError } from "./types.js";
import { assertNodesVersionGuardActive } from "./version-guard.js";

const EXPORTABLE_TABLES = new Set([
  "nodes",
  "node_versions",
  "turns",
  "evidence",
  "outbox",
  "change_sets",
]);

const REMOTE_REQUIRED =
  "The secret reached a pushed harness-state branch. Remote history rewrite requires explicit developer approval. This purge will not force-push.";

const REMOTE_CLEAR = "No pushed harness-state history is recorded for this secret.";

/**
 * Eight-step sanctioned secret purge.
 * The plaintext secret is never written to logs, errors, or `redactions`.
 */
export class SecretPurgeEngine {
  private readonly casStore: CasBlobStore;
  private readonly casRoot: string;

  constructor(private readonly options: SecretPurgeEngineOptions) {
    this.casRoot = options.casRoot ?? path.join(path.dirname(options.stateDbPath), "cas");
    if (options.cas) {
      this.casStore = options.cas;
    } else if (options.globalDb) {
      this.casStore = new RawFileCasBlobStore({
        root: this.casRoot,
        globalDb: options.globalDb,
        now: () => this.now(),
      });
    } else {
      this.casStore = new RawFileCasBlobStore({
        root: this.casRoot,
        now: () => this.now(),
      });
    }
  }

  locateSecret(
    secret: string,
    locateOptions?: { readonly forceShortSecret?: boolean },
  ): SecretLocationReport {
    this.assertSecretLength(secret, locateOptions?.forceShortSecret === true);
    return this.scanSecret(secretVariants(secret));
  }

  executeSecretPurge(secret: string, executeOptions: ExecuteSecretPurgeOptions = {}): PurgeReceipt {
    this.assertSecretLength(secret, executeOptions.forceShortSecret === true);
    const variants = secretVariants(secret);
    const label = detectSecretLabel(secret, executeOptions.label);
    const placeholder = redactionPlaceholder(label);
    const fingerprint = this.options.computeSecretHmac
      ? this.options.computeSecretHmac(secret, this.options.hmacKey)
      : computeSecretHmac(secret, this.options.hmacKey);
    const sink = createGuardedLogSink(this.options.logSink ?? noopSink, variants);
    const purgeId = `RD-${randomBytes(16).toString("hex")}`;
    const completed: PurgeStep[] = [];
    const counts: Record<string, number> = {};
    let hashMapArtifact: string | null = null;
    let reachedExportableState = false;
    let pendingTargets: string[] = [];
    let failedStep: PurgeStep | null = null;
    let failureMessage: string | null = null;
    let rewriteFinished = false;
    const casReplacements = new Map<string, { hash: string; bytes: number }>();

    const partial = (step: PurgeStep, error: unknown): PurgeReceipt => {
      failedStep = step;
      failureMessage = sanitizeSensitiveText(
        error instanceof Error ? error.message : "secret purge failed",
        variants,
      );
      this.recordAudit(purgeId, fingerprint, placeholder, counts, hashMapArtifact, rewriteFinished);
      sink.write({
        level: "error",
        component: "secret-purge",
        msg: "secret purge stopped with a partial receipt",
        fields: { step, redactionId: purgeId },
      });
      return this.receipt({
        purgeId,
        label: placeholder,
        fingerprint,
        counts,
        hashMapArtifact,
        completed,
        failedStep,
        pendingTargets,
        failureMessage,
        remotePushed: executeOptions.remotePushed === true,
        reachedExportableState,
      });
    };

    try {
      this.drainReaders();
      applyPurgePragmas(this.db);
      ensureSearchTextFunction(this.db);
    } catch (error) {
      if (error instanceof PurgeLockUnavailableError) throw error;
      return partial("locate", error);
    }

    let report: SecretLocationReport;
    try {
      report = this.scanSecret(variants);
      reachedExportableState = report.reachedExportableState;
      completed.push("locate");
      sink.write({
        level: "info",
        component: "secret-purge",
        msg: "secret occurrence scan finished",
        fields: { occurrences: report.occurrences.length },
      });
    } catch (error) {
      return partial("locate", error);
    }

    try {
      const hashContent = this.options.computeNodeContentHash ?? computeNodeContentHash;
      const rewritten = rewriteDatabaseSecret(this.db, { variants, placeholder, hashContent });
      Object.assign(counts, rewritten.counts);
      hashMapArtifact = this.saveHashMap(rewritten.hashMap, purgeId);
      rewriteFinished = true;
      assertNodesVersionGuardActive(this.db);
      completed.push("rewrite");
      for (const node of rewritten.touchedNodes) reindexNode(this.db, node);
      rebuildAndOptimizeSearchIndexes(this.db);
      this.options.search?.optimizeSearchIndexes();
      this.options.search?.rebuildSearchIndexes?.();
      completed.push("fts");
      sink.write({
        level: "info",
        component: "secret-purge",
        msg: "history rewrite and search index optimize finished",
        fields: { redactionId: purgeId },
      });
    } catch (error) {
      if (error instanceof PurgeLockUnavailableError) throw error;
      return partial(rewriteFinished ? "fts" : "rewrite", error);
    }

    try {
      applyPurgePragmas(this.db);
      truncateWal(this.db);
      this.db.exec("VACUUM");
      truncateWal(this.db);
      assertQuickCheckClean(this.db);
      assertFilesClean(this.stateFiles(), variants, "state.db");
      completed.push("vacuum");
    } catch (error) {
      if (error instanceof PurgeLockUnavailableError) throw error;
      return partial("vacuum", error);
    }

    try {
      counts["cas_blobs"] = this.rewriteCasBlobs(variants, placeholder, casReplacements);
      assertCasRootClean(this.casRoot, variants);
      completed.push("cas");
    } catch (error) {
      return partial("cas", error);
    }

    if (this.options.backupsDir) {
      const beforeBackupScrub = this.options.hooks?.beforeBackupScrub;
      const backups = scrubBackupDirectory({
        directory: this.options.backupsDir,
        variants,
        placeholder,
        hashContent: this.options.computeNodeContentHash ?? computeNodeContentHash,
        casReplacements,
        ...(beforeBackupScrub ? { beforeBackupScrub } : {}),
        afterBackup: (backupPath) => {
          this.pinBackupArtifacts(backupPath);
        },
      });
      counts["backups"] = backups.scrubbed.length;
      if (backups.failureMessage) {
        pendingTargets = [...backups.pending];
        return partial("backups", new Error(backups.failureMessage));
      }
    } else {
      counts["backups"] = 0;
    }
    completed.push("backups");

    try {
      counts["telemetry"] = scrubTelemetryDatabase(this.options.telemetryDbPath, variants, placeholder);
      counts["logs"] = scrubLogDirectory(this.options.logsDir, variants, placeholder);
      if (this.options.telemetryDbPath) {
        assertFilesClean(
          [this.options.telemetryDbPath, `${this.options.telemetryDbPath}-wal`],
          variants,
          "telemetry.db",
        );
      }
      if (this.options.logsDir) assertFilesClean(listJsonl(this.options.logsDir), variants, "logs");
    } catch (error) {
      pendingTargets = [
        ...(this.options.telemetryDbPath ? [this.options.telemetryDbPath] : []),
        ...(this.options.logsDir ? [this.options.logsDir] : []),
      ];
      return partial("backups", error);
    }

    completed.push("remote_gate");
    completed.push("rotation");
    this.recordAudit(purgeId, fingerprint, placeholder, counts, hashMapArtifact, true);
    truncateWal(this.db);
    try {
      assertFilesClean(this.stateFiles(), variants, "state.db");
      assertCasRootClean(this.casRoot, variants);
    } catch (error) {
      return partial("vacuum", error);
    }
    sink.write({
      level: "info",
      component: "secret-purge",
      msg: "secret purge completed",
      fields: { redactionId: purgeId, rotationMandatory: true },
    });
    return this.receipt({
      purgeId,
      label: placeholder,
      fingerprint,
      counts,
      hashMapArtifact,
      completed,
      failedStep: null,
      pendingTargets: [],
      failureMessage: null,
      remotePushed: executeOptions.remotePushed === true,
      reachedExportableState,
    });
  }

  private get db(): DatabaseSync {
    return this.options.stateDb;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private assertSecretLength(secret: string, forceShortSecret: boolean): void {
    if (isTriviallyShort(secret) && !forceShortSecret) throw new SecretTooShortError();
  }

  private drainReaders(): void {
    const timeout = this.options.readerDrainTimeoutMs ?? 5_000;
    const drained = this.options.readers ? this.options.readers.drainReaders(timeout) : true;
    if (!drained) throw new PurgeLockUnavailableError();
  }

  private scanSecret(variants: readonly SecretVariant[]): SecretLocationReport {
    const occurrences: SecretOccurrence[] = [];
    const seen = new Set<string>();
    const add = (occurrence: SecretOccurrence): void => {
      const key = `${occurrence.location}\0${occurrence.table}\0${occurrence.ref}\0${occurrence.variant}`;
      if (seen.has(key)) return;
      seen.add(key);
      occurrences.push(occurrence);
    };
    const canonical = this.db.prepare(loadNamedQuery("secret_occurrences"));
    for (const variant of variants) {
      for (const row of canonical.all({ secret: variant.value })) {
        add({
          location: "state",
          table: sqlText(row["tbl"]),
          ref: sqlText(row["ref"]),
          variant: variant.kind,
        });
      }
    }
    this.scanStateExtras(variants, add);
    this.scanCas(variants, add);
    this.scanBackupFiles(variants, add);
    this.scanTelemetry(variants, add);
    this.scanLogs(variants, add);
    const counts: Record<string, number> = {};
    for (const occurrence of occurrences) {
      const bucket = `${occurrence.location}:${occurrence.table}`;
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
    const reachedExportableState = occurrences.some(
      (occurrence) => occurrence.location === "state" && EXPORTABLE_TABLES.has(occurrence.table),
    );
    return { occurrences, counts, reachedExportableState };
  }

  private scanStateExtras(
    variants: readonly SecretVariant[],
    add: (occurrence: SecretOccurrence) => void,
  ): void {
    const queries: readonly (readonly [string, string])[] = [
      [
        "nodes",
        "SELECT id AS ref FROM nodes WHERE instr(title, :secret) > 0 OR instr(text, :secret) > 0 OR instr(fields, :secret) > 0",
      ],
      [
        "node_versions",
        "SELECT id || '@' || version AS ref FROM node_versions WHERE instr(title, :secret) > 0 OR instr(text, :secret) > 0 OR instr(fields, :secret) > 0",
      ],
      [
        "candidates",
        "SELECT id AS ref FROM candidates WHERE instr(payload, :secret) > 0",
      ],
      [
        "inbox_items",
        "SELECT id AS ref FROM inbox_items WHERE instr(payload, :secret) > 0",
      ],
      [
        "turn_log",
        "SELECT attempt || ':' || step AS ref FROM turn_log WHERE instr(coalesce(result_summary,''), :secret) > 0",
      ],
    ];
    for (const [table, sql] of queries) {
      const statement = this.db.prepare(sql);
      for (const variant of variants) {
        for (const row of statement.all({ secret: variant.value })) {
          add({ location: "state", table, ref: sqlText(row["ref"]), variant: variant.kind });
        }
      }
    }
  }

  private scanCas(variants: readonly SecretVariant[], add: (occurrence: SecretOccurrence) => void): void {
    const hashes = new Set<string>(artifactHashes(this.db));
    for (const hash of this.casStore.listStoredHashes?.() ?? []) hashes.add(hash);
    for (const hash of hashes) {
      let bytes: Uint8Array;
      try {
        bytes = this.casStore.getBlob(hash);
      } catch {
        continue;
      }
      const text = Buffer.from(bytes).toString("utf8");
      const kind = matchingVariantKind(text, variants);
      if (!kind && !bufferContainsVariant(bytes, variants)) continue;
      add({ location: "cas", table: "cas_blobs", ref: hash, variant: kind ?? "raw" });
    }
  }

  private scanBackupFiles(
    variants: readonly SecretVariant[],
    add: (occurrence: SecretOccurrence) => void,
  ): void {
    const directory = this.options.backupsDir;
    if (!directory || !fs.existsSync(directory)) return;
    for (const name of fs.readdirSync(directory)) {
      if (!name.endsWith(".db")) continue;
      const filePath = path.join(directory, name);
      if (!fileContainsVariant(filePath, variants)) continue;
      const raw = fs.readFileSync(filePath).toString("utf8");
      add({
        location: "backup",
        table: "backups",
        ref: name,
        variant: matchingVariantKind(raw, variants) ?? "raw",
      });
    }
  }

  private scanTelemetry(
    variants: readonly SecretVariant[],
    add: (occurrence: SecretOccurrence) => void,
  ): void {
    const filePath = this.options.telemetryDbPath;
    if (!filePath || !fileContainsVariant(filePath, variants)) return;
    add({ location: "telemetry", table: "telemetry", ref: path.basename(filePath), variant: "raw" });
  }

  private scanLogs(variants: readonly SecretVariant[], add: (occurrence: SecretOccurrence) => void): void {
    const directory = this.options.logsDir;
    if (!directory || !fs.existsSync(directory)) return;
    for (const name of fs.readdirSync(directory)) {
      if (!name.endsWith(".jsonl")) continue;
      const text = fs.readFileSync(path.join(directory, name), "utf8");
      const kind = matchingVariantKind(text, variants);
      if (!kind) continue;
      add({ location: "log", table: "logs", ref: name, variant: kind });
    }
  }

  private saveHashMap(hashMap: Record<string, string>, purgeId: string): string {
    const ordered: Record<string, string> = {};
    for (const key of Object.keys(hashMap).sort()) {
      const value = hashMap[key];
      if (value !== undefined) ordered[key] = value;
    }
    const bytes = Buffer.from(canonicalizeJson(ordered), "utf8");
    const written = this.casStore.putBlob(bytes, {
      holderKind: "project",
      holderId: this.options.projectId,
      mime: "application/json",
    });
    const artifactId = `redaction-map-${purgeId}`;
    this.db
      .prepare(
        `INSERT INTO artifacts(id, hash, kind, bytes, mime, retention, created_at)
         VALUES (?, ?, 'source', ?, 'application/json', 'evidence', ?)`,
      )
      .run(artifactId, written.hash, written.bytes, this.now());
    return artifactId;
  }

  private rewriteCasBlobs(
    variants: readonly SecretVariant[],
    placeholder: string,
    replacements: Map<string, { hash: string; bytes: number }>,
  ): number {
    const hashes = new Set<string>(artifactHashes(this.db));
    for (const hash of this.casStore.listStoredHashes?.() ?? []) hashes.add(hash);
    let changed = 0;
    for (const hash of hashes) {
      let bytes: Uint8Array;
      try {
        bytes = this.casStore.getBlob(hash);
      } catch {
        continue;
      }
      const redacted = redactBuffer(bytes, variants, placeholder);
      if (!redacted) continue;
      const written = this.casStore.putBlob(redacted, {
        holderKind: "project",
        holderId: this.options.projectId,
        mime: "text/plain",
      });
      replaceArtifactHash(this.db, hash, written.hash, written.bytes);
      replacements.set(hash, written);
      if (written.hash !== hash) {
        this.casStore.unpinHolder(hash, "project", this.options.projectId);
        this.casStore.forceDeletePurgedBlob(hash);
      }
      changed += 1;
    }
    return changed;
  }

  private pinBackupArtifacts(backupPath: string): void {
    const backup = new DatabaseSync(backupPath, { readOnly: true });
    try {
      const holderId = path.basename(backupPath);
      for (const hash of artifactHashes(backup)) {
        this.casStore.pinBlob(hash, "backup", holderId);
      }
    } finally {
      if (backup.isOpen) backup.close();
    }
  }

  private recordAudit(
    purgeId: string,
    fingerprint: string,
    label: string,
    counts: Record<string, number>,
    hashMapArtifact: string | null,
    rewriteFinished: boolean,
  ): void {
    if (!rewriteFinished) return;
    const existing = this.db.prepare("SELECT id FROM redactions WHERE id = ?").get(purgeId);
    if (existing) return;
    const ordered: Record<string, number> = {};
    for (const key of Object.keys(counts).sort()) {
      const value = counts[key];
      if (value !== undefined) ordered[key] = value;
    }
    this.db
      .prepare(
        `INSERT INTO redactions(id, secret_fingerprint, label, counts, hash_map_artifact, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(purgeId, fingerprint, label, canonicalizeJson(ordered), hashMapArtifact, this.now());
  }

  private stateFiles(): string[] {
    return [this.options.stateDbPath, `${this.options.stateDbPath}-wal`];
  }

  private receipt(input: {
    readonly purgeId: string;
    readonly label: string;
    readonly fingerprint: string;
    readonly counts: Record<string, number>;
    readonly hashMapArtifact: string | null;
    readonly completed: readonly PurgeStep[];
    readonly failedStep: PurgeStep | null;
    readonly pendingTargets: readonly string[];
    readonly failureMessage: string | null;
    readonly remotePushed: boolean;
    readonly reachedExportableState: boolean;
  }): PurgeReceipt {
    const remoteHistoryRewriteRequired = this.remoteRewriteRequired(
      input.remotePushed,
      input.reachedExportableState,
    );
    const partial = input.failedStep !== null || input.failureMessage !== null;
    return {
      id: input.purgeId,
      status: partial ? "partial" : "complete",
      partial,
      label: input.label,
      placeholder: input.label,
      secretFingerprint: input.fingerprint,
      counts: { ...input.counts },
      hashMapArtifact: input.hashMapArtifact,
      rotationMandatory: true,
      rotationUrl: rotationUrlForLabel(labelName(input.label)),
      rotationGuidance: ROTATION_GUIDANCE,
      remoteHistoryRewriteRequired,
      remoteHistoryRewriteMessage: remoteHistoryRewriteRequired ? REMOTE_REQUIRED : REMOTE_CLEAR,
      completedSteps: [...input.completed],
      failedStep: input.failedStep,
      pendingTargets: [...input.pendingTargets],
      failureMessage: input.failureMessage,
    };
  }

  /**
   * Reads `export_state.commit_sha` and the caller-supplied push bit.
   * This method never force-pushes and never invokes Git.
   */
  private remoteRewriteRequired(remotePushed: boolean, reachedExportableState: boolean): boolean {
    if (!remotePushed || !reachedExportableState) return false;
    const row = this.db
      .prepare("SELECT commit_sha FROM export_state WHERE target = 'harness-state'")
      .get();
    if (!row) return false;
    const commit = row["commit_sha"];
    return typeof commit === "string" && commit.length > 0;
  }
}

function labelName(placeholder: string): string {
  const match = /^\[REDACTED:([A-Z][A-Z0-9_]*)\]$/.exec(placeholder);
  return match?.[1] ?? "SECRET";
}

function listJsonl(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(directory, name));
}

function assertCasRootClean(root: string, variants: readonly SecretVariant[]): void {
  const files: string[] = [];
  walkFiles(root, (filePath) => {
    files.push(filePath);
  });
  assertFilesClean(files, variants, "CAS");
}

const noopSink: StructuredLogSink = {
  write(): void {
    // Discard when the caller did not attach a log sink. The guard still runs first.
  },
};

export function createGuardedLogSink(
  inner: StructuredLogSink,
  variants: readonly SecretVariant[],
): StructuredLogSink {
  return {
    write(event): void {
      if (textContainsVariant(JSON.stringify(event), variants)) {
        throw new Error("structured log refused a sensitive value");
      }
      inner.write(event);
    },
  };
}
