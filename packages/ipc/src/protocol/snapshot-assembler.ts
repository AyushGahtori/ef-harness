import type { SnapshotViewName } from "./constants.js";
import {
  CHANNEL0_MAX_FRAME_BYTES,
  DEFAULT_SNAPSHOT_SEQ_BUFFER,
  MAX_SNAPSHOT_SECTION_BYTES,
} from "./constants.js";
import { decodeJsonCursor, encodeJsonCursor, utf8Size } from "./byte-size.js";
import { ProjectNotFoundError, SnapshotItemTooLargeError } from "./errors.js";
import type {
  BoardSummary,
  FeatureProgress,
  KeysetReader,
  PinnedSnapshot,
  ReadModelSnapshotBindings,
  SnapshotReadBatch,
  SnapshotRow,
  SnapshotSource,
} from "./ports.js";

export interface SnapshotPage {
  readonly as_of_seq: number;
  readonly stream_epoch: string;
  readonly sections: Readonly<Record<string, unknown>>;
  readonly nextCursor: string | null;
}

export interface ResyncRequired {
  readonly status: "resync_required";
  readonly current_stream_epoch: string;
  readonly latest_seq: number;
}

export type SnapshotGetResult = SnapshotPage | ResyncRequired;

export interface SnapshotGetParams {
  readonly project: string;
  readonly views: readonly SnapshotViewName[];
  readonly cursor?: string;
}

interface Pin {
  readonly id: string;
  readonly projectId: string;
  readonly viewsKey: string;
  readonly asOfSeq: number;
  readonly streamEpoch: string;
  readonly views: readonly SnapshotViewName[];
  readonly reader: PinnedSnapshot;
}

interface Position {
  readonly viewIndex: number;
  readonly afterKey: string | null;
}

interface CursorPayload {
  readonly pin: string;
  readonly viewIndex: number;
  readonly afterKey: string | null;
  readonly viewsKey: string;
}

export interface SnapshotAssemblerOptions {
  readonly source: SnapshotSource;
  readonly seqBuffer?: number;
  readonly maxFrameBytes?: number;
}

export class SnapshotAssembler {
  private readonly source: SnapshotSource;
  private readonly seqBuffer: number;
  private readonly maxFrameBytes: number;
  private readonly pins = new Map<string, Pin>();
  private nextPin = 1;

  constructor(options: SnapshotAssemblerOptions) {
    this.source = options.source;
    this.seqBuffer = options.seqBuffer ?? DEFAULT_SNAPSHOT_SEQ_BUFFER;
    this.maxFrameBytes = options.maxFrameBytes ?? CHANNEL0_MAX_FRAME_BYTES;
  }

  async get(params: SnapshotGetParams): Promise<SnapshotGetResult> {
    const views = dedupeViews(params.views);
    const viewsKey = views.join("\n");
    if (params.cursor === undefined) {
      const reader = await this.source.open(params.project, views);
      const pin: Pin = {
        id: `p${this.nextPin}`,
        projectId: params.project,
        viewsKey,
        asOfSeq: reader.asOfSeq,
        streamEpoch: reader.streamEpoch,
        views,
        reader,
      };
      this.nextPin += 1;
      const filled = await this.fill(pin, { viewIndex: 0, afterKey: null });
      if (filled.next) this.pins.set(pin.id, pin);
      return filled.page;
    }
    const decoded = decodeCursor(params.cursor);
    if (!decoded || decoded.viewsKey !== viewsKey) {
      return this.resync(params.project);
    }
    const pin = this.pins.get(decoded.pin);
    if (!pin || pin.projectId !== params.project) return this.resync(params.project);
    const epoch = await this.source.currentEpoch(params.project);
    const latest = await this.source.currentLatestSeq(params.project);
    if (epoch !== pin.streamEpoch || latest > pin.asOfSeq + this.seqBuffer) {
      this.pins.delete(pin.id);
      return { status: "resync_required", current_stream_epoch: epoch, latest_seq: latest };
    }
    const filled = await this.fill(pin, { viewIndex: decoded.viewIndex, afterKey: decoded.afterKey });
    if (!filled.next) this.pins.delete(pin.id);
    return filled.page;
  }

  private async resync(projectId: string): Promise<ResyncRequired> {
    const [epoch, latest] = await Promise.all([
      this.source.currentEpoch(projectId),
      this.source.currentLatestSeq(projectId),
    ]);
    return { status: "resync_required", current_stream_epoch: epoch, latest_seq: latest };
  }

