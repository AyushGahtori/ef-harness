import {
  DOWNLOAD_LOCAL_WHISPER,
  MIC_DISCONNECTED,
  OS_DICTATION_BADGE,
  PCM_RETAIN_SAMPLES,
  SPEECH_RMS,
} from "./constants.js";
import { EditableDictationDraftController, type DraftSnapshot } from "./draft-controller.js";
import { selectWhisperModel } from "./model-selection.js";
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
  WindowsJobSupervisorPort,
} from "./ports.js";
import { rmsOf } from "./text.js";
import type {
  AudioInputDevice,
  DictationEngineMode,
  FallbackReason,
  HotkeyBehavior,
  HotkeyCombo,
  HotkeyEvent,
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
  readonly jobs: WindowsJobSupervisorPort;
  readonly gpu: GpuWhisperPriorityArbiterPort;
  readonly components: SignedComponentDownloaderPort;
  readonly calibration: MachineCalibrationPort;
  readonly decoder: WhisperDecoderPort;
  readonly capture: AudioCapturePort;
  readonly composer: SingleComposerViewPort;
  readonly speech: OsSpeechRecognizerPort;
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
  private gpuLeaseId: string | null = null;
  private child: SupervisedChild | null = null;
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

  handleKey(event: HotkeyEvent): void {
    if (event.repeat) return;
    if (!this.matchesHotkey(event)) return;
    if (this.hotkeyBehavior === "toggle") {
      if (event.type === "keydown") this.toggle();
      return;
    }
    if (event.type === "keydown") this.pushToTalkDown();
    else this.pushToTalkUp();
  }

  toggle(): void {
    if (this.draft.isListening()) {
      this.stop();
      return;
    }
    this.openedBy = "click";
    this.start();
  }

  pushToTalkDown(): void {
    if (this.hotkeyBehavior !== "push_to_talk") {
      this.toggle();
      return;
    }
    if (this.draft.isListening()) return;
    this.openedBy = "ptt";
    this.start();
  }

  pushToTalkUp(): void {
    if (this.openedBy !== "ptt") return;
    this.openedBy = null;
    this.stop();
  }

  start(options?: { readonly carryInitialPrompt?: string; readonly deviceId?: string }): void {
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
    if (calibration.pressure === "Red") {
      this.enterOsFallback("red_pressure");
      return;
    }
    const modelId = selectWhisperModel(calibration);
    const component = this.deps.components.resolveWhisperComponent(modelId);
    if (!component.available) {
      this.enterOsFallback(component.reason);
      return;
    }
    this.modelId = modelId;
    const lease = this.deps.gpu.acquireInteractive();
    this.gpuLeaseId = lease.leaseId;
    const args = buildWhisperCppArgs({
      modelPath: component.modelPath,
      ...(this.carryInitialPrompt === undefined ? {} : { carryInitialPrompt: this.carryInitialPrompt }),
    });
    try {
      this.child = this.deps.jobs.superviseWhisper({ binaryPath: component.binaryPath, args });
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
    if (this.deps.calibration.snapshot().pressure !== "Red") return;
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
    const tokens =
      this.phase === "whisper"
        ? this.deps.decoder.decode(samples, this.decoderContext())
        : this.fallback.transcribe(samples);
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
      gpuHeld: this.gpuLeaseId !== null && this.deps.gpu.heldLeaseId() === this.gpuLeaseId,
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

  private releaseGpu(): void {
    if (this.gpuLeaseId === null) return;
    this.deps.gpu.release(this.gpuLeaseId);
    this.gpuLeaseId = null;
  }

  private releaseWhisperProcess(): void {
    if (this.child) {
      const jobId = this.child.jobId;
      this.child.terminate();
      this.deps.jobs.close(jobId);
      this.child = null;
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
