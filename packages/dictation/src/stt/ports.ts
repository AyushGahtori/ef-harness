import { DictationError } from "./errors.js";
import type {
  AudioInputDevice,
  ComposerDraftSnapshot,
  DictationDraftUpdate,
  FallbackReason,
  GpuWhisperLease,
  HypothesisToken,
  MachineCalibrationSnapshot,
  MicFault,
  VocabularyLookup,
  WhisperComponentStatus,
  WhisperModelId,
} from "./types.js";

export interface MachineCalibrationPort {
  snapshot(): MachineCalibrationSnapshot;
}

/** Local stand-in for Task 118 `GpuWhisperPriorityArbiter`. */
export interface GpuWhisperPriorityArbiterPort {
  acquireInteractive(): GpuWhisperLease;
  release(leaseId: string): void;
  heldLeaseId(): string | null;
}

/** Local stand-in for Task 132 `SignedComponentDownloader` + AV quarantine check. */
export interface SignedComponentDownloaderPort {
  resolveWhisperComponent(modelId: WhisperModelId): WhisperComponentStatus;
}

/**
 * Local stand-in for Task 041 `WindowsJobSupervisor`.
 * The foundation job-object producer is Task 040 `WindowsJobManager`; this port
 * is the dictation-shaped supervise/close surface Task 157 names.
 */
export interface WindowsJobSupervisorPort {
  superviseWhisper(spec: { readonly binaryPath: string; readonly args: readonly string[] }): SupervisedChild;
  activeChildCount(jobId: string): number;
  close(jobId: string): void;
}

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
  private lease: GpuWhisperLease | null = null;
  acquireCount = 0;
  releaseCount = 0;
  backgroundDeferred = false;

  acquireInteractive(): GpuWhisperLease {
    if (this.lease) return this.lease;
    this.acquireCount += 1;
    this.backgroundDeferred = true;
    this.lease = {
      leaseId: `gpu-whisper-${this.acquireCount}`,
      priority: "interactive-whisper",
    };
    return this.lease;
  }

  release(leaseId: string): void {
    if (!this.lease || this.lease.leaseId !== leaseId) return;
    this.lease = null;
    this.backgroundDeferred = false;
    this.releaseCount += 1;
  }

  heldLeaseId(): string | null {
    return this.lease?.leaseId ?? null;
  }
}

export class InMemorySignedComponentDownloader implements SignedComponentDownloaderPort {
  lastModelId: WhisperModelId | null = null;

  constructor(public result: WhisperComponentStatus) {}

  resolveWhisperComponent(modelId: WhisperModelId): WhisperComponentStatus {
    this.lastModelId = modelId;
    return this.result;
  }
}

class InMemoryWhisperChild implements SupervisedChild {
  stdin = new Uint8Array(0);
  terminated = false;
  closed = false;

  constructor(
    readonly jobId: string,
    readonly pid: number,
    readonly args: readonly string[],
  ) {}

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

export class InMemoryWindowsJobSupervisor implements WindowsJobSupervisorPort {
  readonly jobs = new Map<string, InMemoryWhisperChild>();
  readonly diskWrites: string[] = [];
  private sequence = 0;

  superviseWhisper(spec: {
    readonly binaryPath: string;
    readonly args: readonly string[];
  }): SupervisedChild {
    if (spec.binaryPath.trim().length === 0) {
      throw new DictationError("job", "whisper.cpp binary path is empty");
    }
    for (const arg of spec.args) {
      if (/\.wav$/i.test(arg) || /^https?:\/\//i.test(arg)) {
        throw new DictationError("audio", "Refusing to persist or upload raw audio");
      }
    }
    this.sequence += 1;
    const child = new InMemoryWhisperChild(`whisper-job-${this.sequence}`, this.sequence, spec.args);
    this.jobs.set(child.jobId, child);
    return child;
  }

  activeChildCount(jobId: string): number {
    const child = this.jobs.get(jobId);
    if (!child || child.closed || child.terminated) return 0;
    return 1;
  }

  close(jobId: string): void {
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
