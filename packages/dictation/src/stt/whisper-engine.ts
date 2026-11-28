import {
  DOWNLOAD_LOCAL_WHISPER,
  MIC_DISCONNECTED,
  OS_DICTATION_BADGE,
  PCM_RETAIN_SAMPLES,
  SPEECH_RMS,
} from "./constants.js";
import { EditableDictationDraftController, type DraftSnapshot } from "./draft-controller.js";
import { selectWhisperModel } from "./model-selection.js";
import type { JobHandle, SpawnedProcess } from "@ef-harness/sandbox";
import { OsFallbackDictationBridge } from "./os-fallback.js";
import type {
  AudioCapturePort,
  GpuWhisperPriorityArbiterPort,
  MachineCalibrationPort,
  OsSpeechRecognizerPort,
  SignedComponentDownloaderPort,
  SingleComposerViewPort,
  SupervisedChild,
  WhisperDecoderPort,
  WindowsJobObjectPort,
} from "./ports.js";
import { resolveWhisperInstall, whisperModelClass } from "./ports.js";
import { WhisperComponentUnavailable } from "./errors.js";
import { renderTokens, rmsOf } from "./text.js";
import type { DictationVocabularyPipeline } from "./vocabulary-pipeline.js";
import type {
  AudioInputDevice,
  DictationEngineMode,
  FallbackReason,
  HotkeyBehavior,
  HotkeyCombo,
  HotkeyEvent,
  HypothesisToken,
  KeyboardEdit,
  VocabularyLookup,
  WhisperModelId,
} from "./types.js";
import { buildWhisperCppArgs } from "./whisper-args.js";

export interface DraftEngineSnapshot extends DraftSnapshot {
  readonly mode: DictationEngineMode;
  readonly modelId: WhisperModelId | null;
  readonly badge: string | null;
  readonly downloadOffer: string | null;
  readonly fallbackReason: FallbackReason | null;
  readonly gpuHeld: boolean;
  readonly jobId: string | null;
  readonly jobOpen: boolean;
  readonly wavWrites: number;
  readonly networkUploads: number;
  readonly pcmBytes: number;
  readonly deviceId: string;
  readonly hotkey: string;
  readonly hotkeyBehavior: HotkeyBehavior;
  readonly targetKey: string;
  readonly whisperArgs: readonly string[] | null;
}

export interface LocalWhisperDependencies {
  readonly jobs: WindowsJobObjectPort;
  readonly gpu: GpuWhisperPriorityArbiterPort;
  readonly components: SignedComponentDownloaderPort;
  readonly calibration: MachineCalibrationPort;
  readonly decoder: WhisperDecoderPort;
  readonly capture: AudioCapturePort;
  readonly composer: SingleComposerViewPort;
  readonly speech: OsSpeechRecognizerPort;
  readonly pipeline?: DictationVocabularyPipeline;
}

interface EngineOptions {
  readonly retractionPreview?: boolean;
  readonly deviceId?: string;
  readonly vocabulary?: VocabularyLookup;
}

/**
 * On-device whisper.cpp session. PCM stays in RAM, the child runs under a job,
 * and GPU priority is held only while local Whisper is the active engine.
 */
export class LocalWhisperSttEngine {
  readonly draft: EditableDictationDraftController;
  readonly fallback: OsFallbackDictationBridge;
  readonly networkUploads = 0;
  readonly wavWrites = 0;

  private phase: DictationEngineMode = "idle";
  private deviceId: string;
  private hotkey: HotkeyCombo = { ctrl: true, alt: false, shift: false, meta: false, key: " " };
  private hotkeyBehavior: HotkeyBehavior = "push_to_talk";
  private openedBy: "click" | "ptt" | null = null;
  private carryInitialPrompt: string | undefined;
  private modelId: WhisperModelId | null = null;
  private gpuActive = false;
  private child: SupervisedChild | null = null;
  private jobHandle: JobHandle | null = null;
  private pcm = new Int16Array(0);
  private badge: string | null = null;
  private downloadOffer: string | null = null;
  private fallbackReason: FallbackReason | null = null;

