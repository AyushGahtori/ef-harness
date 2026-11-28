import { attachHealthSlots, type BoardCardHealthSlot } from "./board-slot.js";
import { HealthSignalBadgeStrip } from "./badge-strip.js";
import { detectWorkerHealth } from "./detect.js";
import { BoardHealthSummaryPill } from "./summary-pill.js";
import { metricRow } from "./telemetry-log.js";
import {
  alarmKindOf,
  COUNTDOWN_TICK_MS,
  type AlarmSignalKind,
  type HealthBoardSnapshot,
  type HealthDaemonPort,
  type HealthMetricEvent,
  type HealthSignal,
  type TelemetryMetricWriter,
  type WorkerHealthDetection,
} from "./types.js";

export interface WorkerHealthView {
  readonly taskId: string;
  readonly connectionId: string;
  readonly attemptId: string;
  readonly inspected: boolean;
  readonly signals: readonly HealthSignal[];
  readonly suppressions: WorkerHealthDetection["suppressions"];
  readonly stuck: boolean;
  readonly strip: HealthSignalBadgeStrip;
}

export interface HealthBoardView {
  readonly nowMs: number;
  readonly modelCalls: 0;
  readonly ipcPulls: number;
  readonly localTicks: number;
  readonly workers: readonly WorkerHealthView[];
  readonly summary: BoardHealthSummaryPill;
  readonly slots: readonly BoardCardHealthSlot[];
}

interface Episode {
  readonly key: string;
  readonly signal: AlarmSignalKind;
  readonly variant: string;
  readonly taskId: string;
  readonly connectionId: string;
  readonly attemptId: string;
  readonly startedAtMs: number;
}

export interface BoardHealthSignalEngineOptions {
  readonly telemetry?: TelemetryMetricWriter;
  readonly daemon?: HealthDaemonPort;
  /** When false, the 1 Hz clock stays off and `nowMs` is the snapshot clock. */
  readonly liveClock?: boolean;
}

/**
 * Deterministic health signals for the board and office. This class never
 * calls a model. The 1 Hz timer only advances local countdowns.
 */
export class BoardHealthSignalEngine {
  private snapshot: HealthBoardSnapshot | null = null;
  private offsetMs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly episodes = new Map<string, Episode>();
  private readonly listeners = new Set<(view: HealthBoardView) => void>();
  private ipcPulls = 0;
  private localTicks = 0;
  private lastView: HealthBoardView | null = null;

  constructor(private readonly options: BoardHealthSignalEngineOptions = {}) {}

  ingest(snapshot: HealthBoardSnapshot): HealthBoardView {
    this.snapshot = snapshot;
    this.offsetMs = 0;
    this.ensureClock();
    return this.recompute(true);
  }

  /** One daemon read. Later countdown ticks do not call this again. */
  refreshFromDaemon(): HealthBoardView {
    const daemon = this.options.daemon;
    if (!daemon) {
      throw new Error("BoardHealthSignalEngine has no daemon pull port");
    }
    this.ipcPulls += 1;
    return this.ingest(daemon.pullHealthSnapshot());
  }

  view(): HealthBoardView {
    if (!this.snapshot) {
      throw new Error("BoardHealthSignalEngine has no snapshot");
    }
    return this.lastView ?? this.recompute(false);
  }

  subscribe(listener: (view: HealthBoardView) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.listeners.clear();
  }

  private ensureClock(): void {
    if (this.options.liveClock === false || this.timer) return;
    const handle = setInterval(() => {
      this.offsetMs += COUNTDOWN_TICK_MS;
      this.localTicks += 1;
      this.recompute(true);
    }, COUNTDOWN_TICK_MS);
    handle.unref?.();
    this.timer = handle;
  }

  private recompute(notify: boolean): HealthBoardView {
    const snapshot = this.snapshot;
    if (!snapshot) {
      throw new Error("BoardHealthSignalEngine has no snapshot");
    }
    const nowMs = snapshot.nowMs + this.offsetMs;
    const detections = snapshot.workers.map((worker) => detectWorkerHealth(worker, nowMs));
    this.logDiff(detections, nowMs);
    const inspected = new Map(snapshot.workers.map((worker) => [worker.taskId, worker.inspected]));
    const workers: WorkerHealthView[] = detections.map((detection) => ({
      taskId: detection.taskId,
      connectionId: detection.connectionId,
      attemptId: detection.attemptId,
      inspected: inspected.get(detection.taskId) ?? false,
      signals: detection.signals,
      suppressions: detection.suppressions,
      stuck: detection.stuck,
      strip: new HealthSignalBadgeStrip(
        detection.taskId,
        detection.signals,
        inspected.get(detection.taskId) ?? false,
      ),
    }));
    const summary = new BoardHealthSummaryPill({
      workerCount: snapshot.workers.length,
      signals: workers.flatMap((worker) => worker.signals),
    });
    const strips = new Map(workers.map((worker) => [worker.taskId, worker.strip]));
    const view: HealthBoardView = {
      nowMs,
      modelCalls: 0,
      ipcPulls: this.ipcPulls,
      localTicks: this.localTicks,
      workers,
      summary,
      slots: attachHealthSlots(
        snapshot.workers.map((worker) => ({ taskId: worker.taskId })),
        strips,
      ),
    };
    this.lastView = view;
    if (notify) {
      for (const listener of this.listeners) listener(view);
    }
    return view;
  }

  private logDiff(detections: readonly WorkerHealthDetection[], nowMs: number): void {
    const writer = this.options.telemetry;
    const current = new Map<string, Episode>();
    for (const detection of detections) {
      for (const signal of detection.signals) {
        const kind = alarmKindOf(signal.kind);
        if (!signal.alarm || !kind) continue;
        const key = `${signal.taskId}:${kind}:${signal.variant}`;
        const existing = this.episodes.get(key);
        current.set(key, existing ?? episodeFrom(signal, kind, key, nowMs));
      }
    }
    if (!writer) {
      this.episodes.clear();
      for (const [key, episode] of current) this.episodes.set(key, episode);
      return;
    }
    for (const [key, episode] of current) {
      if (this.episodes.has(key)) continue;
      const event: HealthMetricEvent = {
        event: "health_signal_triggered",
        signal: episode.signal,
        variant: episode.variant,
        taskId: episode.taskId,
        connectionId: episode.connectionId,
        atMs: nowMs,
      };
      writer.insertMetric(metricRow(episode.attemptId, event));
    }
    for (const [key, episode] of this.episodes) {
      if (current.has(key)) continue;
      const event: HealthMetricEvent = {
        event: "health_signal_resolved",
        signal: episode.signal,
        variant: episode.variant,
        taskId: episode.taskId,
        connectionId: episode.connectionId,
        atMs: nowMs,
        durationMs: Math.max(0, nowMs - episode.startedAtMs),
      };
      writer.insertMetric(metricRow(episode.attemptId, event));
    }
    this.episodes.clear();
    for (const [key, episode] of current) this.episodes.set(key, episode);
  }
}

function episodeFrom(
  signal: HealthSignal,
  kind: AlarmSignalKind,
  key: string,
  nowMs: number,
): Episode {
  return {
    key,
    signal: kind,
    variant: signal.variant,
    taskId: signal.taskId,
    connectionId: signal.connectionId,
    attemptId: signal.attemptId,
    startedAtMs: nowMs,
  };
}
