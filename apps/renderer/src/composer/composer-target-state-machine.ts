import { toAttachmentChip } from "./attachments.js";
import { MultiBoxClauseSplitter } from "./multi-box-clause-splitter.js";
import { PerTargetDraftStore } from "./per-target-draft-store.js";
import type { ComposerPorts } from "./ports.js";
import {
  caretFrom,
  copyBoxes,
  copyElement,
  copyQuestion,
  copyTarget,
  emptyCaret,
  pillText,
  sideLabel,
  targetIdOf,
  targetKey,
} from "./target.js";
import { TargetTypeMismatchGuard } from "./target-type-mismatch-guard.js";
import type {
  AttachmentChip,
  AutoReturnToast,
  CanvasBox,
  ComposerSubmission,
  ComposerTarget,
  ComposerTargetHookSnapshot,
  DictationInterim,
  DictationStability,
  DraftCaret,
  DroppedFile,
  EscConfirm,
  FocusSnapshot,
  KeyModifiers,
  KeyResult,
  MismatchActionId,
  MismatchPrompt,
  PausedQuestion,
  PreviewElement,
  QuestionTarget,
  SelectionPreview,
  SendResult,
  WorkspaceContext,
} from "./types.js";
import {
  EMPTY_CARET,
  ESC_CONFIRM_MESSAGE,
  SINGLE_COMPOSER_ID,
  SWITCH_TO_BOX_LABEL,
  SWITCH_TO_BOXES_LABEL,
  SWITCH_TO_ELEMENT_LABEL,
} from "./types.js";

type DispatchRoute =
  | { readonly kind: "guarded" }
  | { readonly kind: "current" }
  | { readonly kind: "answer"; readonly question: QuestionTarget }
  | { readonly kind: "general" };

export interface ComposerProjection {
  readonly target: ComposerTarget;
  readonly caret: DraftCaret;
  readonly interim: DictationInterim | null;
  readonly recording: boolean;
  readonly attachments: readonly AttachmentChip[];
  readonly preview: SelectionPreview | null;
  readonly mismatch: MismatchPrompt | null;
  readonly toast: AutoReturnToast | null;
  readonly escConfirm: EscConfirm | null;
  readonly openQuestion: QuestionTarget | null;
  readonly waitingQuestion: QuestionTarget | null;
  readonly snapshot: FocusSnapshot | null;
  readonly lateCards: readonly QuestionTarget[];
  readonly pausedQuestion: PausedQuestion | null;
  readonly pillText: string;
  readonly targetKey: string;
}

export class ComposerTargetStateMachine {
  readonly draftStore: PerTargetDraftStore;
  private readonly guard = new TargetTypeMismatchGuard();
  private readonly splitter = new MultiBoxClauseSplitter();
  private readonly listeners = new Set<() => void>();
  private readonly snapshotsByKey = new Map<string, FocusSnapshot>();
  private readonly sentHistory: string[] = [];
  private readonly lateCards: QuestionTarget[] = [];
  private readonly stopSelection: () => void;

  private target: ComposerTarget = { kind: "General" };
  private caret: DraftCaret = { ...EMPTY_CARET };
  private openQuestion: QuestionTarget | null = null;
  private waitingQuestion: QuestionTarget | null = null;
  private snapshot: FocusSnapshot | null = null;
  private preview: SelectionPreview | null = null;
  private mismatch: MismatchPrompt | null = null;
  private toast: AutoReturnToast | null = null;
  private escConfirm: EscConfirm | null = null;
  private attachments: AttachmentChip[] = [];
  private recording = false;
  private interim: DictationInterim | null = null;
  private historyIndex: number | null = null;
  private attachmentSeq = 0;
  private context: WorkspaceContext = {
    activeTab: "Discover",
    focusedFeatureId: null,
    inspectedTaskId: null,
  };

  constructor(private readonly ports: ComposerPorts) {
    this.draftStore = new PerTargetDraftStore({
      session: ports.session,
      now: () => ports.clock.nowIso(),
    });
    this.stopSelection = ports.selection.subscribe((boxes) => {
      this.inspectBoxes(boxes);
    });
  }

