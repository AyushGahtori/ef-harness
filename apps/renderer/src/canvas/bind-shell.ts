import { ComposerTargetStateMachine } from "../composer/composer-target-state-machine.js";
import {
  LocalBrandAssetSanitizer,
  LocalDocumentIntake,
  LocalInputStartFocusSnapshotter,
  LocalOrderedMultiClauseExecutor,
  LocalUnifiedMessageSequencer,
  ManualClock,
  type ComposerPorts,
  type DictationLiveDraftPort,
  type InputStartFocusSnapshotterPort,
  type MultiBoxSelectionControllerPort,
  type SingleAppShellPort,
} from "../composer/ports.js";
import { MemorySessionStorage } from "../composer/per-target-draft-store.js";
import type { CanvasBox, ComposerViewModel, FocusCaptureFields, FocusSnapshot } from "../composer/types.js";
import { COMPOSER_SHELL_SLOT } from "../composer/types.js";
import type { ArchitectureCanvasMount, SingleAppShell } from "../shell/shell.js";
import { CanvasSelectionContext } from "./graph/canvas-selection-context.js";
import { DaemonCanvasLayoutPersistence, type CanvasDaemonDispatch } from "./graph/daemon-persistence.js";
import { LandedShellCanvasPort } from "./graph/landed-shell.js";
import { SavedNodePositionStore } from "./graph/saved-node-position-store.js";
import { MemoryCanvasNodeCatalog } from "./popovers/local-ports.js";
import type { CanvasSelectionContextPort, ComposerSyncReceipt, ComposerTargetPort } from "./popovers/ports.js";
import { NodeTypePopoverRegistry } from "./popovers/registry.js";
import { MultiBoxSelectionController } from "./popovers/selection.js";
import type { CanvasNode, PopoverModel } from "./popovers/types.js";

export interface CanvasComposerBinding extends ArchitectureCanvasMount {
  readonly selection: CanvasSelectionContext;
  readonly boxes: MultiBoxSelectionController;
  readonly popovers: NodeTypePopoverRegistry;
  readonly composer: ComposerTargetStateMachine;
  readonly positions: SavedNodePositionStore;
  readonly shellSlice: LandedShellCanvasPort;
  readonly lastPopover: PopoverModel | null;
  select(node: CanvasNode): ReturnType<ComposerTargetStateMachine["projection"]>;
  pressMic(): void;
}

export function bindCanvasComposer(options: {
  readonly shell: SingleAppShell;
  readonly nodes: readonly CanvasNode[];
  readonly dispatch: CanvasDaemonDispatch;
}): CanvasComposerBinding {
  const catalog = new MemoryCanvasNodeCatalog(options.nodes);
  const publishing = new PublishingBoxSelection();
  const snapshotter = new DispatchFocusSnapshotter(options.dispatch);
  const dictation = new DispatchDictation(options.dispatch);
  const ports: ComposerPorts = {
    snapshotter,
    sequencer: new LocalUnifiedMessageSequencer(),
    clauseExecutor: new LocalOrderedMultiClauseExecutor(),
    selection: publishing,
    dictation,
    intake: new LocalDocumentIntake(),
    brand: new LocalBrandAssetSanitizer(),
    clock: new ManualClock(),
    session: new MemorySessionStorage(),
  };
  const composer = new ComposerTargetStateMachine(ports);
  const shellSlot = new ShellComposerSlot(options.shell);
  composer.subscribe(() => {
    shellSlot.publish(viewOf(composer));
  });
  const selection = new CanvasSelectionContext();
  const boxes = new MultiBoxSelectionController(catalog, new GraphSelectionPort(selection), new BoxSync(composer, publishing));
  const popovers = new NodeTypePopoverRegistry();
  const positions = new SavedNodePositionStore(new DaemonCanvasLayoutPersistence(options.dispatch));
  const shellSlice = new LandedShellCanvasPort(options.shell.context);
  let lastPopover: PopoverModel | null = null;
  const binding: CanvasComposerBinding = {
    kind: "architecture-canvas",
    selection,
    boxes,
    popovers,
    composer,
    positions,
    shellSlice,
    get lastPopover() {
      return lastPopover;
    },
    select(node) {
      boxes.selectOnly(node.id);
      lastPopover = popovers.describe(node);
      return composer.projection();
    },
    pressMic() {
      composer.pressMic();
    },
  };
  options.shell.mountArchitectureCanvas(binding);
  shellSlot.publish(viewOf(composer));
  return binding;
}

class PublishingBoxSelection implements MultiBoxSelectionControllerPort {
  private boxes: readonly CanvasBox[] = [];
  private readonly listeners = new Set<(boxes: readonly CanvasBox[]) => void>();

  getSelectedBoxes(): readonly CanvasBox[] {
    return this.boxes;
  }

