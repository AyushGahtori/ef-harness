import type { SnapshotViewName } from "./constants.js";
import { decodeDaemonMessage } from "./jsonrpc.js";
import type { DomainEvent } from "./ports.js";
import { reduceBatch, type ReduceAction } from "./reduce-batch.js";
import { resyncRequiredSchema, snapshotPageSchema, subscribeLiveSchema } from "./schemas.js";

export interface ClientTransport {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  subscribeNotifications(listener: (message: unknown) => void): () => void;
}

export interface ClientStateSyncerOptions {
  readonly projectId: string;
  readonly topics: readonly string[];
  readonly views: readonly SnapshotViewName[];
  readonly transport: ClientTransport;
}

export type IngestAction = ReduceAction | "telemetry" | "ignored" | "invalid" | "resync";

export interface IngestResult {
  readonly action: IngestAction;
}

/**
 * Pure event-driven window state. Board and Office must share one instance
 * per project so they cannot diverge. No React imports.
 */
export class ClientStateSyncer {
  readonly projectId: string;
  readonly topics: readonly string[];
  readonly views: readonly SnapshotViewName[];
  lastApplied = 0;
  streamEpoch: string | null = null;
  sections: Record<string, unknown> = {};
  appliedEvents: DomainEvent[] = [];
  telemetryCount = 0;

  private readonly transport: ClientTransport;
  private stopNotifications: (() => void) | null = null;
  private tail: Promise<void> = Promise.resolve();
  private recoveryDepth = 0;
  private started = false;

  constructor(options: ClientStateSyncerOptions) {
    this.projectId = options.projectId;
    this.topics = options.topics;
    this.views = options.views;
    this.transport = options.transport;
  }

  async start(sinceSeq = 0): Promise<void> {
    if (!this.started) {
      this.started = true;
      this.lastApplied = sinceSeq;
      this.stopNotifications = this.transport.subscribeNotifications((message) => {
        this.ingest(message);
      });
      this.enqueue(() => this.subscribeFrom(sinceSeq));
    } else {
      this.enqueue(() => this.subscribeFrom(this.lastApplied));
    }
    await this.whenIdle();
  }

  async reconnect(): Promise<void> {
    if (!this.started) {
      await this.start(this.lastApplied);
      return;
    }
    this.enqueue(() => this.subscribeFrom(this.lastApplied));
    await this.whenIdle();
  }

  async whenIdle(): Promise<void> {
    let seen = this.tail;
    for (;;) {
      await seen;
      if (seen === this.tail) return;
      seen = this.tail;
    }
  }

  stop(): void {
    this.stopNotifications?.();
    this.stopNotifications = null;
  }

  ingest(message: unknown): IngestResult {
    const decoded = decodeDaemonMessage(message);
    if (decoded.kind === "events.batch") {
      const reduced = reduceBatch(
        { lastApplied: this.lastApplied, applied: this.appliedEvents },
        decoded.batch,
      );
      if (reduced.action === "gap") {
        this.enqueue(() => this.subscribeFrom(this.lastApplied));
        return { action: "gap" };
      }
      if (reduced.action === "applied") {
        this.lastApplied = reduced.cursor.lastApplied;
        this.appliedEvents = [...reduced.cursor.applied];
      }
      return { action: reduced.action };
    }
    if (decoded.kind === "telemetry") {
      this.telemetryCount += 1;
      return { action: "telemetry" };
    }
    if (decoded.kind === "resync_required") {
      this.streamEpoch = null;
      this.enqueue(() => this.recoverFromSnapshot());
      return { action: "resync" };
    }
    if (decoded.kind === "invalid") {
      this.enqueue(() => this.subscribeFrom(this.lastApplied));
      return { action: "invalid" };
    }
    return { action: "ignored" };
  }

  private enqueue(task: () => Promise<void>): void {
    this.tail = this.tail.then(task, task);
  }

  private async subscribeFrom(since: number): Promise<void> {
    const params: Record<string, unknown> = {
      project: this.projectId,
      topics: [...this.topics],
      since_seq: since,
    };
    if (this.streamEpoch !== null) params.stream_epoch = this.streamEpoch;
    const result = await this.transport.request("events.subscribe", params);
    if (isAborted(result)) return;
    if (resyncRequiredSchema.safeParse(result).success) {
      await this.recoverFromSnapshot();
      return;
    }
    const live = subscribeLiveSchema.parse(result);
    this.streamEpoch = live.stream_epoch;
    this.recoveryDepth = 0;
  }

  private async recoverFromSnapshot(): Promise<void> {
    if (this.recoveryDepth >= 3) {
      throw new Error("snapshot resync did not converge");
    }
    this.recoveryDepth += 1;
    let cursor: string | undefined;
    let asOf: number | null = null;
    let epoch: string | null = null;
    const merged: Record<string, unknown> = {};
    for (let pageIndex = 0; pageIndex < 10_000; pageIndex += 1) {
      const params: Record<string, unknown> = {
        project: this.projectId,
        views: [...this.views],
      };
      if (cursor !== undefined) params.cursor = cursor;
      const result = await this.transport.request("snapshot.get", params);
      if (resyncRequiredSchema.safeParse(result).success) {
        await this.recoverFromSnapshot();
        return;
      }
      const page = snapshotPageSchema.parse(result);
      if (asOf === null || epoch === null) {
        asOf = page.as_of_seq;
        epoch = page.stream_epoch;
      } else if (page.as_of_seq !== asOf || page.stream_epoch !== epoch) {
        await this.recoverFromSnapshot();
        return;
      }
      mergeSections(merged, page.sections);
      if (page.nextCursor === null) {
        cursor = undefined;
        break;
      }
      cursor = page.nextCursor;
    }
    if (cursor !== undefined) {
      throw new Error("snapshot.get did not finish");
    }
    if (asOf === null || epoch === null) {
      throw new Error("snapshot.get returned no page");
    }
    this.sections = merged;
    this.lastApplied = asOf;
    this.streamEpoch = epoch;
    this.appliedEvents = [];
    await this.subscribeFrom(asOf);
  }
}

function isAborted(result: unknown): boolean {
  return !!result && typeof result === "object" && (result as { status?: unknown }).status === "aborted";
}

export function mergeSections(into: Record<string, unknown>, sections: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(sections)) {
    const existing = into[key];
    if (Array.isArray(value)) {
      const previous = Array.isArray(existing) ? existing : [];
      into[key] = [...previous, ...value];
    } else if (existing === undefined) {
      into[key] = value;
    }
  }
}