  private async fill(pin: Pin, start: Position): Promise<{ page: SnapshotPage; next: Position | null }> {
    const sections: Record<string, unknown> = {};
    let viewIndex = start.viewIndex;
    let afterKey = start.afterKey;
    let guard = 0;
    while (viewIndex < pin.views.length && guard < 100_000) {
      guard += 1;
      const view = pin.views[viewIndex];
      if (!view) break;
      const batch = await pin.reader.read(view, afterKey, 64);
      if (batch.items.length === 0) {
        if (batch.done) {
          rememberEmpty(sections, view);
          viewIndex += 1;
          afterKey = null;
          continue;
        }
        break;
      }
      let consumed = 0;
      for (let index = 0; index < batch.items.length; index += 1) {
        const item = batch.items[index];
        if (!item) break;
        const completesSnapshot =
          batch.done && index === batch.items.length - 1 && viewIndex === pin.views.length - 1;
        const nextCursor = completesSnapshot ? null : continuationCursor(pin, viewIndex, item.id);
        if (!this.fits(pin, sections, view, item, nextCursor)) {
          if (consumed === 0 && isEmptyRecord(sections)) {
            throw new SnapshotItemTooLargeError(view, item.id);
          }
          break;
        }
        appendItem(sections, view, item);
        consumed += 1;
        afterKey = item.id;
      }
      if (consumed === 0) break;
      const finishedView = consumed === batch.items.length && batch.done;
      const exhaustedChunk = consumed === batch.items.length && !batch.done;
      if (finishedView) {
        viewIndex += 1;
        afterKey = null;
        continue;
      }
      if (exhaustedChunk) continue;
      break;
    }
    const done = viewIndex >= pin.views.length;
    const next = done ? null : { viewIndex, afterKey };
    const nextCursor = next
      ? encodeJsonCursor({
          pin: pin.id,
          viewIndex: next.viewIndex,
          afterKey: next.afterKey,
          viewsKey: pin.viewsKey,
        } satisfies CursorPayload)
      : null;
    const page: SnapshotPage = {
      as_of_seq: pin.asOfSeq,
      stream_epoch: pin.streamEpoch,
      sections,
      nextCursor,
    };
    assertFrame(page, this.maxFrameBytes);
    return { page, next };
  }

  private fits(
    pin: Pin,
    sections: Record<string, unknown>,
    view: string,
    item: SnapshotRow,
    nextCursor: string | null,
  ): boolean {
    const nextSections = copySections(sections);
    appendItem(nextSections, view, item);
    if (utf8Size(nextSections[view]) > MAX_SNAPSHOT_SECTION_BYTES) return false;
    const page: SnapshotPage = {
      as_of_seq: pin.asOfSeq,
      stream_epoch: pin.streamEpoch,
      sections: nextSections,
      nextCursor,
    };
    const frameBytes = utf8Size({
      jsonrpc: "2.0",
      id: "0".repeat(80),
      result: page,
    });
    return frameBytes <= this.maxFrameBytes;
  }
}

export function snapshotSourceFromReadModels(
  resolve: (projectId: string) => ReadModelSnapshotBindings | undefined,
): SnapshotSource {
  return {
    async open(projectId, views) {
      const bindings = requireBindings(resolve, projectId);
      const [epoch, asOfSeq] = await Promise.all([
        bindings.outbox.getStreamEpoch(),
        bindings.outbox.getLatestSeq(),
      ]);
      const cache = new Map<SnapshotViewName, readonly SnapshotRow[]>();
      for (const view of views) {
        await materialize(bindings, view, cache);
      }
      const reader: PinnedSnapshot = {
        asOfSeq,
        streamEpoch: epoch,
        async read(view, afterKey, limit) {
          return sliceRows(cache.get(view) ?? [], afterKey, limit);
        },
      };
      return reader;
    },
    async currentEpoch(projectId) {
      return requireBindings(resolve, projectId).outbox.getStreamEpoch();
    },
    async currentLatestSeq(projectId) {
      return requireBindings(resolve, projectId).outbox.getLatestSeq();
    },
  };
}

function requireBindings(
  resolve: (projectId: string) => ReadModelSnapshotBindings | undefined,
  projectId: string,
): ReadModelSnapshotBindings {
  const bindings = resolve(projectId);
  if (!bindings) throw new ProjectNotFoundError(projectId);
  return bindings;
}

