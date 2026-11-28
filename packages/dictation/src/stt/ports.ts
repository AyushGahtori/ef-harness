import path from "node:path";
import type {
  JobAccounting,
  JobHandle,
  JobSpec,
  ProcessSupervisor,
  SpawnedProcess,
  SpawnRequest,
  WindowsJobObjectManager,
} from "@ef-harness/sandbox";
import { redactSecrets } from "@ef-harness/shared-observability";
import { DictationError, WhisperComponentUnavailable } from "./errors.js";
import type {
  AudioInputDevice,
  ComposerDraftSnapshot,
  DictationDraftUpdate,
  FallbackReason,
  HypothesisToken,
  MachineCalibrationSnapshot,
  MicFault,
  VocabularyLookup,
  WhisperComponentReady,
  WhisperComponentStatus,
  WhisperModelId,
} from "./types.js";

export interface MachineCalibrationPort {
  snapshot(): MachineCalibrationSnapshot;
}

/**
 * Structural port for Task 118 `GpuWhisperPriorityArbiter`.
 * Dictation is below governor on the layer DAG, so this package does not import it.
 * `activateDictation` / `deactivateDictation` match that class.
 */
export interface DictationGpuGrant {
  readonly priority: "interactive";
  readonly device: "gpu" | "cpu";
  readonly reservedMb: number;
  readonly modelClass: "base" | "small" | "medium";
  readonly ready: true;
}

export interface GpuWhisperPriorityArbiterPort {
  activateDictation(modelClass?: "base" | "small" | "medium"): DictationGpuGrant;
  deactivateDictation(): readonly { readonly id: string }[];
  readonly dictationActive: boolean;
}

/**
 * Structural port for Task 132 `SignedComponentDownloader.download`.
 * Daemon rank is above dictation, so the downloader is injected.
 */
export interface InstalledSignedComponent {
  readonly componentId: string;
  readonly version: string;
  readonly label: string;
  readonly directory: string;
  readonly sha256: string;
  readonly verified: true;
}

export interface SignedComponentDownloaderPort {
  download(componentId: string): Promise<InstalledSignedComponent>;
}

/**
 * Task 040 `WindowsJobObjectManager` methods dictation uses to supervise whisper.cpp.
 * `WindowsJobObjectManager` is assignable to this port.
 */
export type WindowsJobObjectPort = Pick<
  ProcessSupervisor,
  "createJob" | "spawnInJob" | "terminateJob" | "closeJob" | "queryJobAccounting"
>;

export type WindowsJobObjectManagerSatisfiesDictationPort = WindowsJobObjectManager extends WindowsJobObjectPort
  ? true
  : never;

/** Hypothesis source. The integrator swaps this for whisper.cpp stdout. */
export interface WhisperDecoderPort {
  decode(samples: Int16Array, context: WhisperDecoderContext): readonly HypothesisToken[];
}

/** Local stand-in for Windows speech / Web Speech. Audio stays on device. */
export interface OsSpeechRecognizerPort {
  start(): void;
  stop(): void;
  readonly running: boolean;
  transcribe(samples: Int16Array): readonly HypothesisToken[];
}

/** Local stand-in for Task 155 `SingleComposerView`. Dictation never calls submit itself. */
export interface SingleComposerViewPort {
  readonly targetKey: string;
  applyDictationDraft(draft: DictationDraftUpdate): void;
  submitExplicit(text: string): void;
  snapshot(): ComposerDraftSnapshot;
}

export interface AudioCapturePort {
  listDevices(): readonly AudioInputDevice[];
  start(deviceId: string): { ok: true } | { ok: false; reason: MicFault };
  stop(): void;
  onFault(listener: (reason: MicFault) => void): void;
}

/** Local stand-in for Task 158 vocabulary membership. Unknown terms stay eligible for amber. */
export type VocabularyLookupPort = VocabularyLookup;

export interface SupervisedChild {
  readonly jobId: string;
  readonly pid: number;
  readonly args: readonly string[];
  pushStdin(bytes: Uint8Array): void;
  terminate(): void;
  readonly stdinBytes: number;
  readonly terminated: boolean;
}