  constructor(
    private readonly deps: LocalWhisperDependencies,
    options?: EngineOptions,
  ) {
    const draftOptions =
      options?.vocabulary === undefined
        ? { retractionPreview: options?.retractionPreview ?? true }
        : { vocabulary: options.vocabulary, retractionPreview: options.retractionPreview ?? true };
    this.draft = new EditableDictationDraftController(deps.composer, draftOptions);
    this.fallback = new OsFallbackDictationBridge(deps.speech);
    this.deviceId = options?.deviceId ?? "default";
    this.draft.onSilenceMicOff(() => {
      this.releaseCapture();
      this.releaseWhisperProcess();
      this.fallback.stop();
      this.phase = "idle";
      this.openedBy = null;
    });
    deps.capture.onFault(() => {
      this.failMicrophone();
    });
  }

  listInputDevices(): readonly AudioInputDevice[] {
    return this.deps.capture.listDevices();
  }

  selectInputDevice(deviceId: string): void {
    this.deviceId = deviceId;
    if (!this.draft.isListening()) return;
    this.deps.capture.stop();
    const started = this.deps.capture.start(deviceId);
    if (!started.ok) this.failMicrophone();
  }

  setHotkey(combo: HotkeyCombo, behavior: HotkeyBehavior = this.hotkeyBehavior): void {
    this.hotkey = { ...combo, key: normalizeKey(combo.key) };
    this.hotkeyBehavior = behavior;
  }

  setCarryInitialPrompt(prompt: string): void {
    this.carryInitialPrompt = prompt;
  }

  async handleKey(event: HotkeyEvent): Promise<void> {
    if (event.repeat) return;
    if (!this.matchesHotkey(event)) return;
    if (this.hotkeyBehavior === "toggle") {
      if (event.type === "keydown") await this.toggle();
      return;
    }
    if (event.type === "keydown") await this.pushToTalkDown();
    else this.pushToTalkUp();
  }

  async toggle(): Promise<void> {
    if (this.draft.isListening()) {
      this.stop();
      return;
    }
    this.openedBy = "click";
    await this.start();
  }

  async pushToTalkDown(): Promise<void> {
    if (this.hotkeyBehavior !== "push_to_talk") {
      await this.toggle();
      return;
    }
    if (this.draft.isListening()) return;
    this.openedBy = "ptt";
    await this.start();
  }

  pushToTalkUp(): void {
    if (this.openedBy !== "ptt") return;
    this.openedBy = null;
    this.stop();
  }

  async start(options?: { readonly carryInitialPrompt?: string; readonly deviceId?: string }): Promise<void> {
    if (this.draft.isListening()) return;
    if (options?.carryInitialPrompt !== undefined) this.carryInitialPrompt = options.carryInitialPrompt;
    if (options?.deviceId !== undefined) this.deviceId = options.deviceId;
    const capture = this.deps.capture.start(this.deviceId);
    if (!capture.ok) {
      this.draft.failMic(MIC_DISCONNECTED);
      this.phase = "idle";
      return;
    }
    const calibration = this.deps.calibration.snapshot();
    if (calibration.pressure === "RED") {
      this.enterOsFallback("red_pressure");
      return;
    }
    const modelId = selectWhisperModel(calibration);
    let component;
    try {
      component = await resolveWhisperInstall(this.deps.components, modelId);
    } catch (error) {
      const reason = error instanceof WhisperComponentUnavailable ? error.reason : "not_downloaded";
      this.enterOsFallback(reason);
      return;
    }
    this.modelId = modelId;
    const grant = this.deps.gpu.activateDictation(whisperModelClass(modelId));
    this.gpuActive = grant.ready === true && this.deps.gpu.dictationActive;
    this.applyPipelinePrompt();
    const args = buildWhisperCppArgs({
      modelPath: component.modelPath,
      ...(this.carryInitialPrompt === undefined ? {} : { carryInitialPrompt: this.carryInitialPrompt }),
    });
    try {
      const job = await this.deps.jobs.createJob({
        name: "whisper-dictation",
        kind: "command",
        limits: { memoryBytes: 1_073_741_824, activeProcessLimit: 4 },
        timeoutMs: 120_000,
      });
      const spawned = await this.deps.jobs.spawnInJob(job, {
        file: component.binaryPath,
        args,
        environment: "dictation",
        role: "whisper",
      });
      this.jobHandle = job;
      this.child = supervisedChild(spawned, job.id, args);
    } catch {
      this.releaseGpu();
      this.enterOsFallback("quarantined");
      return;
    }
    this.phase = "whisper";
    this.badge = null;
    this.downloadOffer = null;
    this.fallbackReason = null;
    this.draft.setListening(true);
  }

