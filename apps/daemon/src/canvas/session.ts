import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CanvasLayoutInputError,
  CanvasLayoutRepo,
  viewLevelOf,
  type CanvasLayoutRow,
  type ProjectStateDb,
} from "@ef-harness/db";
import { GpuWhisperPriorityArbiter } from "@ef-harness/governor";
import { WindowsJobObjectManager } from "@ef-harness/sandbox";
import { router } from "@ef-harness/steering";
import {
  LocalWhisperSttEngine,
  WhisperComponentUnavailable,
  type ComposerDraftSnapshot,
  type DictationDraftUpdate,
  type DictationEngineMode,
  type HypothesisToken,
  type InstalledSignedComponent,
  type LocalWhisperDependencies,
  type MachineCalibrationSnapshot,
  type MicFault,
  type OsSpeechRecognizerPort,
  type SignedComponentDownloaderPort,
  type SingleComposerViewPort,
  type WhisperDecoderPort,
} from "@ef-harness/dictation";

export interface CanvasDaemonSessionOptions {
  readonly state: ProjectStateDb;
  readonly profileDir: string;
  readonly pressure?: () => MachineCalibrationSnapshot["pressure"];
}

export class CanvasDaemonSession {
  readonly layout: CanvasLayoutRepo;
  private readonly focusStore: router.RouterStore;
  private readonly jobs: WindowsJobObjectManager;
  private engine: LocalWhisperSttEngine | null = null;
  private readonly deps: LocalWhisperDependencies;

  constructor(options: CanvasDaemonSessionOptions) {
    fs.mkdirSync(options.profileDir, { recursive: true });
    this.layout = new CanvasLayoutRepo(options.state.writer);
    this.focusStore = router.RouterStore.open(path.join(options.profileDir, "steering-focus.sqlite"));
    this.jobs = new WindowsJobObjectManager({
      stateDbPath: path.join(options.profileDir, "job-objects.sqlite"),
    });
    const pressure = options.pressure ?? (() => "GREEN" as const);
    this.deps = {
      jobs: this.jobs,
      gpu: new GpuWhisperPriorityArbiter(8_192),
      components: new UnavailableWhisperDownloader(),
      calibration: {
        snapshot: (): MachineCalibrationSnapshot => ({
          totalRamMb: Math.max(1, Math.round(os.totalmem() / (1024 * 1024))),
          gpuVramMb: 0,
          pressure: pressure(),
        }),
      },
      decoder: new SilentWhisperDecoder(),
      capture: new HostMicrophoneCapture(),
      composer: new DaemonComposerSink(),
      speech: new HostSpeechRecognizer(),
    };
  }

  load(viewLevel: number): readonly CanvasLayoutRow[] {
    return this.layout.loadAll(viewLevel);
  }

  upsert(row: CanvasLayoutRow): void {
    this.layout.upsert(row);
  }

  clearUnpinned(viewLevel: number): void {
    this.layout.clearUnpinned(viewLevel);
  }

  clearLevel(viewLevel: number): void {
    this.layout.clearLevel(viewLevel);
  }

  beginFocus(input: FocusBeginInput): { readonly draftId: string; readonly selectedCanvasNodeIds: readonly string[] } {
    const preview = input.previewSelectedElement;
    const focus: router.InputStartFocus = {
      activeTab: input.activeTab,
      selectedCanvasNodeIds: input.selectedCanvasNodeIds,
      openQuestionCardId: input.openQuestionCardId,
      openQuestionOptionsVersion: input.openQuestionOptionsVersion,
      focusedFeatureId: input.focusedFeatureId,
      inspectedTaskId: input.inspectedTaskId,
      ...(preview === null || preview.length === 0 ? {} : { previewSelectedElement: preview }),
    };
    const capturedAt = Date.parse(input.inputStartedAt);
    const binding = new router.InputStartFocusSnapshotter(this.focusStore, () => Date.now()).begin({
      draftId: input.draftId,
      focus,
      ...(Number.isFinite(capturedAt) ? { at: capturedAt } : {}),
    });
    return { draftId: binding.draftId, selectedCanvasNodeIds: binding.focus.selectedCanvasNodeIds };
  }

  async setRecording(active: boolean): Promise<{ readonly recording: boolean; readonly mode: DictationEngineMode }> {
    const engine = this.whisper();
    const current = engine.snapshot().mode;
    if (active && current === "idle") await engine.toggle();
    if (!active && engine.snapshot().mode !== "idle") engine.stop();
    const mode = engine.snapshot().mode;
    return { recording: mode !== "idle", mode };
  }

  async close(): Promise<void> {
    this.engine?.stop();
    this.engine = null;
    await this.jobs.dispose();
    this.focusStore.close();
  }

  private whisper(): LocalWhisperSttEngine {
    if (this.engine) return this.engine;
    this.engine = new LocalWhisperSttEngine(this.deps);
    return this.engine;
  }
}

export function openCanvasDaemonSession(options: CanvasDaemonSessionOptions): CanvasDaemonSession {
  return new CanvasDaemonSession(options);
}

