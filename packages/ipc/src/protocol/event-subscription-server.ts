import {
  DEFAULT_MAX_QUEUED_TELEMETRY,
  DEFAULT_REPLAY_PAGE_SIZE,
} from "./constants.js";
import { ProjectNotFoundError } from "./errors.js";
import { splitEnvelopes, type EventsBatch } from "./envelopes.js";
import { notify } from "./jsonrpc.js";
import { SubscriptionMetricsRegistry } from "./metrics.js";
import { ClientOutbound } from "./outbound.js";
import type {
  DomainEvent,
  JsonRpcNotification,
  ProjectOutboxDirectory,
  ProtocolConnection,
  TelemetryNote,
} from "./ports.js";

export interface SubscribeParams {
  readonly project: string;
  readonly topics: readonly string[];
  readonly since_seq: number;
  readonly stream_epoch?: string;
}

export interface SubscribeLiveResult {
  readonly status: "live";
  readonly stream_epoch: string;
  readonly last_seq: number;
  readonly replayed_from: number;
  readonly replayed_to: number;
}

export interface ResyncRequiredResult {
  readonly status: "resync_required";
  readonly current_stream_epoch: string;
  readonly latest_seq: number;
}

export interface SubscribeAbortedResult {
  readonly status: "aborted";
  readonly stream_epoch: string;
  readonly last_seq: number;
}

export type SubscribeResult = SubscribeLiveResult | ResyncRequiredResult | SubscribeAbortedResult;

interface Subscription {
  readonly connection: ProtocolConnection;
  readonly projectId: string;
  readonly topics: readonly string[];
  phase: "arming" | "live" | "closed";
  aborted: boolean;
  buffer: DomainEvent[];
  /** Highest seq handed to the outbound queue, including batches still waiting on a slow socket. */
  coveredSeq: number;
  /** Highest seq actually written to the socket. Lag is highWater - lastSentSeq. */
  lastSentSeq: number;
  highWater: number;
  flushing: boolean;
  readonly outbound: ClientOutbound;
}

export interface EventSubscriptionServerOptions {
  readonly outboxes: ProjectOutboxDirectory;
  readonly metrics?: SubscriptionMetricsRegistry;
  readonly now?: () => number;
  readonly replayPageSize?: number;
  readonly maxQueuedTelemetry?: number;
}

export class EventSubscriptionServer {
  private readonly outboxes: ProjectOutboxDirectory;
  private readonly metrics: SubscriptionMetricsRegistry;
  private readonly now: () => number;
  private readonly replayPageSize: number;
  private readonly maxQueuedTelemetry: number;
  private readonly subscriptions = new Set<Subscription>();
  private readonly watched = new Set<string>();

  constructor(options: EventSubscriptionServerOptions) {
    this.outboxes = options.outboxes;
    this.metrics = options.metrics ?? new SubscriptionMetricsRegistry();
    this.now = options.now ?? (() => Date.now());
    this.replayPageSize = options.replayPageSize ?? DEFAULT_REPLAY_PAGE_SIZE;
    this.maxQueuedTelemetry = options.maxQueuedTelemetry ?? DEFAULT_MAX_QUEUED_TELEMETRY;
  }

  getMetrics(): SubscriptionMetricsRegistry {
    return this.metrics;
  }

  async subscribe(connection: ProtocolConnection, params: SubscribeParams): Promise<SubscribeResult> {
    this.watch(connection);
    this.abortExisting(connection.connectionId, params.project);
    const repo = this.outboxes.get(params.project);
    if (!repo) throw new ProjectNotFoundError(params.project);
    const sub = this.arm(connection, params);
    try {
      const epoch = await repo.getStreamEpoch();
      const minSeq = await repo.getMinRetainedSeq();
      const latest = await repo.getLatestSeq();
      if (sub.aborted || connection.isClosed()) {
        this.drop(sub);
        return { status: "aborted", stream_epoch: epoch, last_seq: params.since_seq };
      }
      if (latest > sub.highWater) sub.highWater = latest;
      if (this.needsResync(params, epoch, minSeq)) {
        this.metrics.recordResync(connection.connectionId, params.project);
        this.refreshLag(sub);
        this.drop(sub);
        return { status: "resync_required", current_stream_epoch: epoch, latest_seq: latest };
      }
      const started = this.now();
      let cursor = params.since_seq;
      while (!connection.isClosed() && !sub.aborted) {
        const rows = await repo.replayEventsSince(cursor, undefined, this.replayPageSize);
        if (connection.isClosed() || sub.aborted) break;
        if (rows.length === 0) break;
        for (const row of rows) {
          if (row.seq > sub.highWater) sub.highWater = row.seq;
        }
        const next = this.emitRows(sub, rows, cursor);
        if (next <= cursor) break;
        cursor = next;
        if (rows.length < this.replayPageSize) break;
      }
      if (connection.isClosed() || sub.aborted) {
        const last = cursor;
        this.drop(sub);
        return { status: "aborted", stream_epoch: epoch, last_seq: last };
      }
      const drained = this.drainToLive(sub, cursor);
      if (connection.isClosed() || sub.aborted) {
        this.drop(sub);
        return { status: "aborted", stream_epoch: epoch, last_seq: drained };
      }
      this.metrics.recordReplay(connection.connectionId, params.project, this.now() - started);
      this.refreshLag(sub);
      return {
        status: "live",
        stream_epoch: epoch,
        last_seq: drained,
        replayed_from: params.since_seq,
        replayed_to: drained,
      };
    } catch (error) {
      this.drop(sub);
      throw error;
    }
  }

