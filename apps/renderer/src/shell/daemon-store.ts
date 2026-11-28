import type { AnimationFrameClock } from "./clock.js";
import type { UiLatencyHeartbeatMonitor } from "./heartbeat.js";
import type {
  DaemonEvent,
  DaemonSnapshot,
  DaemonView,
  InboxItem,
  PressureSnapshot,
  RunMode,
  SpendEntry,
  SpendState,
  WorkerView,
} from "./types.js";
import { defaultProject } from "./ports.js";

export interface DaemonStoreOptions {
  clock: AnimationFrameClock;
  heartbeat?: UiLatencyHeartbeatMonitor;
  initial: DaemonSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRunMode(value: string): value is RunMode {
  return value === "idle" || value === "running" || value === "paused" || value === "stopped";
}

function isSpendEntry(value: unknown): value is SpendEntry {
  if (!isRecord(value) || typeof value.connectionLabel !== "string") return false;
  if (value.kind === "api") {
    return typeof value.spentUsd === "number" && typeof value.capUsd === "number";
  }
  if (value.kind === "subscription") {
    return typeof value.percentOfWindow === "number" && typeof value.windowLabel === "string";
  }
  return false;
}

function isSpendState(value: unknown): value is SpendState {
  if (!isRecord(value) || !isSpendEntry(value.active) || !Array.isArray(value.breakdown)) return false;
  return value.breakdown.every(isSpendEntry);
}

function isInboxItem(value: unknown): value is InboxItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    (value.bucket === "needs-you" || value.bucket === "chat" || value.bucket === "fyi") &&
    typeof value.title === "string" &&
    typeof value.unread === "boolean"
  );
}

function isPressure(value: unknown): value is PressureSnapshot {
  if (!isRecord(value) || typeof value.driver !== "string") return false;
  return (
    value.level === "green" ||
    value.level === "yellow" ||
    value.level === "orange" ||
    value.level === "red"
  );
}

export function createDaemonSnapshot(
  patch: Partial<Omit<DaemonSnapshot, "project" | "spend" | "governor">> & {
    project?: DaemonSnapshot["project"];
    spend?: SpendState;
    governor?: PressureSnapshot;
    workers?: readonly WorkerView[];
    inbox?: readonly InboxItem[];
  } = {},
): DaemonSnapshot {
  const spend = patch.spend ?? {
    active: { kind: "api", connectionLabel: "API", spentUsd: 0, capUsd: 10 },
    breakdown: [{ kind: "api", connectionLabel: "API", spentUsd: 0, capUsd: 10 }],
  };
  return {
    asOfSeq: patch.asOfSeq ?? 0,
    streamEpoch: patch.streamEpoch ?? "epoch-1",
    project: patch.project ?? defaultProject(),
    run: patch.run ?? "idle",
    workers: patch.workers ?? [],
    inbox: patch.inbox ?? [],
    spend,
    governor: patch.governor ?? { level: "green", driver: "Normal" },
  };
}

export class DaemonStore {
  commitCount = 0;
  appliedCount = 0;
  lastFlushWorkMs = 0;
  lastBatchLatencyMs = 0;
  overBudgetFlushes = 0;
  private viewState: DaemonSnapshot;
  private queue: DaemonEvent[] = [];
  private frame: number | null = null;
  private inputAt: number | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly options: DaemonStoreOptions) {
    this.viewState = cloneSnapshot(options.initial);
  }

  get cursor(): { seq: number; epoch: string } {
    return { seq: this.viewState.asOfSeq, epoch: this.viewState.streamEpoch };
  }

  view(): DaemonView {
    return cloneSnapshot(this.viewState);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  noteInput(atMs: number): void {
    this.inputAt = atMs;
  }

  hydrate(snapshot: DaemonSnapshot): void {
    this.viewState = cloneSnapshot(snapshot);
    this.queue = [];
    if (this.frame !== null) {
      this.options.clock.cancelFrame(this.frame);
      this.frame = null;
    }
    this.emit();
  }

  setRun(mode: RunMode): void {
    this.viewState = { ...this.viewState, run: mode };
    this.emit();
  }

  setGovernor(governor: PressureSnapshot): void {
    this.viewState = { ...this.viewState, governor };
    this.emit();
  }

  ingest(event: DaemonEvent): void {
    this.queue.push(event);
    if (this.frame !== null) return;
    this.frame = this.options.clock.requestFrame((time) => {
      this.frame = null;
      this.flush(time);
    });
  }

  dispose(): void {
    if (this.frame !== null) this.options.clock.cancelFrame(this.frame);
    this.frame = null;
    this.listeners.clear();
  }

  private flush(paintAt: number): void {
    const batch = this.queue;
    this.queue = [];
    if (batch.length === 0) return;
    const workStart = performance.now();
    for (const event of batch) this.apply(event);
    this.lastFlushWorkMs = performance.now() - workStart;
    this.commitCount += 1;
    this.appliedCount += batch.length;
    if (this.inputAt !== null) {
      this.lastBatchLatencyMs = paintAt - this.inputAt;
      this.options.heartbeat?.noteSample(
        this.lastBatchLatencyMs,
        paintAt,
        this.options.clock.hidden(),
      );
      this.inputAt = null;
    }
    if (this.lastFlushWorkMs >= 16) this.overBudgetFlushes += 1;
    this.emit();
  }

  private apply(event: DaemonEvent): void {
    this.viewState = { ...this.viewState, asOfSeq: event.seq, streamEpoch: event.streamEpoch };
    const payload = event.payload;
    if (event.type === "worker.status" && isRecord(payload) && typeof payload.id === "string") {
      const next: WorkerView = {
        id: payload.id,
        status: typeof payload.status === "string" ? payload.status : "working",
        detail: typeof payload.detail === "string" ? payload.detail : "",
        updatedSeq: event.seq,
      };
      const workers = this.viewState.workers.filter((worker) => worker.id !== next.id);
      workers.push(next);
      this.viewState = { ...this.viewState, workers };
      return;
    }
    if (event.type === "run.state" && isRecord(payload) && typeof payload.mode === "string") {
      if (isRunMode(payload.mode)) this.viewState = { ...this.viewState, run: payload.mode };
      return;
    }
    if (event.type === "spend.updated" && isSpendState(payload)) {
      this.viewState = { ...this.viewState, spend: payload };
      return;
    }
    if (event.type === "inbox.updated" && isRecord(payload) && Array.isArray(payload.items)) {
      const items = payload.items.filter(isInboxItem);
      this.viewState = { ...this.viewState, inbox: items };
      return;
    }
    if (event.type === "governor.updated" && isPressure(payload)) {
      this.viewState = { ...this.viewState, governor: payload };
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function cloneSnapshot(snapshot: DaemonSnapshot): DaemonSnapshot {
  return {
    asOfSeq: snapshot.asOfSeq,
    streamEpoch: snapshot.streamEpoch,
    project: { ...snapshot.project },
    run: snapshot.run,
    workers: snapshot.workers.map((worker) => ({ ...worker })),
    inbox: snapshot.inbox.map((item) => ({ ...item })),
    spend: {
      active: { ...snapshot.spend.active },
      breakdown: snapshot.spend.breakdown.map((entry) => ({ ...entry })),
    },
    governor: { ...snapshot.governor },
  };
}

export class DaemonStoreProvider {
  constructor(readonly store: DaemonStore) {}

  getSnapshot(): DaemonView {
    return this.store.view();
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener);
  }
}