export interface WhisperDecoderContext {
  readonly carryInitialPrompt?: string;
}

export class InMemoryMachineCalibration implements MachineCalibrationPort {
  constructor(public current: MachineCalibrationSnapshot) {}

  snapshot(): MachineCalibrationSnapshot {
    return this.current;
  }
}

export class InMemoryGpuWhisperPriorityArbiter implements GpuWhisperPriorityArbiterPort {
  private active = false;
  activateCount = 0;
  deactivateCount = 0;
  backgroundDeferred = false;
  lastModelClass: "base" | "small" | "medium" | null = null;

  get dictationActive(): boolean {
    return this.active;
  }

  get acquireCount(): number {
    return this.activateCount;
  }

  get releaseCount(): number {
    return this.deactivateCount;
  }

  heldLeaseId(): string | null {
    return this.active ? "dictation" : null;
  }

  activateDictation(modelClass: "base" | "small" | "medium" = "base"): DictationGpuGrant {
    this.lastModelClass = modelClass;
    if (!this.active) {
      this.activateCount += 1;
      this.backgroundDeferred = true;
      this.active = true;
    }
    return {
      priority: "interactive",
      device: "gpu",
      reservedMb: 0,
      modelClass,
      ready: true,
    };
  }

  deactivateDictation(): readonly { readonly id: string }[] {
    if (!this.active) return [];
    this.active = false;
    this.backgroundDeferred = false;
    this.deactivateCount += 1;
    return [];
  }
}

export class InMemorySignedComponentDownloader implements SignedComponentDownloaderPort {
  lastComponentId: string | null = null;

  constructor(public result: WhisperComponentStatus) {}

  async download(componentId: string): Promise<InstalledSignedComponent> {
    this.lastComponentId = componentId;
    if (!this.result.available) {
      throw new WhisperComponentUnavailable(this.result.reason, this.result.reason);
    }
    return {
      componentId,
      version: "1",
      label: componentId,
      directory: path.posix.dirname(this.result.modelPath),
      sha256: "0".repeat(64),
      verified: true,
    };
  }
}

class InMemoryWhisperChild implements SupervisedChild {
  stdin = new Uint8Array(0);
  terminated = false;
  closed = false;

  readonly slot: number;
  readonly startTime = 0;
  readonly imagePath: string | null;
  readonly commandLine: string | null;

  constructor(
    readonly jobId: string,
    readonly pid: number,
    readonly args: readonly string[],
    file: string,
  ) {
    this.slot = pid;
    this.imagePath = file;
    this.commandLine = [file, ...args].join(" ");
  }

  get stdinBytes(): number {
    return this.stdin.byteLength;
  }

  pushStdin(bytes: Uint8Array): void {
    if (this.terminated) return;
    const next = new Uint8Array(this.stdin.byteLength + bytes.byteLength);
    next.set(this.stdin);
    next.set(bytes, this.stdin.byteLength);
    this.stdin.fill(0);
    this.stdin = next;
  }

  terminate(): void {
    this.stdin.fill(0);
    this.stdin = new Uint8Array(0);
    this.terminated = true;
  }
}

export class InMemoryWindowsJobSupervisor implements WindowsJobObjectPort {
  readonly jobs = new Map<string, InMemoryWhisperChild>();
  readonly diskWrites: string[] = [];
  private sequence = 0;
  private readonly handles = new Map<string, JobHandle>();

  async createJob(spec: JobSpec): Promise<JobHandle> {
    if (spec.name.trim().length === 0) {
      throw new DictationError("job", "job name is required");
    }
    this.sequence += 1;
    const handle: JobHandle = {
      id: `whisper-job-${this.sequence}`,
      name: spec.name,
      kind: spec.kind,
      parentId: spec.parent?.id ?? null,
      limits: spec.limits,
      requestedLimits: spec.limits,
      limitsClamped: false,
      timeoutMs: spec.timeoutMs ?? null,
    };
    this.handles.set(handle.id, handle);
    return handle;
  }

