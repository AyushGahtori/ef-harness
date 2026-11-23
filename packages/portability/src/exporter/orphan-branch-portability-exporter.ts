import type { HiddenCheckPoolPort, KnowledgeGraphRepoPort } from "./types.js";
import {
  EXPORT_QUIET_DEBOUNCE_MS,
  HISTORY_SEGMENT_MAX_BYTES,
  type ExportManifest,
  type FastImportFileOp,
} from "./types.js";
import { ExportSecretGate, type ExportBuffer } from "./export-secret-gate.js";
import { AgeSealedChecksEncryptor } from "./age-sealed-checks-encryptor.js";
import { GitFastImportWriter, readBlobAtPath, type FastImportResult } from "./git-fast-import-writer.js";
import { SortedPerEntityYamlSerializer } from "./sorted-per-entity-yaml-serializer.js";

export interface OrphanBranchPortabilityExporterOptions {
  readonly repoPath: string;
  readonly graph: KnowledgeGraphRepoPort;
  readonly hiddenChecks: HiddenCheckPoolPort;
  readonly secretGate: ExportSecretGate;
  readonly ageEncryptor: AgeSealedChecksEncryptor;
  readonly writer: GitFastImportWriter;
  readonly serializer?: SortedPerEntityYamlSerializer;
  readonly clock?: () => number;
  readonly debounceMs?: number;
}

export interface ExportRunResult extends FastImportResult {
  readonly changedPaths: readonly string[];
  readonly historySegment?: string;
}

export class OrphanBranchPortabilityExporter {
  private readonly serializer: SortedPerEntityYamlSerializer;
  private readonly debounceMs: number;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;
  private lastScheduledAt = 0;

  constructor(private readonly options: OrphanBranchPortabilityExporterOptions) {
    this.serializer = options.serializer ?? new SortedPerEntityYamlSerializer();
    this.debounceMs = options.debounceMs ?? EXPORT_QUIET_DEBOUNCE_MS;
  }