  replace(boxes: readonly CanvasBox[]): void {
    this.boxes = boxes.map((box) => ({ nodeId: box.nodeId, revision: box.revision, label: box.label }));
    for (const listener of this.listeners) listener(this.boxes);
  }

  subscribe(listener: (boxes: readonly CanvasBox[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

class BoxSync implements ComposerTargetPort {
  constructor(
    private readonly composer: ComposerTargetStateMachine,
    private readonly publishing: PublishingBoxSelection,
  ) {}

  syncBoxSelection(selection: { nodeIds: readonly string[]; nodeRevisions: readonly number[]; labels: readonly string[] }): ComposerSyncReceipt {
    const boxes: CanvasBox[] = selection.nodeIds.map((nodeId, index) => ({
      nodeId,
      revision: selection.nodeRevisions[index] ?? 1,
      label: selection.labels[index] ?? nodeId,
    }));
    this.publishing.replace(boxes);
    const projection = this.composer.projection();
    const target = projection.target;
    return {
      hijackedQuestion: false,
      submittedAnswer: false,
      activeTarget: target.kind === "Box" ? "box" : target.kind === "Question" ? "question" : "general",
      pill: projection.pillText,
      nodeIds: boxes.map((box) => box.nodeId),
      nodeRevisions: boxes.map((box) => box.revision),
      optionsVersion: target.kind === "Question" ? target.optionsVersion : null,
      questionDraft: target.kind === "Question" ? projection.caret.text : "",
    };
  }
}

class GraphSelectionPort implements CanvasSelectionContextPort {
  constructor(private readonly selection: CanvasSelectionContext) {}

  read(): readonly string[] {
    return this.selection.snapshot().selectedNodeIds;
  }

  write(nodeIds: readonly string[]): void {
    this.selection.clear();
    const first = nodeIds[0];
    if (nodeIds.length === 1 && first) {
      this.selection.selectSingle(first);
      return;
    }
    for (const id of nodeIds) this.selection.toggleSelect(id);
  }

  subscribe(): () => void {
    return () => undefined;
  }
}

class DispatchFocusSnapshotter implements InputStartFocusSnapshotterPort {
  private readonly inner = new LocalInputStartFocusSnapshotter();

  constructor(private readonly dispatch: CanvasDaemonDispatch) {}

  capture(fields: FocusCaptureFields): FocusSnapshot {
    this.dispatch("composer.focus.begin", {
      draftId: "single-composer",
      inputStartedAt: fields.inputStartedAt,
      activeTab: fields.activeTab,
      selectedCanvasNodeIds: [...fields.selectedCanvasNodeIds],
      openQuestionCardId: fields.openQuestionCardId,
      openQuestionOptionsVersion: fields.openQuestionOptionsVersion,
      focusedFeatureId: fields.focusedFeatureId,
      inspectedTaskId: fields.inspectedTaskId,
      previewSelectedElement: fields.previewSelectedElement,
    });
    return this.inner.capture(fields);
  }
}

class DispatchDictation implements DictationLiveDraftPort {
  recording = false;
  readonly syllables: string[] = [];

  constructor(private readonly dispatch: CanvasDaemonDispatch) {}

  setRecording(active: boolean): void {
    this.recording = active;
    this.dispatch("composer.dictation.setRecording", { active });
  }

  noteSyllable(text: string): void {
    this.syllables.push(text);
  }
}

class ShellComposerSlot implements SingleAppShellPort {
  readonly slot = COMPOSER_SHELL_SLOT;

  constructor(private readonly shell: SingleAppShell) {}

  publish(view: ComposerViewModel): void {
    this.shell.setComposerDraft(view.draftText);
  }
}

export type { CanvasDaemonDispatch };

function viewOf(composer: ComposerTargetStateMachine): ComposerViewModel {
  const projection = composer.projection();
  return {
    composerId: "single-composer",
    composerCount: 1,
    slot: COMPOSER_SHELL_SLOT,
    pillText: projection.pillText,
    pillClearable: projection.target.kind !== "General",
    target: projection.target,
    targetKey: projection.targetKey,
    draftText: projection.caret.text,
    cursor: projection.caret.cursor,
    selectionEnd: projection.caret.selectionEnd,
    interim: projection.interim,
    recording: projection.recording,
    attachments: projection.attachments,
    toast: projection.toast,
    mismatch: projection.mismatch,
    preview: projection.preview,
    escConfirm: projection.escConfirm,
    pausedQuestion: projection.pausedQuestion,
    openQuestionId: projection.openQuestion?.questionId ?? null,
    snapshotLocked: projection.snapshot !== null,
    lateInboxCardIds: projection.lateCards.map((card) => card.questionId),
    hints: {
      enter: "Enter to send",
      shiftEnter: "Shift+Enter for newline",
      escape: "Esc clears the explicit target",
      arrowUp: "Up Arrow recalls draft history",
      mic: "Dictation",
    },
  };
}
