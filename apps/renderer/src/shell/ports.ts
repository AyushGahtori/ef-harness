import type { AnimationFrameClock } from "./clock.js";
import type {
  DaemonEvent,
  DaemonSnapshot,
  PressureLevel,
  PressureSnapshot,
  ProjectBadge,
} from "./types.js";

export type BridgePayload =
  | {
      kind: "events.subscribe";
      projectId: string;
      sinceSeq: number;
      streamEpoch: string;
    }
  | { kind: "snapshot.get"; projectId: string }
  | { kind: "events.batch"; streamEpoch: string; events: readonly DaemonEvent[] }
  | { kind: "resync_required"; streamEpoch: string; latestSeq: number }
  | { kind: "snapshot"; snapshot: DaemonSnapshot }
  | { kind: "disconnected" }
  | { kind: "rpc"; method: "build.stop" | "build.pause" | "build.resume"; projectId: string };

export interface PreloadBridge {
  postMessage(message: BridgePayload): void;
  onMessage(listener: (message: BridgePayload) => void): () => void;
}

export interface NamedPipeClient {
  readonly pipeName: string;
  readonly connected: boolean;
  connect(): void;
  close(): void;
  send(message: BridgePayload): void;
  subscribe(listener: (message: BridgePayload) => void): () => void;
}

export interface SubscriberHandlers {
  onEvent: (event: DaemonEvent) => void;
  onDisconnect: () => void;
  onResyncRequired: (info: { streamEpoch: string; latestSeq: number }) => void;
  onSnapshot: (snapshot: DaemonSnapshot) => void;
}

export interface StreamCursor {
  seq: number;
  epoch: string;
}

export class EventStreamSubscriber {
  ignoredDuplicates = 0;
  resyncCount = 0;
  private unsubscribe: (() => void) | null = null;
  private epoch: string;
  private lastApplied: number;
  private resyncing = false;

  constructor(
    private readonly client: NamedPipeClient,
    private readonly projectId: string,
    private readonly handlers: SubscriberHandlers,
    cursor: StreamCursor,
  ) {
    this.epoch = cursor.epoch;
    this.lastApplied = cursor.seq;
  }

  get cursor(): StreamCursor {
    return { seq: this.lastApplied, epoch: this.epoch };
  }

  adopt(cursor: StreamCursor): void {
    this.epoch = cursor.epoch;
    this.lastApplied = cursor.seq;
  }

  start(): void {
    this.client.connect();
    this.client.send({
      kind: "events.subscribe",
      projectId: this.projectId,
      sinceSeq: this.lastApplied,
      streamEpoch: this.epoch,
    });
    this.unsubscribe = this.client.subscribe((message) => {
      this.onMessage(message);
    });
  }

  requestSnapshot(): void {
    this.client.send({ kind: "snapshot.get", projectId: this.projectId });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private onMessage(message: BridgePayload): void {
    if (message.kind === "disconnected") {
      this.resyncing = true;
      this.handlers.onDisconnect();
      return;
    }
    if (message.kind === "resync_required") {
      this.resync(message.streamEpoch, message.latestSeq);
      return;
    }
    if (message.kind === "snapshot") {
      this.resyncing = false;
      this.adopt({ seq: message.snapshot.asOfSeq, epoch: message.snapshot.streamEpoch });
      this.handlers.onSnapshot(message.snapshot);
      return;
    }
    if (message.kind !== "events.batch" || this.resyncing) return;
    if (message.streamEpoch !== this.epoch) {
      this.resync(message.streamEpoch, this.lastApplied);
      return;
    }
    for (const event of message.events) {
      if (event.streamEpoch !== this.epoch) {
        this.resync(event.streamEpoch, event.seq);
        return;
      }
      if (event.seq <= this.lastApplied) {
        this.ignoredDuplicates += 1;
        continue;
      }
      if (event.seq !== this.lastApplied + 1) {
        this.resync(this.epoch, event.seq);
        return;
      }
      this.lastApplied = event.seq;
      this.handlers.onEvent(event);
    }
  }

  private resync(streamEpoch: string, latestSeq: number): void {
    if (this.resyncing) return;
    this.resyncing = true;
    this.resyncCount += 1;
    this.handlers.onResyncRequired({ streamEpoch, latestSeq });
    this.requestSnapshot();
  }
}

export class MemoryNamedPipeClient implements NamedPipeClient {
  readonly pipeName = "\\\\.\\pipe\\efharness-test";
  connected = false;
  readonly sent: BridgePayload[] = [];
  private listeners = new Set<(message: BridgePayload) => void>();

