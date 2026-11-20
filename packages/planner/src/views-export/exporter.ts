import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile, retryDelayMs, type AtomicWriteOptions } from "./atomic-write.js";
import { digestSha256, normalizeLf, compareText } from "./canonical-hash.js";
import { errorCode } from "./fs-error.js";
import { GitExcludeGuard, type GitRunner } from "./git-exclude-guard.js";
import type { KnowledgeViewSource, ViewNode } from "./knowledge-graph-port.js";
import { ExportPauseLock, ExportWriteLease } from "./locks.js";
import {
  fileContentHash,
  parseManifest,
  recordsForFile,
  serializeManifest,
  type ManifestRecord,
  type ViewManifest,
} from "./manifest.js";
import { manifestPath as manifestFile, viewsRoot } from "./paths.js";
import { renderViewTree, type RenderedViewFile } from "./render-views.js";
import type { ArchDocumentSharder } from "./arch-document-sharder.js";

export interface DbHeadNode {
  readonly id: string;
  readonly version: number;
  readonly contentHash: string;
  readonly updatedRev: number;
}

export interface PausedView {
  readonly filePath: string;
  readonly reason: string;
  readonly diskSha256: string | null;
  readonly manifestSha256: string | null;
  readonly dbRevision: number;
  readonly nodeIds: readonly string[];
  readonly dbHead: readonly DbHeadNode[];
}

export interface DeferredView {
  readonly filePath: string;
  readonly attempts: number;
  readonly code: string;
  readonly diagnostic: string;
}

export interface ExportResult {
  readonly revision: number;
  readonly mode: "full" | "incremental";
  readonly written: readonly string[];
  readonly unchanged: readonly string[];
  readonly paused: readonly PausedView[];
  readonly deferred: readonly DeferredView[];
  readonly removed: readonly string[];
  readonly durationMs: number;
}

export interface KnowledgeViewExporterOptions {
  readonly projectRoot: string;
  readonly source: KnowledgeViewSource;
  readonly pauseLock?: ExportPauseLock;
  readonly lease?: ExportWriteLease;
  readonly sharder?: ArchDocumentSharder;
  readonly git?: GitRunner;
  readonly now?: () => string;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly backoff?: (attempt: number) => number;
  readonly rename?: (from: string, to: string) => Promise<void>;
}

interface LoadedManifest {
  readonly state: "missing" | "corrupt" | "ok";
  readonly manifest: ViewManifest | null;
}

/**
 * Projects `state.db` (through `KnowledgeViewSource`) into `.harness/views/`.
 * Repeated exports of an unchanged graph do not rewrite bytes. Dirty files and
 * `ExportPauseLock` holders are left on disk for Task 086.
 */
export class KnowledgeViewExporter {
  private readonly pauseLock: ExportPauseLock;
  private readonly lease: ExportWriteLease;
  private readonly guard: GitExcludeGuard;
  private readonly now: () => string;
  private readonly atomic: AtomicWriteOptions;
  private readonly sharder: ArchDocumentSharder | undefined;

  constructor(private readonly options: KnowledgeViewExporterOptions) {
    this.pauseLock = options.pauseLock ?? new ExportPauseLock();
    this.lease = options.lease ?? new ExportWriteLease();
    this.guard = new GitExcludeGuard(options.git);
    this.now = options.now ?? (() => new Date().toISOString());
    const atomic: AtomicWriteOptions = {
      backoff: options.backoff ?? ((attempt: number) => retryDelayMs(attempt)),
      sleep: options.sleep ?? ((ms: number) => (ms <= 0 ? Promise.resolve() : delay(ms))),
    };
    if (options.rename) {
      this.atomic = { ...atomic, rename: options.rename };
    } else {
      this.atomic = atomic;
    }
    this.sharder = options.sharder;
  }

  exportAll(): Promise<ExportResult> {
    return this.run("full");
  }