  dispose(): void {
    this.stopSelection();
    this.listeners.clear();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  projection(): ComposerProjection {
    return {
      target: copyTarget(this.target),
      caret: { ...this.caret },
      interim: this.interim,
      recording: this.recording,
      attachments: this.attachments.map((chip) => ({ ...chip })),
      preview: this.preview,
      mismatch: this.mismatch,
      toast: this.toast,
      escConfirm: this.escConfirm,
      openQuestion: this.openQuestion,
      waitingQuestion: this.waitingQuestion,
      snapshot: this.snapshot,
      lateCards: [...this.lateCards],
      pausedQuestion: this.pausedQuestion(),
      pillText: pillText(this.target),
      targetKey: targetKey(this.target),
    };
  }

  exportTargetSnapshot(): ComposerTargetHookSnapshot {
    return {
      composerId: SINGLE_COMPOSER_ID,
      target: copyTarget(this.target),
      targetKey: targetKey(this.target),
      pillText: pillText(this.target),
      draft: { ...this.caret },
      inputSnapshot: this.snapshot,
      openQuestionId: this.openQuestion?.questionId ?? null,
    };
  }

  focusQuestion(question: QuestionTarget): void {
    const copy = copyQuestion(question);
    this.openQuestion = copy;
    this.adoptTarget(copy);
  }

  noteOpenQuestion(question: QuestionTarget): void {
    const copy = copyQuestion(question);
    if (this.openQuestion === null) this.openQuestion = copy;
    this.publish();
  }

  receiveLateInboxCard(card: QuestionTarget): void {
    const copy = copyQuestion(card);
    this.lateCards.push(copy);
    const busy =
      this.snapshot !== null ||
      this.caret.text.length > 0 ||
      this.interim !== null ||
      this.target.kind === "Question" ||
      this.openQuestion !== null;
    if (!busy) {
      this.focusQuestion(copy);
      return;
    }
    this.publish();
  }

  activateTarget(target: ComposerTarget): void {
    if (target.kind === "Question") {
      this.focusQuestion(target);
      return;
    }
    this.adoptTarget(copyTarget(target));
  }

  inspectBoxes(boxes: readonly CanvasBox[]): void {
    if (boxes.length === 0) {
      if (this.preview?.kind === "box") this.preview = null;
      this.publish();
      return;
    }
    const copied = copyBoxes(boxes);
    if (this.target.kind === "Question") {
      this.preview = {
        kind: "box",
        boxes: copied,
        element: null,
        switchLabel: copied.length > 1 ? SWITCH_TO_BOXES_LABEL : SWITCH_TO_BOX_LABEL,
      };
      this.publish();
      return;
    }
    this.adoptTarget({ kind: "Box", boxes: copied });
  }

  inspectPreviewElement(element: PreviewElement): void {
    const copy = copyElement(element);
    if (this.target.kind === "Question") {
      this.preview = {
        kind: "element",
        boxes: [],
        element: copy,
        switchLabel: SWITCH_TO_ELEMENT_LABEL,
      };
      this.publish();
      return;
    }
    this.adoptTarget({ kind: "Element", element: copy });
  }

  switchComposerToPreview(): void {
    const preview = this.preview;
    if (!preview) return;
    if (preview.kind === "box") {
      if (preview.boxes.length === 0) return;
      this.adoptTarget({ kind: "Box", boxes: copyBoxes(preview.boxes) });
      return;
    }
    if (!preview.element) return;
    this.adoptTarget({ kind: "Element", element: copyElement(preview.element) });
  }

  dismissPreview(): void {
    this.preview = null;
    this.publish();
  }

  clearTargetPill(): void {
    this.moveToGeneral(true);
  }

  confirmClearTarget(): void {
    this.escConfirm = null;
    this.moveToGeneral(true);
  }

  cancelClearTarget(): void {
    this.escConfirm = null;
    this.publish();
  }

  insertText(chunk: string): void {
    const start = Math.min(this.caret.cursor, this.caret.selectionEnd);
    const end = Math.max(this.caret.cursor, this.caret.selectionEnd);
    const next = this.caret.text.slice(0, start) + chunk + this.caret.text.slice(end);
    const at = start + chunk.length;
    this.caret = caretFrom(next, at, at);
    this.historyIndex = null;
    this.mismatch = null;
    if (!this.snapshot && next.length > 0) this.lockSnapshot();
    this.persist();
    this.publish();
  }

  setCaret(cursor: number, selectionEnd?: number): void {
    this.caret = caretFrom(this.caret.text, cursor, selectionEnd ?? cursor);
    this.persist();
    this.publish();
  }

  replaceDraft(text: string, cursor: number): void {
    const at = Math.max(0, Math.min(cursor, text.length));
    this.caret = caretFrom(text, at, at);
    this.historyIndex = null;
    if (!this.snapshot && text.length > 0) this.lockSnapshot();
    this.persist();
    this.publish();
  }

  handleKey(key: string, modifiers?: KeyModifiers): KeyResult {
    if (key === "Enter" && modifiers?.shift) {
      this.insertText("\n");
      return { handled: true, action: "newline" };
    }
    if (key === "Enter") {
      const send = this.send();
      return { handled: true, action: "send", send };
    }
    if (key === "Escape") return this.handleEscape();
    if (key === "ArrowUp" && this.caret.cursor === 0 && this.caret.selectionEnd === 0) {
      this.recallHistory();
      return { handled: true, action: "history" };
    }
    if (key === "ArrowUp") return { handled: false, action: "caret" };
    return { handled: false, action: "none" };
  }

  pressMic(): void {
    this.recording = !this.recording;
    this.ports.dictation.setRecording(this.recording);
    if (this.recording && !this.snapshot) this.lockSnapshot();
    this.publish();
  }

  setInterimDraft(text: string, stability: DictationStability): void {
    if (!this.snapshot) this.lockSnapshot();
    if (stability === "confirmed") {
      this.interim = null;
      if (text.length > 0) this.insertText(text);
      else this.publish();
      return;
    }
    this.interim = { text, stability };
    this.publish();
  }

  applyDictationSyllable(text: string): void {
    this.ports.dictation.noteSyllable(text);
    if (!this.snapshot) this.lockSnapshot();
    if (text.length > 0) this.insertText(text);
    else this.publish();
  }

  dropFiles(files: readonly DroppedFile[]): readonly AttachmentChip[] {
    for (const file of files) {
      this.attachmentSeq += 1;
      this.attachments.push(toAttachmentChip(file, `chip-${this.attachmentSeq}`));
    }
    if (files.length > 0 && !this.snapshot) this.lockSnapshot();
    this.publish();
    return this.attachments.map((chip) => ({ ...chip }));
  }

  removeAttachment(id: string): void {
    this.attachments = this.attachments.filter((chip) => chip.id !== id);
    this.publish();
  }

  send(): SendResult {
    if (this.mismatch) return { status: "needs-confirmation", prompt: this.mismatch };
    return this.dispatch({ kind: "guarded" });
  }

  chooseMismatch(actionId: MismatchActionId): SendResult {
    const prompt = this.mismatch;
    if (!prompt) return { status: "empty" };
    this.mismatch = null;
    if (actionId === "answer-question" || actionId === "send-as-answer") {
      return this.dispatch({ kind: "answer", question: prompt.question });
    }
    if (actionId === "switch-to-general") return this.dispatch({ kind: "general" });
    return this.dispatch({ kind: "current" });
  }

  stayOnSideTarget(): void {
    const toast = this.toast;
    if (!toast) return;
    if (this.target.kind === "Question") {
      this.draftStore.save(targetKey(this.target), this.caret);
      if (this.snapshot) this.snapshotsByKey.set(targetKey(this.target), this.snapshot);
      this.waitingQuestion = this.target;
      this.openQuestion = this.target;
    }
    this.toast = null;
    this.target = copyTarget(toast.returnTo);
    this.caret = this.draftStore.read(targetKey(this.target));
    this.snapshot = this.caret.text.length > 0 ? (this.snapshotsByKey.get(targetKey(this.target)) ?? null) : null;
    this.publish();
  }

  dismissToast(): void {
    this.toast = null;
    this.publish();
  }

  setWorkspaceContext(context: Partial<WorkspaceContext>): void {
    this.context = {
      activeTab: context.activeTab ?? this.context.activeTab,
      focusedFeatureId:
        context.focusedFeatureId === undefined
          ? this.context.focusedFeatureId
          : context.focusedFeatureId,
      inspectedTaskId:
        context.inspectedTaskId === undefined ? this.context.inspectedTaskId : context.inspectedTaskId,
    };
  }

  private dispatch(route: DispatchRoute): SendResult {
    const text = this.visibleText();
    if (this.escConfirm) return { status: "empty" };
    if (!text.trim() && this.attachments.length === 0) return { status: "empty" };

    const typedOn = copyTarget(this.target);
    if (route.kind === "guarded") {
      const finding = this.guard.inspect({
        target: typedOn,
        text,
        openQuestion: this.openQuestion ?? (typedOn.kind === "Question" ? typedOn : null),
      });
      if (finding) {
        this.mismatch = finding;
        this.publish();
        return { status: "needs-confirmation", prompt: finding };
      }
    }

    const routed = this.resolveRoute(route, typedOn);
    const inputStartSnapshot = this.snapshot ?? this.lockSnapshot();
    const split = routed.kind === "Box" ? this.splitter.split(text, routed.boxes) : null;
    if (split && routed.kind === "Box" && routed.boxes.length >= 2) {
      this.ports.clauseExecutor.execute(split);
    }
    const chips = this.attachments.map((chip) => ({ ...chip }));
    for (const chip of chips) {
      if (chip.route === "brand-asset") this.ports.brand.sanitize(chip);
      else {
        this.ports.intake.convert(chip);
        this.ports.intake.extract(chip);
      }
    }
    const submission: ComposerSubmission = {
      text,
      typedOn,
      routedTarget: routed,
      routedKind: routed.kind,
      routedTargetId: targetIdOf(routed),
      routedOptionsVersion: routed.kind === "Question" ? routed.optionsVersion : null,
      inputStartSnapshot,
      nodeIds: split?.nodeIds ?? [],
      nodeRevisions: split?.nodeRevisions ?? [],
      clauses: split?.clauses ?? [],
      attachments: chips,
    };
    const sequenced = this.ports.sequencer.assign(submission);
    this.pushHistory(text);

    const waiting = this.waitingQuestion;
    const shouldReturn =
      route.kind !== "answer" &&
      route.kind !== "general" &&
      (typedOn.kind === "Box" || typedOn.kind === "Element") &&
      waiting !== null;

    this.draftStore.save(targetKey(typedOn), emptyCaret());
    this.snapshotsByKey.delete(targetKey(typedOn));
    if (routed.kind === "Question" && targetKey(routed) !== targetKey(typedOn)) {
      const stashed = this.draftStore.read(targetKey(routed));
      if (stashed.text.trim() && stashed.text !== text) this.pushHistory(stashed.text);
      this.draftStore.save(targetKey(routed), emptyCaret());
      this.snapshotsByKey.delete(targetKey(routed));
    }
    if (routed.kind === "Question") {
      this.openQuestion = null;
      this.waitingQuestion = null;
    }

    this.caret = emptyCaret();
    this.snapshot = null;
    this.interim = null;
    this.attachments = [];
    this.recording = false;
    this.ports.dictation.setRecording(false);
    this.mismatch = null;
    this.preview = null;
    this.escConfirm = null;
    this.historyIndex = null;

    if (shouldReturn && waiting) {
      const sentLabel = sideLabel(typedOn);
      this.toast = {
        message: `Sent to ${sentLabel} · Back to replying to '${waiting.title}' (Stay on ${sentLabel})`,
        stayLabel: sentLabel,
        returnTo: typedOn,
      };
      this.openQuestion = copyQuestion(waiting);
      this.waitingQuestion = null;
      this.target = copyQuestion(waiting);
      this.caret = this.draftStore.read(targetKey(waiting));
      this.snapshot =
        this.caret.text.length > 0 ? (this.snapshotsByKey.get(targetKey(waiting)) ?? null) : null;
    } else if (routed.kind === "Question" || route.kind === "general") {
      if (route.kind === "general" && typedOn.kind === "Question") this.openQuestion = typedOn;
      this.target = { kind: "General" };
      this.caret = this.draftStore.read("general");
      this.snapshot = null;
    } else {
      this.target = typedOn;
      this.caret = emptyCaret();
      this.snapshot = null;
    }

    this.publish();
    return {
      status: "sent",
      msgSeq: sequenced.msgSeq,
      messageId: sequenced.messageId,
      submission,
    };
  }

  private resolveRoute(route: DispatchRoute, typedOn: ComposerTarget): ComposerTarget {
    if (route.kind === "answer") return copyQuestion(route.question);
    if (route.kind === "general") return { kind: "General" };
    return typedOn;
  }

  private adoptTarget(next: ComposerTarget): void {
    const previous = this.target;
    const previousKey = targetKey(previous);
    const nextKey = targetKey(next);
    if (previousKey === nextKey) {
      if (this.snapshot && previous.kind === "Question" && next.kind === "Question") {
        this.publish();
        return;
      }
      this.target = next;
      if (next.kind === "Question") {
        this.openQuestion = next;
        this.waitingQuestion = null;
      }
      this.publish();
      return;
    }
    this.draftStore.save(previousKey, this.caret);
    if (this.snapshot) this.snapshotsByKey.set(previousKey, this.snapshot);
    if (previous.kind === "Question" && (next.kind === "Box" || next.kind === "Element")) {
      this.waitingQuestion = previous;
      this.openQuestion = previous;
    }
    if (next.kind === "Question") {
      this.waitingQuestion = null;
      this.openQuestion = next;
    }
    if (next.kind === "General") this.waitingQuestion = null;
    this.target = next;
    this.caret = this.draftStore.read(nextKey);
    const restored = this.snapshotsByKey.get(nextKey) ?? null;
    this.snapshot = this.caret.text.length > 0 ? restored : null;
    this.historyIndex = null;
    this.escConfirm = null;
    this.mismatch = null;
    this.preview = null;
    this.publish();
  }

  private moveToGeneral(moveDraft: boolean): void {
    const paragraph = this.caret;
    const previous = this.target;
    const previousKey = targetKey(previous);
    if (previous.kind === "General") {
      this.escConfirm = null;
      this.publish();
      return;
    }
    this.draftStore.save(previousKey, paragraph);
    if (this.snapshot) this.snapshotsByKey.set(previousKey, this.snapshot);
    if (previous.kind === "Question") this.openQuestion = previous;
    this.waitingQuestion = null;
    if (moveDraft && paragraph.text.length > 0) {
      const existing = this.draftStore.read("general");
      if (existing.text.length > 0 && existing.text !== paragraph.text) this.pushHistory(existing.text);
      this.draftStore.save("general", paragraph);
    }
    this.target = { kind: "General" };
    this.caret = this.draftStore.read("general");
    this.snapshot = null;
    this.preview = null;
    this.mismatch = null;
    this.escConfirm = null;
    this.historyIndex = null;
    this.publish();
  }

  private handleEscape(): KeyResult {
    if (this.mismatch) {
      this.mismatch = null;
      this.publish();
      return { handled: true, action: "dismiss-mismatch" };
    }
    if (this.preview) {
      this.preview = null;
      this.publish();
      return { handled: true, action: "dismiss-preview" };
    }
    if (this.escConfirm) {
      this.escConfirm = null;
      this.publish();
      return { handled: true, action: "cancel-clear" };
    }
    if (this.target.kind === "General") return { handled: true, action: "noop" };
    if (this.caret.text.length > 0) {
      this.escConfirm = { message: ESC_CONFIRM_MESSAGE };
      this.publish();
      return { handled: true, action: "confirm-clear" };
    }
    this.moveToGeneral(false);
    return { handled: true, action: "clear-target" };
  }

  private recallHistory(): void {
    if (this.sentHistory.length === 0) return;
    if (this.historyIndex === null) {
      this.historyIndex = this.sentHistory.length - 1;
    } else if (this.historyIndex > 0) {
      this.historyIndex -= 1;
    }
    const text = this.sentHistory[this.historyIndex] ?? "";
    this.caret = caretFrom(text, text.length, text.length);
    this.mismatch = null;
    if (!this.snapshot && text.length > 0) this.lockSnapshot();
    this.persist();
    this.publish();
  }

  private lockSnapshot(): FocusSnapshot {
    if (this.snapshot) return this.snapshot;
    const target = this.target;
    const open = this.openQuestion ?? (target.kind === "Question" ? target : null);
    const boxes = target.kind === "Box" ? target.boxes : [];
    const snapshot = this.ports.snapshotter.capture({
      inputStartedAt: this.ports.clock.nowIso(),
      targetType: target.kind,
      targetId: targetIdOf(target),
      optionsVersion: target.kind === "Question" ? target.optionsVersion : null,
      selectedNodeRevisions: boxes.map((box) => ({
        nodeId: box.nodeId,
        revision: box.revision,
      })),
      activeTab: this.context.activeTab,
      selectedCanvasNodeIds: boxes.map((box) => box.nodeId),
      openQuestionCardId: open?.questionId ?? null,
      openQuestionOptionsVersion: open?.optionsVersion ?? null,
      focusedFeatureId: this.context.focusedFeatureId,
      inspectedTaskId: this.context.inspectedTaskId,
      previewSelectedElement:
        target.kind === "Element" ? target.element.elementId : (this.preview?.element?.elementId ?? null),
    });
    this.snapshot = snapshot;
    this.snapshotsByKey.set(targetKey(target), snapshot);
    return snapshot;
  }

  private visibleText(): string {
    return this.caret.text + (this.interim?.text ?? "");
  }

  private persist(): void {
    this.draftStore.save(targetKey(this.target), this.caret);
  }

  private pushHistory(text: string): void {
    if (!text.trim()) return;
    const last = this.sentHistory[this.sentHistory.length - 1];
    if (last === text) return;
    this.sentHistory.push(text);
  }

  private pausedQuestion(): PausedQuestion | null {
    const waiting = this.waitingQuestion;
    if (!waiting) return null;
    if (this.target.kind !== "Box" && this.target.kind !== "Element") return null;
    return {
      questionId: waiting.questionId,
      title: waiting.title,
      note: `Paused: you're talking about ${sideLabel(this.target)}`,
      selectedOptionPosition: waiting.selectedOptionPosition ?? null,
    };
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }
}
