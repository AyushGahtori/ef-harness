import { MemorySessionStorage, type KeyValueSession } from "./per-target-draft-store.js";
import type {
  AttachmentChip,
  CanvasBox,
  ComposerSubmission,
  ComposerViewModel,
  FocusCaptureFields,
  FocusSnapshot,
  MultiBoxSplit,
} from "./types.js";
import { COMPOSER_SHELL_SLOT } from "./types.js";

export interface ComposerClock {
  nowIso(): string;
}

export class ManualClock implements ComposerClock {
  constructor(private iso = "2026-01-01T00:00:00.000Z") {}

  nowIso(): string {
    return this.iso;
  }

  set(iso: string): void {
    this.iso = iso;
  }
}

export interface InputStartFocusSnapshotterPort {
  capture(fields: FocusCaptureFields): FocusSnapshot;
}

export class LocalInputStartFocusSnapshotter implements InputStartFocusSnapshotterPort {
  readonly captures: FocusSnapshot[] = [];

  capture(fields: FocusCaptureFields): FocusSnapshot {
    const snapshot: FocusSnapshot = Object.freeze({
      inputStartedAt: fields.inputStartedAt,
      targetType: fields.targetType,
      targetId: fields.targetId,
      optionsVersion: fields.optionsVersion,
      selectedNodeRevisions: Object.freeze(
        fields.selectedNodeRevisions.map((item) => ({
          nodeId: item.nodeId,
          revision: item.revision,
        })),
      ),
      activeTab: fields.activeTab,
      selectedCanvasNodeIds: Object.freeze([...fields.selectedCanvasNodeIds]),
      openQuestionCardId: fields.openQuestionCardId,
      openQuestionOptionsVersion: fields.openQuestionOptionsVersion,
      focusedFeatureId: fields.focusedFeatureId,
      inspectedTaskId: fields.inspectedTaskId,
      previewSelectedElement: fields.previewSelectedElement,
      frozen: true,
    });
    this.captures.push(snapshot);
    return snapshot;
  }
}

export interface SequencedMessage {
  readonly msgSeq: number;
  readonly messageId: string;
}

export interface UnifiedMessageSequencerPort {
  assign(message: ComposerSubmission): SequencedMessage;
}

export class LocalUnifiedMessageSequencer implements UnifiedMessageSequencerPort {
  readonly messages: ComposerSubmission[] = [];
  private seq = 0;

  assign(message: ComposerSubmission): SequencedMessage {
    this.seq += 1;
    this.messages.push(message);
    return { msgSeq: this.seq, messageId: `msg-${this.seq}` };
  }
}

export interface ClauseExecutionReceipt {
  readonly accepted: true;
  readonly clauseCount: number;
}

export interface OrderedMultiClauseExecutorPort {
  execute(split: MultiBoxSplit): ClauseExecutionReceipt;
}

export class LocalOrderedMultiClauseExecutor implements OrderedMultiClauseExecutorPort {
  readonly executions: MultiBoxSplit[] = [];

  execute(split: MultiBoxSplit): ClauseExecutionReceipt {
    this.executions.push(split);
    return { accepted: true, clauseCount: split.clauses.length };
  }
}

export interface MultiBoxSelectionControllerPort {
  getSelectedBoxes(): readonly CanvasBox[];
  subscribe(listener: (boxes: readonly CanvasBox[]) => void): () => void;
}

export class LocalMultiBoxSelectionController implements MultiBoxSelectionControllerPort {
  private boxes: readonly CanvasBox[] = [];
  private readonly listeners = new Set<(boxes: readonly CanvasBox[]) => void>();

  getSelectedBoxes(): readonly CanvasBox[] {
    return this.boxes;
  }

  select(boxes: readonly CanvasBox[]): void {
    this.boxes = boxes.map((box) => ({
      nodeId: box.nodeId,
      revision: box.revision,
      label: box.label,
    }));
    for (const listener of this.listeners) listener(this.boxes);
  }