  exportIncremental(): Promise<ExportResult> {
    return this.run("incremental");
  }

  private async run(requested: "full" | "incremental"): Promise<ExportResult> {
    const started = performance.now();
    await this.guard.ensure(this.options.projectRoot);
    const loaded = await this.loadManifest();
    const rendered = this.sharder
      ? renderViewTree(this.options.source, this.sharder)
      : renderViewTree(this.options.source);
    const mode = requested === "full" || loaded.manifest === null ? "full" : "incremental";
    const dirty = this.dirtyIds(mode, loaded.manifest);
    const candidates = candidatePaths(rendered, dirty, loaded.manifest, mode);
    const written: string[] = [];
    const unchanged: string[] = [];
    const paused: PausedView[] = [];
    const deferred: DeferredView[] = [];
    const removed: string[] = [];
    const blocked = new Set<string>();
    const nodesById = new Map(this.options.source.listNodes().map((node) => [node.id, node]));
    const leasePaths = [...candidates, ".manifest.json"];
    const token = this.lease.acquire(leasePaths);
    try {
      if (loaded.state === "corrupt") {
        blocked.add(".manifest.json");
        for (const file of rendered) {
          const absolute = path.join(viewsRoot(this.options.projectRoot), file.relativePath);
          const disk = await readOptional(absolute);
          const normalized = disk === null ? null : normalizeLf(disk);
          const diskHash = normalized === null ? null : digestSha256(normalized);
          if (!this.pauseLock.isPaused(file.relativePath)) {
            this.pauseLock.pause(file.relativePath, "manifest_unreadable");
          }
          paused.push(
            this.pausedView(
              file.relativePath,
              "manifest_unreadable",
              diskHash,
              null,
              file.nodes.map((node) => node.nodeId),
              nodesById,
            ),
          );
          blocked.add(file.relativePath);
        }
      } else {
        const renderedByPath = new Map(rendered.map((file) => [file.relativePath, file]));
        const outcomes = await mapPool([...candidates].sort(compareText), 32, async (relativePath) => {
          const file = renderedByPath.get(relativePath);
          if (!file) return null;
          return { relativePath, outcome: await this.writeOne(file, loaded, nodesById) };
        });
        for (const item of outcomes) {
          if (!item) continue;
          const { relativePath, outcome } = item;
          if (outcome.kind === "written") written.push(relativePath);
          else if (outcome.kind === "unchanged") unchanged.push(relativePath);
          else if (outcome.kind === "paused") {
            paused.push(outcome.paused);
            blocked.add(relativePath);
          } else {
            deferred.push(outcome.deferred);
            blocked.add(relativePath);
          }
        }
      }
      if (loaded.manifest && loaded.state === "ok") {
        await this.removeStale(rendered, loaded.manifest, nodesById, removed, paused, blocked);
      }
      const revision = blocked.size > 0 ? (loaded.manifest?.revision ?? this.options.source.currentRevision()) : this.options.source.currentRevision();
      const nextManifest = this.buildManifest(rendered, loaded.manifest, candidates, blocked, revision);
      const serialized = serializeManifest(nextManifest);
      const manifestTarget = manifestFile(this.options.projectRoot);
      const currentText = await readOptional(manifestTarget);
      if (currentText !== null && normalizeLf(currentText) === serialized) {
        unchanged.push(".manifest.json");
      } else if (!blocked.has(".manifest.json")) {
        const result = await atomicWriteFile(manifestTarget, serialized, this.atomic);
        if (result.ok) written.push(".manifest.json");
        else {
          deferred.push({
            filePath: ".manifest.json",
            attempts: result.attempts,
            code: result.code,
            diagnostic: result.diagnostic,
          });
        }
      }
    } finally {
      this.lease.release(token);
    }
    return {
      revision: this.options.source.currentRevision(),
      mode,
      written: written.sort(compareText),
      unchanged: unchanged.sort(compareText),
      paused: paused.sort((left, right) => compareText(left.filePath, right.filePath)),
      deferred: deferred.sort((left, right) => compareText(left.filePath, right.filePath)),
      removed: removed.sort(compareText),
      durationMs: performance.now() - started,
    };
  }