  stop(): void {
    this.draft.setListening(false);
    this.releaseCapture();
    this.fallback.stop();
    this.releaseWhisperProcess();
    this.phase = "idle";
    this.openedBy = null;
  }

  reconcilePressure(): void {
    if (this.phase !== "whisper") return;
    if (this.deps.calibration.snapshot().pressure !== "RED") return;
    this.releaseWhisperProcess();
    this.modelId = null;
    this.fallbackReason = "red_pressure";
    this.badge = OS_DICTATION_BADGE;
    this.downloadOffer = DOWNLOAD_LOCAL_WHISPER;
    this.fallback.start();
    this.phase = "os";
  }

  pushPcm(samples: Int16Array): void {
    if (!this.draft.isListening()) return;
    this.reconcilePressure();
    if (!this.draft.isListening()) return;
    this.retainPcm(samples);
    const rms = rmsOf(samples);
    this.draft.noteAudioRms(rms);
    if (rms < SPEECH_RMS) return;
    if (this.phase === "whisper" && this.child) {
      this.child.pushStdin(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
    }
    const decoded =
      this.phase === "whisper"
        ? this.deps.decoder.decode(samples, this.decoderContext())
        : this.fallback.transcribe(samples);
    const tokens = this.shapeHypothesis(decoded);
    if (tokens.length > 0) this.draft.pushHypothesis(tokens);
  }

  applyKeyboardEdit(edit: KeyboardEdit): void {
    this.draft.applyKeyboardEdit(edit);
  }

  submitFromUser(): void {
    this.draft.submitFromUser();
  }

  setRetractionPreviewEnabled(enabled: boolean): void {
    this.draft.setRetractionPreviewEnabled(enabled);
  }

  snapshot(): DraftEngineSnapshot {
    const draft = this.draft.snapshot();
    return {
      ...draft,
      mode: this.phase,
      modelId: this.modelId,
      badge: this.badge,
      downloadOffer: this.downloadOffer,
      fallbackReason: this.fallbackReason,
      gpuHeld: this.gpuActive && this.deps.gpu.dictationActive,
      jobId: this.child?.jobId ?? null,
      jobOpen: this.child !== null && !this.child.terminated,
      wavWrites: this.wavWrites,
      networkUploads: this.networkUploads,
      pcmBytes: this.pcm.byteLength,
      deviceId: this.deviceId,
      hotkey: formatHotkey(this.hotkey),
      hotkeyBehavior: this.hotkeyBehavior,
      targetKey: this.deps.composer.targetKey,
      whisperArgs: this.child?.args ?? null,
    };
  }

  private decoderContext(): { carryInitialPrompt?: string } {
    if (this.carryInitialPrompt === undefined) return {};
    return { carryInitialPrompt: this.carryInitialPrompt };
  }

  private enterOsFallback(reason: FallbackReason): void {
    this.releaseWhisperProcess();
    this.modelId = null;
    this.phase = "os";
    this.fallbackReason = reason;
    this.badge = OS_DICTATION_BADGE;
    this.downloadOffer = DOWNLOAD_LOCAL_WHISPER;
    this.fallback.start();
    this.draft.setListening(true);
  }

  private failMicrophone(): void {
    this.draft.failMic(MIC_DISCONNECTED);
    this.releaseCapture();
    this.fallback.stop();
    this.releaseWhisperProcess();
    this.phase = "idle";
    this.openedBy = null;
  }

  private releaseCapture(): void {
    this.deps.capture.stop();
  }

  private applyPipelinePrompt(): void {
    if (this.carryInitialPrompt !== undefined && this.carryInitialPrompt.length > 0) return;
    const pipeline = this.deps.pipeline;
    if (!pipeline) return;
    const built = pipeline.prompts.build({
      projectId: pipeline.projectId,
      entries: pipeline.store.list(),
    });
    if (built.text.length > 0) this.carryInitialPrompt = built.text;
  }

  private shapeHypothesis(tokens: readonly HypothesisToken[]): readonly HypothesisToken[] {
    const pipeline = this.deps.pipeline;
    if (!pipeline || tokens.length === 0) return tokens;
    const raw = renderTokens(tokens);
    const corrected = pipeline.learner.apply(pipeline.projectId, raw);
    const spoken = pipeline.spokenIds.normalize(pipeline.projectId, corrected.text);
    if (spoken.text === raw) return tokens;
    const probability = tokens[0]?.probability ?? 1;
    return spoken.text
      .split(" ")
      .filter((word) => word.length > 0)
      .map((text) => ({ text, probability }));
  }

  private releaseGpu(): void {
    if (!this.gpuActive) return;
    this.deps.gpu.deactivateDictation();
    this.gpuActive = false;
  }

  private releaseWhisperProcess(): void {
    const child = this.child;
    const job = this.jobHandle;
    this.child = null;
    this.jobHandle = null;
    if (child) child.terminate();
    if (job) {
      void this.deps.jobs.terminateJob(job);
      void this.deps.jobs.closeJob(job);
    }
    this.releaseGpu();
    this.pcm.fill(0);
    this.pcm = new Int16Array(0);
  }

  private retainPcm(samples: Int16Array): void {
    const merged = new Int16Array(this.pcm.length + samples.length);
    merged.set(this.pcm);
    merged.set(samples, this.pcm.length);
    const discard = Math.max(0, merged.length - PCM_RETAIN_SAMPLES);
    if (discard > 0) merged.fill(0, 0, discard);
    const kept = merged.subarray(discard);
    const copy = new Int16Array(kept.length);
    copy.set(kept);
    this.pcm.fill(0);
    merged.fill(0);
    this.pcm = copy;
  }

  private matchesHotkey(event: HotkeyEvent): boolean {
    return (
      normalizeKey(event.key) === this.hotkey.key &&
      Boolean(event.ctrlKey) === this.hotkey.ctrl &&
      Boolean(event.altKey) === this.hotkey.alt &&
      Boolean(event.shiftKey) === this.hotkey.shift &&
      Boolean(event.metaKey) === this.hotkey.meta
    );
  }
}

function supervisedChild(spawned: SpawnedProcess, jobId: string, args: readonly string[]): SupervisedChild {
  if (
    typeof Reflect.get(spawned, "pushStdin") === "function" &&
    typeof Reflect.get(spawned, "terminate") === "function" &&
    typeof Reflect.get(spawned, "jobId") === "string"
  ) {
    return spawned as SpawnedProcess & SupervisedChild;
  }
  return new BufferedWhisperChild(jobId, spawned.pid, args);
}

class BufferedWhisperChild implements SupervisedChild {
  stdin = new Uint8Array(0);
  terminated = false;

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

function normalizeKey(key: string): string {
  if (key === "Space" || key === "space") return " ";
  return key.length === 1 ? key.toLowerCase() : key;
}

function formatHotkey(combo: HotkeyCombo): string {
  const parts: string[] = [];
  if (combo.ctrl) parts.push("Ctrl");
  if (combo.alt) parts.push("Alt");
  if (combo.shift) parts.push("Shift");
  if (combo.meta) parts.push("Meta");
  parts.push(combo.key === " " ? "Space" : combo.key);
  return parts.join("+");
}