  scheduleExport(): void {
    this.pending = true;
    this.lastScheduledAt = (this.options.clock ?? Date.now)();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      void this.flushIfQuiet();
    }, this.debounceMs);
  }

  async flushExport(force = false): Promise<ExportRunResult | null> {
    if (!force && this.pending && (this.options.clock ?? Date.now)() - this.lastScheduledAt < this.debounceMs) {
      return null;
    }
    return this.runExport();
  }

  private async flushIfQuiet(): Promise<ExportRunResult | null> {
    if (!this.pending) return null;
    const now = (this.options.clock ?? Date.now)();
    if (now - this.lastScheduledAt < this.debounceMs) {
      const remaining = this.debounceMs - (now - this.lastScheduledAt);
      this.debounceTimer = setTimeout(() => {
        void this.flushIfQuiet();
      }, remaining);
      return null;
    }
    this.pending = false;
    return this.runExport();
  }

  async runExport(): Promise<ExportRunResult> {
    const snapshot = this.options.graph.loadExportSnapshot();
    const prior = this.options.graph.readExportState();
    if (prior.lastCanonicalGraphSha256 === snapshot.canonicalGraphSha256) {
      return {
        commitSha: prior.lastHarnessStateCommit,
        noop: true,
        durationMs: 0,
        changedPaths: [],
      };
    }

    const dirty = snapshot.entities.filter((entity) => {
      const key = `${entity.kind}:${entity.id}`;
      const last = prior.lastExportedRevisionByEntity[key] ?? 0;
      return entity.revision !== last || entity.deleted;
    });

    const manifest: ExportManifest = {
      schemaVersion: 1,
      projectId: snapshot.projectId,
      exportedAt: new Date().toISOString(),
      canonicalGraphSha256: snapshot.canonicalGraphSha256,
      deviceId: snapshot.deviceId,
      writerEpoch: snapshot.writerEpoch,
    };

    const manifestYaml = this.serializer.serializeManifest(manifest);
    const leaseYaml = this.serializer.serializeLease(snapshot.lease);
    const buffers: ExportBuffer[] = [
      { path: "manifest.yaml", content: manifestYaml },
      { path: "lease.yaml", content: leaseYaml },
    ];

    const parent = prior.lastHarnessStateCommit;
    const baseMode = parent ? "modify" : "add";
    const ops: FastImportFileOp[] = [
      { path: "manifest.yaml", mode: baseMode, content: manifestYaml },
      { path: "lease.yaml", mode: baseMode, content: leaseYaml },
    ];

    for (const entity of dirty) {
      const path = this.serializer.entityPath(entity.kind, entity.id);
      if (entity.deleted) {
        ops.push({ path, mode: "delete" });
        continue;
      }
      const content = this.serializer.serializeEntity(entity);
      buffers.push({ path, content, nodeId: entity.id });
      ops.push({ path, mode: prior.lastExportedRevisionByEntity[`${entity.kind}:${entity.id}`] ? "modify" : "add", content });
    }

    const featureIds = [...new Set(dirty.filter((e) => e.kind === "feature").map((e) => e.id))];
    const sealedChecks = this.options.hiddenChecks.listSealedForFeatures(featureIds);
    const seenFeatureFiles = new Set<string>();
    for (const check of sealedChecks) {
      const path = this.options.ageEncryptor.checksSealedPath(check.featureId);
      if (seenFeatureFiles.has(path)) continue;
      seenFeatureFiles.add(path);
      const encrypted = await this.options.ageEncryptor.encryptCheck(check);
      buffers.push({ path, content: encrypted });
      ops.push({ path, mode: "modify", content: encrypted });
    }

    const historyLine = this.buildHistoryLine(snapshot);
    if (historyLine) {
      const historyPath = historyLine.path;
      const existing = parent
        ? readBlobAtPath(this.options.repoPath, "refs/heads/harness-state", historyPath) ?? ""
        : "";
      const nextBody = `${existing}${historyLine.text}\n`;
      if (Buffer.byteLength(nextBody, "utf8") > HISTORY_SEGMENT_MAX_BYTES) {
        throw new Error(`history segment exceeds ${HISTORY_SEGMENT_MAX_BYTES} bytes`);
      }
      buffers.push({ path: historyPath, content: nextBody });
      ops.push({
        path: historyPath,
        mode: existing ? "modify" : "add",
        content: nextBody,
      });
    }

    this.options.secretGate.assertClean(buffers);

    const importResult = this.options.writer.apply(
      ops,
      `harness-state export ${manifest.exportedAt}`,
      prior.lastBlobShasByPath,
    );
    const nextMap = { ...prior.lastExportedRevisionByEntity };
    for (const entity of dirty) {
      const key = `${entity.kind}:${entity.id}`;
      if (entity.deleted) {
        delete nextMap[key];
      } else {
        nextMap[key] = entity.revision;
      }
    }

    this.options.graph.writeExportState({
      lastExportedRevisionByEntity: nextMap,
      lastCanonicalGraphSha256: snapshot.canonicalGraphSha256,
      lastHarnessStateCommit: importResult.commitSha,
      lastBlobShasByPath: importResult.blobCache,
    });

    return {
      ...importResult,
      changedPaths: ops.map((op) => op.path),
      ...(historyLine ? { historySegment: historyLine.path } : {}),
    };
  }

  private buildHistoryLine(snapshot: {
    readonly history: readonly { readonly changeId: string; readonly entityId: string; readonly revision: number; readonly at: string; readonly summary: string }[];
    readonly deviceId: string;
  }): { readonly text: string; readonly at: string; readonly path: string } | null {
    const last = snapshot.history.at(-1);
    if (!last) return null;
    const text = JSON.stringify(last);
    if (Buffer.byteLength(text, "utf8") > HISTORY_SEGMENT_MAX_BYTES) {
      throw new Error(`history segment exceeds ${HISTORY_SEGMENT_MAX_BYTES} bytes`);
    }
    const month = last.at.slice(0, 7);
    const deviceShort = snapshot.deviceId.slice(0, 8);
    return {
      text,
      at: last.at,
      path: this.serializer.historySegmentPath(month, deviceShort),
    };
  }
}