  async spawnInJob(job: JobHandle, request: SpawnRequest): Promise<SpawnedProcess> {
    if (!this.handles.has(job.id)) {
      throw new DictationError("job", "unknown whisper job");
    }
    if (request.file.trim().length === 0) {
      throw new DictationError("job", "whisper.cpp binary path is empty");
    }
    for (const arg of request.args) {
      if (/\.wav$/i.test(arg) || /^https?:\/\//i.test(arg)) {
        throw new DictationError("audio", "Refusing to persist or upload raw audio");
      }
    }
    const child = new InMemoryWhisperChild(job.id, this.sequence, request.args, request.file);
    this.jobs.set(child.jobId, child);
    return child;
  }

  async terminateJob(job: JobHandle): Promise<JobAccounting> {
    this.finish(job.id);
    return accounting();
  }

  async closeJob(job: JobHandle): Promise<void> {
    this.finish(job.id);
  }

  async queryJobAccounting(job: JobHandle): Promise<JobAccounting> {
    const child = this.jobs.get(job.id);
    const report = accounting();
    if (!child || child.terminated) return report;
    return { ...report, activeProcesses: 1, totalTerminatedProcesses: 0 };
  }

  activeChildCount(jobId: string): number {
    const child = this.jobs.get(jobId);
    if (!child || child.closed || child.terminated) return 0;
    return 1;
  }

  private finish(jobId: string): void {
    const child = this.jobs.get(jobId);
    if (!child) return;
    child.terminate();
    child.closed = true;
  }
}

export class ScriptedWhisperDecoder implements WhisperDecoderPort {
  readonly frames: HypothesisToken[][] = [];
  calls = 0;
  lastSampleCount = 0;
  lastPrompt: string | null = null;

  queue(frame: readonly HypothesisToken[]): void {
    this.frames.push([...frame]);
  }

  decode(samples: Int16Array, context: WhisperDecoderContext): readonly HypothesisToken[] {
    this.calls += 1;
    this.lastSampleCount = samples.length;
    this.lastPrompt = context.carryInitialPrompt ?? null;
    return this.frames.shift() ?? [];
  }
}

export class ScriptedOsSpeechRecognizer implements OsSpeechRecognizerPort {
  running = false;
  readonly frames: HypothesisToken[][] = [];

  queue(frame: readonly HypothesisToken[]): void {
    this.frames.push([...frame]);
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  transcribe(samples: Int16Array): readonly HypothesisToken[] {
    if (!this.running || samples.length === 0) return [];
    return this.frames.shift() ?? [];
  }
}

export class InMemorySingleComposer implements SingleComposerViewPort {
  confirmed = "";
  tentative = "";
  cursor = 0;
  hint: string | null = null;
  status: string | null = null;
  submitCount = 0;
  lastSubmitted: string | null = null;

  constructor(readonly targetKey = "general") {}

  applyDictationDraft(draft: DictationDraftUpdate): void {
    this.confirmed = draft.confirmed;
    this.tentative = draft.tentative;
    this.cursor = draft.cursor;
    this.hint = draft.hint;
    this.status = draft.status;
  }

  submitExplicit(text: string): void {
    this.submitCount += 1;
    this.lastSubmitted = text;
  }

  snapshot(): ComposerDraftSnapshot {
    return {
      targetKey: this.targetKey,
      confirmed: this.confirmed,
      tentative: this.tentative,
      cursor: this.cursor,
      hint: this.hint,
      status: this.status,
      submitCount: this.submitCount,
      lastSubmitted: this.lastSubmitted,
    };
  }
}

export class InMemoryAudioCapture implements AudioCapturePort {
  devices: AudioInputDevice[] = [{ id: "default", label: "Microphone Array" }];
  running = false;
  failNext: MicFault | null = null;
  private fault: ((reason: MicFault) => void) | null = null;

  listDevices(): readonly AudioInputDevice[] {
    return this.devices;
  }

  onFault(listener: (reason: MicFault) => void): void {
    this.fault = listener;
  }

