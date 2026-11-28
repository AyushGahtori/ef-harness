import { JsonRpcRequestSchema, normalizeGovernorPressure, type JsonRpcRequest } from "@ef-harness/shared-contracts";
import type { AnimationFrameClock } from "./clock.js";
import type { DaemonEvent, DaemonSnapshot, PressureSnapshot, ProjectBadge } from "./types.js";

export type ShellDownlink =
  | {
      jsonrpc: "2.0";
      method: "events.batch";
      params: { stream_epoch: string; events: readonly DaemonEvent[] };
    }
  | {
      jsonrpc: "2.0";
      method: "resync_required";
      params: { stream_epoch: string; latest_seq: number };
    }
  | {
      jsonrpc: "2.0";
      method: "snapshot";
      params: { snapshot: DaemonSnapshot };
    }
  | { jsonrpc: "2.0"; method: "disconnected" };

export interface TelemetryMetricMessage {
  jsonrpc: "2.0";
  id: number;
  method: "telemetry.metric";
  params: {
    attempt: string | null;
    ts: number;
    kind: "metric";
    data: unknown;
  };
}

export interface CockpitExplainMessage {
  jsonrpc: "2.0";
  id: number;
  method: "cockpit.explain";
  params: {
    contractId: "cockpit-explainer@1";
    modelOutput: unknown;
  };
}

export type ShellPortMessage = JsonRpcRequest | ShellDownlink | TelemetryMetricMessage | CockpitExplainMessage;

/**
 * Preload MessagePort handed across by the desktop utility process.
 * The renderer posts canonical JSON-RPC and never opens a pipe.
 */
export interface PreloadMessagePort {
  postMessage(message: ShellPortMessage): void;
  onMessage(listener: (message: ShellPortMessage) => void): () => void;
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

const SUBSCRIBE_TOPICS = ["worker", "run", "spend", "inbox", "governor"] as const;
const SNAPSHOT_VIEWS = ["shell"] as const;

export class EventStreamSubscriber {
  ignoredDuplicates = 0;
  resyncCount = 0;
  private unsubscribe: (() => void) | null = null;
  private epoch: string;
  private lastApplied: number;
  private resyncing = false;
  private rpcId = 1;

  constructor(
    private readonly port: PreloadMessagePort,
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
    this.port.postMessage(
      readOnlyRpc(
        "events.subscribe",
        {
          project: this.projectId,
          topics: [...SUBSCRIBE_TOPICS],
          since_seq: this.lastApplied,
        },
        this.rpcId,
      ),
    );
    this.rpcId += 1;
    this.unsubscribe = this.port.onMessage((message) => {
      this.onMessage(message);
    });
  }

  requestSnapshot(): void {
    this.port.postMessage(
      readOnlyRpc(
        "snapshot.get",
        { project: this.projectId, views: [...SNAPSHOT_VIEWS] },
        this.rpcId,
      ),
    );
    this.rpcId += 1;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private onMessage(message: ShellPortMessage): void {
    if (!isDownlink(message)) return;
    if (message.method === "disconnected") {
      this.resyncing = true;
      this.handlers.onDisconnect();
      return;
    }
    if (message.method === "resync_required") {
      this.resync(message.params.stream_epoch, message.params.latest_seq);
      return;
    }
    if (message.method === "snapshot") {
      this.resyncing = false;
      this.adopt({ seq: message.params.snapshot.asOfSeq, epoch: message.params.snapshot.streamEpoch });
      this.handlers.onSnapshot(message.params.snapshot);
      return;
    }
    if (this.resyncing) return;
    if (message.params.stream_epoch !== this.epoch) {
      const latest = message.params.events.at(-1)?.seq ?? this.lastApplied;
      this.resync(message.params.stream_epoch, latest);
      return;
    }
    for (const event of message.params.events) {
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

export class MemoryPreloadPort implements PreloadMessagePort {
  readonly sent: ShellPortMessage[] = [];
  private listeners = new Set<(message: ShellPortMessage) => void>();

  postMessage(message: ShellPortMessage): void {
    this.sent.push(structuredClone(message));
  }

  onMessage(listener: (message: ShellPortMessage) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  deliver(message: ShellDownlink): void {
    for (const listener of this.listeners) listener(message);
  }

  close(): void {
    this.deliver({ jsonrpc: "2.0", method: "disconnected" });
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
  private rpcId = 1;
  private opSeq = 0;

  constructor(
    private readonly port: PreloadMessagePort,
    private readonly clock: AnimationFrameClock,
  ) {}

  stopNow(request: KernelStopRequest): KernelStopResult {
    const started = this.clock.now();
    this.calls.push(request);
    this.postMutating("build.stop", "stop", request.projectId, request.requestedAtMs);
    return {
      stopped: true,
      latencyMs: this.clock.now() - started,
      preservedCheckpoints: true,
      destructive: false,
      resumeReady: true,
    };
  }

  pauseAll(request: PauseRequest): { paused: true } {
    this.postMutating("build.pauseAll", "pause", request.projectId, request.requestedAtMs);
    return { paused: true };
  }

  resume(request: ResumeRequest): { resumed: true } {
    this.postMutating("build.start", "resume", request.projectId, request.requestedAtMs);
    return { resumed: true };
  }

  private postMutating(
    method: "build.stop" | "build.pauseAll" | "build.start",
    prefix: string,
    projectId: string,
    atMs: number,
  ): void {
    this.opSeq += 1;
    const opId = `${prefix}-${atMs}-${this.opSeq}`;
    this.port.postMessage(mutatingRpc(method, opId, projectId, this.rpcId));
    this.rpcId += 1;
  }
}

export interface PressureHysteresisStateMachine {
  snapshot(): PressureSnapshot;
  subscribe(listener: (snapshot: PressureSnapshot) => void): () => void;
}

export class MemoryPressureHysteresis implements PressureHysteresisStateMachine {
  private current: PressureSnapshot = { level: "GREEN", driver: "Normal" };
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

  set(level: string, driver: string): void {
    const canonical = normalizeGovernorPressure(level);
    if (!canonical) return;
    this.current = { level: canonical, driver };
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

function readOnlyRpc(
  method: "events.subscribe" | "snapshot.get",
  params: { project: string; topics?: readonly string[]; since_seq?: number; views?: readonly string[] },
  id: number,
): JsonRpcRequest {
  return JsonRpcRequestSchema.parse({
    jsonrpc: "2.0",
    id,
    method,
    params,
  });
}

function mutatingRpc(
  method: "build.stop" | "build.pauseAll" | "build.start",
  opId: string,
  projectId: string,
  id: number,
): JsonRpcRequest {
  return JsonRpcRequestSchema.parse({
    jsonrpc: "2.0",
    id,
    method,
    op_id: opId,
    params: { project_id: projectId },
  });
}

function isDownlink(message: ShellPortMessage): message is ShellDownlink {
  return message.jsonrpc === "2.0" && !("id" in message);
}