  publishDomain(projectId: string, event: DomainEvent): void {
    for (const sub of this.subscriptions) {
      if (sub.projectId !== projectId || sub.aborted || sub.phase === "closed") continue;
      if (event.seq > sub.highWater) sub.highWater = event.seq;
      if (event.seq <= sub.coveredSeq || sub.buffer.some((existing) => existing.seq === event.seq)) {
        this.refreshLag(sub);
        continue;
      }
      sub.buffer.push(event);
      if (sub.phase === "live") this.flushLive(sub);
      this.refreshLag(sub);
    }
  }

  publishTelemetry(projectId: string, note: TelemetryNote): void {
    const message = notify("telemetry", {
      project: projectId,
      kind: note.kind,
      payload: note.payload,
    });
    for (const sub of this.subscriptions) {
      if (sub.projectId !== projectId || sub.aborted || sub.phase === "closed") continue;
      sub.outbound.enqueueTelemetry(message);
    }
  }

  private needsResync(params: SubscribeParams, epoch: string, minSeq: number): boolean {
    if (params.stream_epoch !== undefined && params.stream_epoch !== epoch) return true;
    // since_seq 0 on an empty project has minSeq 1 and replays. A pruned
    // history (minSeq > since_seq + 1), including a fresh window at 0, cannot
    // be continued without mixing a hole into last_applied.
    return minSeq > params.since_seq + 1;
  }

  private watch(connection: ProtocolConnection): void {
    if (this.watched.has(connection.connectionId)) return;
    this.watched.add(connection.connectionId);
    connection.onClose(() => {
      this.closeConnection(connection.connectionId);
      this.watched.delete(connection.connectionId);
    });
  }

  private closeConnection(connectionId: string): void {
    for (const sub of [...this.subscriptions]) {
      if (sub.connection.connectionId !== connectionId) continue;
      this.drop(sub);
    }
  }

  private abortExisting(connectionId: string, projectId: string): void {
    for (const sub of [...this.subscriptions]) {
      if (sub.connection.connectionId !== connectionId || sub.projectId !== projectId) continue;
      this.drop(sub);
    }
  }

  private arm(connection: ProtocolConnection, params: SubscribeParams): Subscription {
    const holder: { sub?: Subscription } = {};
    const outbound = new ClientOutbound(
      connection,
      this.maxQueuedTelemetry,
      (count) => {
        this.metrics.addDroppedTelemetry(connection.connectionId, params.project, count);
      },
      (message) => {
        const current = holder.sub;
        if (current) this.noteSent(current, message);
      },
    );
    const sub: Subscription = {
      connection,
      projectId: params.project,
      topics: params.topics,
      phase: "arming",
      aborted: false,
      buffer: [],
      coveredSeq: params.since_seq,
      lastSentSeq: params.since_seq,
      highWater: params.since_seq,
      flushing: false,
      outbound,
    };
    holder.sub = sub;
    this.subscriptions.add(sub);
    return sub;
  }

  private drop(sub: Subscription): void {
    sub.aborted = true;
    sub.phase = "closed";
    sub.buffer = [];
    sub.outbound.stop();
    this.subscriptions.delete(sub);
  }

  private noteSent(sub: Subscription, message: JsonRpcNotification): void {
    if (message.method !== "events.batch" || !message.params || typeof message.params !== "object") return;
    const toSeq = (message.params as { to_seq?: unknown }).to_seq;
    if (typeof toSeq !== "number") return;
    if (toSeq > sub.lastSentSeq) sub.lastSentSeq = toSeq;
    this.refreshLag(sub);
  }

  private refreshLag(sub: Subscription): void {
    this.metrics.setLag(
      sub.connection.connectionId,
      sub.projectId,
      Math.max(0, sub.highWater - sub.lastSentSeq),
    );
  }

  private emitRows(sub: Subscription, rows: readonly DomainEvent[], previousSeq: number): number {
    let cursor = previousSeq;
    for (const batch of splitEnvelopes(previousSeq, rows, sub.topics)) {
      if (sub.aborted || sub.connection.isClosed()) return cursor;
      this.sendBatch(sub, batch);
      cursor = batch.to_seq;
      if (cursor > sub.coveredSeq) sub.coveredSeq = cursor;
    }
    return cursor;
  }

  private sendBatch(sub: Subscription, batch: EventsBatch): void {
    sub.outbound.enqueueDomain(notify("events.batch", batch));
  }

  private drainToLive(sub: Subscription, scannedTo: number): number {
    let cursor = scannedTo;
    for (;;) {
      if (sub.aborted || sub.connection.isClosed()) return cursor;
      const pending = sub.buffer.filter((event) => event.seq > cursor);
      const pendingSeqs = new Set(pending.map((event) => event.seq));
      sub.buffer = sub.buffer.filter((event) => event.seq > cursor && !pendingSeqs.has(event.seq));
      if (pending.length === 0) {
        sub.phase = "live";
        sub.flushing = false;
        return cursor;
      }
      cursor = this.emitRows(sub, pending, cursor);
    }
  }

  private flushLive(sub: Subscription): void {
    if (sub.phase !== "live" || sub.flushing) return;
    sub.flushing = true;
    try {
      while (sub.buffer.length > 0 && !sub.aborted && !sub.connection.isClosed()) {
        const pending = sub.buffer.splice(0, sub.buffer.length).filter((event) => event.seq > sub.coveredSeq);
        if (pending.length === 0) continue;
        this.emitRows(sub, pending, sub.coveredSeq);
      }
    } finally {
      sub.flushing = false;
    }
    if (sub.phase === "live" && sub.buffer.length > 0 && !sub.aborted) this.flushLive(sub);
  }
}