  start(deviceId: string): { ok: true } | { ok: false; reason: MicFault } {
    if (this.failNext) {
      const reason = this.failNext;
      this.failNext = null;
      return { ok: false, reason };
    }
    if (!this.devices.some((device) => device.id === deviceId)) {
      return { ok: false, reason: "missing_device" };
    }
    this.running = true;
    return { ok: true };
  }

  stop(): void {
    this.running = false;
  }

  disconnect(): void {
    this.running = false;
    this.fault?.("disconnected");
  }
}

export class MemoryVocabulary implements VocabularyLookupPort {
  private readonly terms: ReadonlySet<string>;

  constructor(terms: readonly string[]) {
    this.terms = new Set(terms.map((term) => term.trim().toLowerCase()));
  }

  contains(term: string): boolean {
    return this.terms.has(term.trim().toLowerCase());
  }
}

export class EmptyVocabulary implements VocabularyLookupPort {
  contains(): boolean {
    return false;
  }
}

export function readyWhisperComponent(
  modelPath = "components/whisper/ggml-small.en.bin",
): WhisperComponentStatus {
  return {
    available: true,
    binaryPath: "components/whisper/whisper-cli.exe",
    modelPath,
    quarantined: false,
  };
}

export function blockedWhisperComponent(
  reason: Exclude<FallbackReason, "red_pressure">,
): WhisperComponentStatus {
  return { available: false, reason };
}

export function whisperComponentId(modelId: WhisperModelId): string {
  switch (modelId) {
    case "base.en":
      return "whisper-base.en";
    case "small.en":
      return "whisper-small.en";
    case "medium":
      return "whisper-medium";
  }
}

export function whisperModelFile(modelId: WhisperModelId): string {
  switch (modelId) {
    case "base.en":
      return "ggml-base.en.bin";
    case "small.en":
      return "ggml-small.en.bin";
    case "medium":
      return "ggml-medium.bin";
  }
}

export function whisperModelClass(modelId: WhisperModelId): "base" | "small" | "medium" {
  if (modelId === "medium") return "medium";
  if (modelId === "small.en") return "small";
  return "base";
}

export async function resolveWhisperInstall(
  downloader: SignedComponentDownloaderPort,
  modelId: WhisperModelId,
): Promise<WhisperComponentReady> {
  try {
    const installed = await downloader.download(whisperComponentId(modelId));
    const directory = installed.directory;
    return {
      available: true,
      binaryPath: path.posix.join(directory, "whisper-cli.exe"),
      modelPath: path.posix.join(directory, whisperModelFile(modelId)),
      quarantined: false,
    };
  } catch (error) {
    if (error instanceof WhisperComponentUnavailable) throw error;
    const reason = classifyDownloadFailure(error);
    const message = redactSecrets(error instanceof Error ? error.message : "whisper component download failed");
    throw new WhisperComponentUnavailable(reason, message);
  }
}

function classifyDownloadFailure(error: unknown): WhisperComponentUnavailable["reason"] {
  const name = error instanceof Error ? error.name : "";
  if (name === "ChecksumMismatchError") return "hash_mismatch";
  if (name === "UnsignedComponentError" || name === "UnsafeArchivePathError") return "quarantined";
  return "not_downloaded";
}

function accounting(): JobAccounting {
  return {
    activeProcesses: 0,
    totalProcesses: 1,
    totalTerminatedProcesses: 1,
    peakJobMemoryBytes: 0,
    currentJobMemoryBytes: 0,
    peakProcessMemoryBytes: 0,
    jobMemoryLimitBytes: 1_073_741_824,
    processMemoryLimitBytes: 1_073_741_824,
    activeProcessLimit: 4,
    userCpuMs: 0,
    kernelCpuMs: 0,
    totalPageFaults: 0,
    limitFlags: 0,
    uiRestrictions: 0,
    cpuRatePercent: null,
    killOnJobClose: true,
    uiHandlesRestricted: false,
    memoryLimitHit: false,
    activeProcessLimitHit: false,
  };
}