  subscribe(listener: (boxes: readonly CanvasBox[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export interface SingleAppShellPort {
  readonly slot: typeof COMPOSER_SHELL_SLOT;
  publish(view: ComposerViewModel): void;
}

export class LocalSingleAppShell implements SingleAppShellPort {
  readonly slot = COMPOSER_SHELL_SLOT;
  mounted: ComposerViewModel | null = null;
  readonly publishes: ComposerViewModel[] = [];

  publish(view: ComposerViewModel): void {
    if (this.mounted && this.mounted.composerId !== view.composerId) {
      throw new Error("Single composer invariant violated");
    }
    this.mounted = view;
    this.publishes.push(view);
  }
}

export interface DictationLiveDraftPort {
  setRecording(active: boolean): void;
  noteSyllable(text: string): void;
}

export class LocalDictationLiveDraft implements DictationLiveDraftPort {
  recording = false;
  readonly syllables: string[] = [];

  setRecording(active: boolean): void {
    this.recording = active;
  }

  noteSyllable(text: string): void {
    this.syllables.push(text);
  }
}

export interface DocumentIntakePort {
  convert(chip: AttachmentChip): void;
  extract(chip: AttachmentChip): void;
}

export class LocalDocumentIntake implements DocumentIntakePort {
  readonly converted: AttachmentChip[] = [];
  readonly extracted: AttachmentChip[] = [];

  convert(chip: AttachmentChip): void {
    this.converted.push(chip);
  }

  extract(chip: AttachmentChip): void {
    this.extracted.push(chip);
  }
}

export interface BrandAssetSanitizerPort {
  sanitize(chip: AttachmentChip): void;
}

export class LocalBrandAssetSanitizer implements BrandAssetSanitizerPort {
  readonly sanitized: AttachmentChip[] = [];

  sanitize(chip: AttachmentChip): void {
    this.sanitized.push(chip);
  }
}

export interface ComposerPorts {
  readonly snapshotter: InputStartFocusSnapshotterPort;
  readonly sequencer: UnifiedMessageSequencerPort;
  readonly clauseExecutor: OrderedMultiClauseExecutorPort;
  readonly selection: MultiBoxSelectionControllerPort;
  readonly dictation: DictationLiveDraftPort;
  readonly intake: DocumentIntakePort;
  readonly brand: BrandAssetSanitizerPort;
  readonly clock: ComposerClock;
  readonly session: KeyValueSession;
}

export interface LocalComposerBundle {
  readonly snapshotter: LocalInputStartFocusSnapshotter;
  readonly sequencer: LocalUnifiedMessageSequencer;
  readonly clauseExecutor: LocalOrderedMultiClauseExecutor;
  readonly selection: LocalMultiBoxSelectionController;
  readonly shell: LocalSingleAppShell;
  readonly dictation: LocalDictationLiveDraft;
  readonly intake: LocalDocumentIntake;
  readonly brand: LocalBrandAssetSanitizer;
  readonly clock: ManualClock;
  readonly session: MemorySessionStorage;
  readonly ports: ComposerPorts;
}

export function createLocalComposerBundle(): LocalComposerBundle {
  const snapshotter = new LocalInputStartFocusSnapshotter();
  const sequencer = new LocalUnifiedMessageSequencer();
  const clauseExecutor = new LocalOrderedMultiClauseExecutor();
  const selection = new LocalMultiBoxSelectionController();
  const shell = new LocalSingleAppShell();
  const dictation = new LocalDictationLiveDraft();
  const intake = new LocalDocumentIntake();
  const brand = new LocalBrandAssetSanitizer();
  const clock = new ManualClock();
  const session = new MemorySessionStorage();
  const ports: ComposerPorts = {
    snapshotter,
    sequencer,
    clauseExecutor,
    selection,
    dictation,
    intake,
    brand,
    clock,
    session,
  };
  return {
    snapshotter,
    sequencer,
    clauseExecutor,
    selection,
    shell,
    dictation,
    intake,
    brand,
    clock,
    session,
    ports,
  };
}