  private dirtyIds(mode: "full" | "incremental", manifest: ViewManifest | null): ReadonlySet<string> {
    if (mode === "full" || manifest === null) {
      return new Set(this.options.source.listNodes().map((node) => node.id));
    }
    return new Set(this.options.source.getDirtyNodesSince(manifest.revision));
  }

  private async writeOne(
    file: RenderedViewFile,
    loaded: LoadedManifest,
    nodesById: ReadonlyMap<string, ViewNode>,
  ): Promise<
    | { kind: "written" }
    | { kind: "unchanged" }
    | { kind: "paused"; paused: PausedView }
    | { kind: "deferred"; deferred: DeferredView }
  > {
    const absolute = path.join(viewsRoot(this.options.projectRoot), file.relativePath);
    const disk = await readOptional(absolute);
    const normalized = disk === null ? null : normalizeLf(disk);
    if (normalized === file.content) return { kind: "unchanged" };
    const previous = loaded.manifest ? fileContentHash(loaded.manifest, file.relativePath) : null;
    const diskHash = normalized === null ? null : digestSha256(normalized);
    const locked = this.pauseLock.isPaused(file.relativePath);
    const drifted = previous !== null && diskHash !== previous;
    const unexpected = loaded.state === "ok" && previous === null && normalized !== null;
    if (locked || drifted || unexpected) {
      const reason = locked
        ? (this.pauseLock.reason(file.relativePath) ?? "export_pause_lock")
        : normalized === null
          ? "deleted_on_disk"
          : "disk_drift";
      if (!locked) this.pauseLock.pause(file.relativePath, reason);
      return {
        kind: "paused",
        paused: this.pausedView(file.relativePath, reason, diskHash, previous, file.nodes.map((node) => node.nodeId), nodesById),
      };
    }
    const result = await atomicWriteFile(absolute, file.content, this.atomic);
    if (!result.ok) {
      return {
        kind: "deferred",
        deferred: {
          filePath: file.relativePath,
          attempts: result.attempts,
          code: result.code,
          diagnostic: result.diagnostic,
        },
      };
    }
    return { kind: "written" };
  }

  private async removeStale(
    rendered: readonly RenderedViewFile[],
    manifest: ViewManifest,
    nodesById: ReadonlyMap<string, ViewNode>,
    removed: string[],
    paused: PausedView[],
    blocked: Set<string>,
  ): Promise<void> {
    const live = new Set(rendered.map((file) => file.relativePath));
    const previous = [...new Set(manifest.records.filter((record) => record.nodeId === "").map((record) => record.filePath))];
    for (const relativePath of previous.sort(compareText)) {
      if (live.has(relativePath)) continue;
      const absolute = path.join(viewsRoot(this.options.projectRoot), relativePath);
      const disk = await readOptional(absolute);
      const normalized = disk === null ? null : normalizeLf(disk);
      const expected = fileContentHash(manifest, relativePath);
      const diskHash = normalized === null ? null : digestSha256(normalized);
      if (this.pauseLock.isPaused(relativePath) || (normalized !== null && diskHash !== expected)) {
        const reason = this.pauseLock.reason(relativePath) ?? "deleted_on_disk";
        if (!this.pauseLock.isPaused(relativePath)) this.pauseLock.pause(relativePath, "disk_drift");
        paused.push(this.pausedView(relativePath, reason, diskHash, expected, [], nodesById));
        blocked.add(relativePath);
        continue;
      }
      if (normalized !== null) await rm(absolute, { force: true });
      removed.push(relativePath);
    }
  }