export interface FocusBeginInput {
  readonly draftId: string;
  readonly inputStartedAt: string;
  readonly activeTab: string;
  readonly selectedCanvasNodeIds: readonly string[];
  readonly openQuestionCardId: string | null;
  readonly openQuestionOptionsVersion: number | null;
  readonly focusedFeatureId: string | null;
  readonly inspectedTaskId: string | null;
  readonly previewSelectedElement: string | null;
}

export function dispatchCanvasDaemon(
  session: CanvasDaemonSession,
  method: string,
  params: Record<string, unknown>,
): { readonly handled: true; readonly result: unknown } | { readonly handled: false } {
  if (method === "canvas.layout.load") {
    return { handled: true, result: { rows: session.load(requiredLevel(params.viewLevel)) } };
  }
  if (method === "canvas.layout.upsert") {
    session.upsert(requiredRow(params));
    return { handled: true, result: { ok: true } };
  }
  if (method === "canvas.layout.clearUnpinned") {
    session.clearUnpinned(requiredLevel(params.viewLevel));
    return { handled: true, result: { ok: true } };
  }
  if (method === "canvas.layout.clearLevel") {
    session.clearLevel(requiredLevel(params.viewLevel));
    return { handled: true, result: { ok: true } };
  }
  if (method === "composer.focus.begin") {
    return { handled: true, result: session.beginFocus(requiredFocus(params)) };
  }
  if (method === "composer.dictation.setRecording") {
    const active = params.active === true;
    void session.setRecording(active);
    return { handled: true, result: { accepted: true, active } };
  }
  return { handled: false };
}

function requiredLevel(value: unknown): number {
  if (typeof value !== "number") throw new CanvasLayoutInputError("viewLevel is required");
  return viewLevelOf(value);
}

function requiredRow(params: Record<string, unknown>): CanvasLayoutRow {
  const nodeId = params.nodeId;
  const viewLevel = params.viewLevel;
  const x = params.x;
  const y = params.y;
  if (typeof nodeId !== "string" || typeof viewLevel !== "number" || typeof x !== "number" || typeof y !== "number") {
    throw new CanvasLayoutInputError("canvas layout upsert is incomplete");
  }
  return {
    nodeId,
    viewLevel: viewLevelOf(viewLevel),
    x,
    y,
    pinnedByUser: params.pinnedByUser === true,
  };
}

function requiredFocus(params: Record<string, unknown>): FocusBeginInput {
  const draftId = params.draftId;
  const inputStartedAt = params.inputStartedAt;
  const activeTab = params.activeTab;
  const ids = params.selectedCanvasNodeIds;
  if (typeof draftId !== "string" || draftId.length === 0) {
    throw new CanvasLayoutInputError("draftId is required");
  }
  if (typeof inputStartedAt !== "string" || typeof activeTab !== "string" || !Array.isArray(ids)) {
    throw new CanvasLayoutInputError("focus capture is incomplete");
  }
  const selectedCanvasNodeIds = ids.filter((id): id is string => typeof id === "string");
  return {
    draftId,
    inputStartedAt,
    activeTab,
    selectedCanvasNodeIds,
    openQuestionCardId: typeof params.openQuestionCardId === "string" ? params.openQuestionCardId : null,
    openQuestionOptionsVersion:
      typeof params.openQuestionOptionsVersion === "number" ? params.openQuestionOptionsVersion : null,
    focusedFeatureId: typeof params.focusedFeatureId === "string" ? params.focusedFeatureId : null,
    inspectedTaskId: typeof params.inspectedTaskId === "string" ? params.inspectedTaskId : null,
    previewSelectedElement:
      typeof params.previewSelectedElement === "string" ? params.previewSelectedElement : null,
  };
}

class UnavailableWhisperDownloader implements SignedComponentDownloaderPort {
  async download(componentId: string): Promise<InstalledSignedComponent> {
    throw new WhisperComponentUnavailable("not_downloaded", `whisper component ${componentId} is not installed`);
  }
}

class SilentWhisperDecoder implements WhisperDecoderPort {
  decode(): readonly HypothesisToken[] {
    return [];
  }
}

class HostMicrophoneCapture {
  private fault: ((reason: MicFault) => void) | null = null;

  listDevices(): readonly { readonly id: string; readonly label: string }[] {
    return [{ id: "default", label: "Default microphone" }];
  }

  start(): { ok: true } | { ok: false; reason: MicFault } {
    return { ok: true };
  }

  stop(): void {
    void this.fault;
  }

  onFault(listener: (reason: MicFault) => void): void {
    this.fault = listener;
  }
}

class HostSpeechRecognizer implements OsSpeechRecognizerPort {
  running = false;

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  transcribe(): readonly HypothesisToken[] {
    return [];
  }
}

class DaemonComposerSink implements SingleComposerViewPort {
  readonly targetKey = "single-composer";
  confirmed = "";
  tentative = "";
  cursor = 0;
  hint: string | null = null;
  status: string | null = null;
  submitCount = 0;
  lastSubmitted: string | null = null;

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