  connect(): void {
    this.connected = true;
  }

  close(): void {
    this.connected = false;
    this.emit({ kind: "disconnected" });
  }

  send(message: BridgePayload): void {
    this.sent.push(message);
  }

  emit(message: BridgePayload): void {
    for (const listener of this.listeners) listener(message);
  }

  subscribe(listener: (message: BridgePayload) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export class MemoryPreloadBridge implements PreloadBridge {
  readonly sent: BridgePayload[] = [];
  private listeners = new Set<(message: BridgePayload) => void>();

  postMessage(message: BridgePayload): void {
    this.sent.push(structuredClone(message));
  }

  onMessage(listener: (message: BridgePayload) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(message: BridgePayload): void {
    for (const listener of this.listeners) listener(message);
  }
}

export class PreloadNamedPipeClient implements NamedPipeClient {
  connected = false;

  constructor(
    readonly pipeName: string,
    private readonly bridge: PreloadBridge,
  ) {}

  connect(): void {
    this.connected = true;
  }

  close(): void {
    this.connected = false;
  }

  send(message: BridgePayload): void {
    if (!this.connected) return;
    this.bridge.postMessage(message);
  }

  subscribe(listener: (message: BridgePayload) => void): () => void {
    return this.bridge.onMessage(listener);
  }
}

export interface KernelStopRequest {
  projectId: string;
  source: "top-bar" | "shortcut-confirm";
  requestedAtMs: number;
}

export interface KernelStopResult {
  stopped: true;
  latencyMs: number;
  preservedCheckpoints: true;
  destructive: false;
  resumeReady: true;
}

export interface PauseRequest {
  projectId: string;
  requestedAtMs: number;
}

export interface ResumeRequest {
  projectId: string;
  requestedAtMs: number;
}

export interface ImmediateKernelStopController {
  stopNow(request: KernelStopRequest): KernelStopResult;
  pauseAll(request: PauseRequest): { paused: true };
  resume(request: ResumeRequest): { resumed: true };
}

export class BridgeKernelStopController implements ImmediateKernelStopController {
  readonly calls: KernelStopRequest[] = [];

  constructor(
    private readonly bridge: PreloadBridge,
    private readonly clock: AnimationFrameClock,
  ) {}

  stopNow(request: KernelStopRequest): KernelStopResult {
    const started = this.clock.now();
    this.calls.push(request);
    this.bridge.postMessage({
      kind: "rpc",
      method: "build.stop",
      projectId: request.projectId,
    });
    return {
      stopped: true,
      latencyMs: this.clock.now() - started,
      preservedCheckpoints: true,
      destructive: false,
      resumeReady: true,
    };
  }

  pauseAll(request: PauseRequest): { paused: true } {
    this.bridge.postMessage({
      kind: "rpc",
      method: "build.pause",
      projectId: request.projectId,
    });
    return { paused: true };
  }

  resume(request: ResumeRequest): { resumed: true } {
    this.bridge.postMessage({
      kind: "rpc",
      method: "build.resume",
      projectId: request.projectId,
    });
    return { resumed: true };
  }
}

export interface PressureHysteresisStateMachine {
  snapshot(): PressureSnapshot;
  subscribe(listener: (snapshot: PressureSnapshot) => void): () => void;
}

export class MemoryPressureHysteresis implements PressureHysteresisStateMachine {
  private current: PressureSnapshot = { level: "green", driver: "Normal" };
  private listeners = new Set<(snapshot: PressureSnapshot) => void>();

  snapshot(): PressureSnapshot {
    return this.current;
  }

  subscribe(listener: (snapshot: PressureSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  set(level: PressureLevel, driver: string): void {
    this.current = { level, driver };
    for (const listener of this.listeners) listener(this.current);
  }
}

export interface UiLatencySample {
  p95Ms: number;
  sampleCount: number;
  atMs: number;
}

export interface HardwareGovernorLatencySink {
  ingestUiLatency(sample: UiLatencySample): void;
}

export class MemoryLatencySink implements HardwareGovernorLatencySink {
  readonly samples: UiLatencySample[] = [];

  ingestUiLatency(sample: UiLatencySample): void {
    this.samples.push(sample);
  }
}

export function defaultProject(): ProjectBadge {
  return { id: "kitchen-app", name: "kitchen-app", branch: "harness/integration" };
}