  private buildManifest(
    rendered: readonly RenderedViewFile[],
    previous: ViewManifest | null,
    candidates: ReadonlySet<string>,
    blocked: ReadonlySet<string>,
    revision: number,
  ): ViewManifest {
    const records: ManifestRecord[] = [];
    const stamp = this.now();
    for (const file of rendered) {
      const keepPrevious = (previous && !candidates.has(file.relativePath)) || blocked.has(file.relativePath);
      if (keepPrevious && previous) {
        records.push(...recordsForFile(previous, file.relativePath));
        continue;
      }
      const fileHash = digestSha256(file.content);
      const previousFile = previous?.records.find((record) => record.filePath === file.relativePath && record.nodeId === "");
      const exportedAt = previousFile && previousFile.contentSha256 === fileHash ? previousFile.exportedAt : stamp;
      records.push({
        filePath: file.relativePath,
        nodeId: "",
        exportedRev: revision,
        contentSha256: fileHash,
        fieldsSha256: digestSha256(file.nodes.map((node) => node.fieldsYaml).join("\n")),
        proseSha256: digestSha256(file.nodes.map((node) => node.prose).join("\n")),
        exportedAt,
      });
      for (const node of file.nodes) {
        const previousNode = previous?.records.find(
          (record) => record.filePath === file.relativePath && record.nodeId === node.nodeId,
        );
        records.push({
          filePath: file.relativePath,
          nodeId: node.nodeId,
          exportedRev: node.exportedRev,
          contentSha256: node.contentSha256,
          fieldsSha256: node.fieldsSha256,
          proseSha256: node.proseSha256,
          exportedAt: previousNode && previousNode.contentSha256 === node.contentSha256 ? previousNode.exportedAt : stamp,
        });
      }
    }
    if (previous) {
      for (const record of previous.records) {
        if (!blocked.has(record.filePath)) continue;
        if (rendered.some((file) => file.relativePath === record.filePath)) continue;
        records.push(record);
      }
    }
    return { revision, records };
  }

  private pausedView(
    filePath: string,
    reason: string,
    diskSha256: string | null,
    manifestSha256: string | null,
    nodeIds: readonly string[],
    nodesById: ReadonlyMap<string, ViewNode>,
  ): PausedView {
    const dbHead: DbHeadNode[] = [];
    for (const id of [...nodeIds].sort(compareText)) {
      const node = nodesById.get(id);
      if (!node) continue;
      dbHead.push({
        id: node.id,
        version: node.version,
        contentHash: node.contentHash,
        updatedRev: node.updatedRev,
      });
    }
    return {
      filePath,
      reason,
      diskSha256,
      manifestSha256,
      dbRevision: this.options.source.currentRevision(),
      nodeIds: [...nodeIds].sort(compareText),
      dbHead,
    };
  }

  private async loadManifest(): Promise<LoadedManifest> {
    const text = await readOptional(manifestFile(this.options.projectRoot));
    if (text === null) return { state: "missing", manifest: null };
    const manifest = parseManifest(normalizeLf(text));
    if (!manifest) return { state: "corrupt", manifest: null };
    return { state: "ok", manifest };
  }
}

function candidatePaths(
  rendered: readonly RenderedViewFile[],
  dirty: ReadonlySet<string>,
  manifest: ViewManifest | null,
  mode: "full" | "incremental",
): Set<string> {
  if (mode === "full" || manifest === null) return new Set(rendered.map((file) => file.relativePath));
  const candidates = new Set<string>();
  for (const file of rendered) {
    if (file.relativePath.endsWith(".mmd")) {
      if (dirty.size > 0) candidates.add(file.relativePath);
      continue;
    }
    if (file.nodes.some((node) => dirty.has(node.nodeId))) candidates.add(file.relativePath);
  }
  for (const record of manifest.records) {
    if (record.nodeId !== "" && dirty.has(record.nodeId)) candidates.add(record.filePath);
  }
  return candidates;
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function mapPool<T, R>(items: readonly T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await mapper(item);
    }
  });
  await Promise.all(workers);
  return results;
}