async function materialize(
  bindings: ReadModelSnapshotBindings,
  view: SnapshotViewName,
  cache: Map<SnapshotViewName, readonly SnapshotRow[]>,
): Promise<readonly SnapshotRow[]> {
  const cached = cache.get(view);
  if (cached) return cached;
  let rows: readonly SnapshotRow[];
  if (view === "board") {
    const summary = await bindings.readModels.getBoardSummary();
    rows = [boardRow(summary)];
  } else if (view === "feature_progress") {
    const progress = await bindings.readModels.getFeatureProgress();
    rows = progress.map((row, index) => featureRow(row, index));
  } else if (view === "inbox") {
    rows = await readAll(bindings.inbox);
  } else if (view === "holds") {
    rows = await readAll(bindings.holds);
  } else if (view === "runtime") {
    rows = await readAll(bindings.runtime);
  } else {
    rows = await readAll(bindings.budget);
  }
  cache.set(view, rows);
  return rows;
}

function boardRow(summary: BoardSummary): SnapshotRow {
  return { id: "board", lanes: summary.lanes };
}

function featureRow(row: FeatureProgress, index: number): SnapshotRow {
  const id = row.feature.length > 0 ? row.feature : `feature-${index}`;
  return { id, feature: row.feature, requirements: row.requirements };
}

async function readAll(reader: KeysetReader): Promise<SnapshotRow[]> {
  const rows: SnapshotRow[] = [];
  let after: string | null = null;
  for (let guard = 0; guard < 100_000; guard += 1) {
    const page = await reader.readAfter(after, 500);
    rows.push(...page.items);
    if (page.done || page.items.length === 0) break;
    const last = page.items[page.items.length - 1];
    if (!last || last.id === after) break;
    after = last.id;
  }
  return rows;
}

function sliceRows(rows: readonly SnapshotRow[], afterKey: string | null, limit: number): SnapshotReadBatch {
  let start = 0;
  if (afterKey !== null) {
    const found = rows.findIndex((row) => row.id === afterKey);
    start = found < 0 ? rows.length : found + 1;
  }
  const items = rows.slice(start, start + limit);
  return { items, done: start + limit >= rows.length };
}

function dedupeViews(views: readonly SnapshotViewName[]): SnapshotViewName[] {
  const seen = new Set<SnapshotViewName>();
  const ordered: SnapshotViewName[] = [];
  for (const view of views) {
    if (seen.has(view)) continue;
    seen.add(view);
    ordered.push(view);
  }
  return ordered;
}

function continuationCursor(pin: Pin, viewIndex: number, afterKey: string): string {
  return encodeJsonCursor({
    pin: pin.id,
    viewIndex,
    afterKey,
    viewsKey: pin.viewsKey,
  } satisfies CursorPayload);
}

function decodeCursor(value: string): CursorPayload | null {
  try {
    const parsed = decodeJsonCursor(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.pin !== "string" || typeof record.viewsKey !== "string") return null;
    if (typeof record.viewIndex !== "number" || !Number.isInteger(record.viewIndex) || record.viewIndex < 0) {
      return null;
    }
    if (record.afterKey !== null && typeof record.afterKey !== "string") return null;
    return {
      pin: record.pin,
      viewIndex: record.viewIndex,
      afterKey: record.afterKey,
      viewsKey: record.viewsKey,
    };
  } catch {
    return null;
  }
}

function copySections(sections: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sections)) {
    copy[key] = Array.isArray(value) ? [...value] : value;
  }
  return copy;
}

function appendItem(sections: Record<string, unknown>, view: string, item: SnapshotRow): void {
  const existing = sections[view];
  const list = Array.isArray(existing) ? [...existing] : [];
  list.push(item);
  sections[view] = list;
}

function rememberEmpty(sections: Record<string, unknown>, view: string): void {
  if (sections[view] === undefined) sections[view] = [];
}

function isEmptyRecord(sections: Record<string, unknown>): boolean {
  return Object.keys(sections).length === 0;
}

function assertFrame(page: SnapshotPage, maxFrameBytes: number): void {
  for (const value of Object.values(page.sections)) {
    if (utf8Size(value) > MAX_SNAPSHOT_SECTION_BYTES) {
      throw new Error("snapshot section exceeded 2 MB");
    }
  }
  const frame = utf8Size({ jsonrpc: "2.0", id: 1, result: page });
  if (frame > maxFrameBytes) {
    throw new Error("snapshot frame exceeded cap");
  }
}
