import { ComposerTargetStateMachine } from "./composer-target-state-machine.js";
import { createLocalComposerBundle, type LocalComposerBundle } from "./ports.js";
import type {
  CanvasBox,
  ComposerTarget,
  ComposerViewModel,
  DictationStability,
  DroppedFile,
  KeyModifiers,
  KeyResult,
  MismatchActionId,
  PreviewElement,
  QuestionTarget,
  SendResult,
  WorkspaceContext,
} from "./types.js";
import { COMPOSER_SHELL_SLOT, SINGLE_COMPOSER_ID } from "./types.js";

export class SingleComposerView {
  readonly bundle: LocalComposerBundle;
  readonly machine: ComposerTargetStateMachine;

  constructor(bundle?: LocalComposerBundle) {
    this.bundle = bundle ?? createLocalComposerBundle();
    this.machine = new ComposerTargetStateMachine(this.bundle.ports);
    this.machine.subscribe(() => {
      this.bundle.shell.publish(this.viewModel());
    });
    this.bundle.shell.publish(this.viewModel());
  }

  viewModel(): ComposerViewModel {
    const projection = this.machine.projection();
    return {
      composerId: SINGLE_COMPOSER_ID,
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

  focusQuestion(question: QuestionTarget): void {
    this.machine.focusQuestion(question);
  }

  activateTarget(target: ComposerTarget): void {
    this.machine.activateTarget(target);
  }

  inspectBoxes(boxes: readonly CanvasBox[]): void {
    this.machine.inspectBoxes(boxes);
  }

  inspectPreviewElement(element: PreviewElement): void {
    this.machine.inspectPreviewElement(element);
  }

  switchComposerToPreview(): void {
    this.machine.switchComposerToPreview();
  }

  dismissPreview(): void {
    this.machine.dismissPreview();
  }

  type(text: string): void {
    this.machine.insertText(text);
  }

  setCaret(cursor: number, selectionEnd?: number): void {
    this.machine.setCaret(cursor, selectionEnd);
  }

  keydown(key: string, modifiers?: KeyModifiers): KeyResult {
    return this.machine.handleKey(key, modifiers);
  }

  pressMic(): void {
    this.machine.pressMic();
  }

  setInterimDraft(text: string, stability: DictationStability): void {
    this.machine.setInterimDraft(text, stability);
  }

  applyDictationSyllable(text: string): void {
    this.machine.applyDictationSyllable(text);
  }

  dropFiles(files: readonly DroppedFile[]) {
    return this.machine.dropFiles(files);
  }

  clearPill(): void {
    this.machine.clearTargetPill();
  }

  confirmClearTarget(): void {
    this.machine.confirmClearTarget();
  }

  cancelClearTarget(): void {
    this.machine.cancelClearTarget();
  }

  send(): SendResult {
    return this.machine.send();
  }

  chooseMismatch(actionId: MismatchActionId): SendResult {
    return this.machine.chooseMismatch(actionId);
  }

  stayOnSideTarget(): void {
    this.machine.stayOnSideTarget();
  }

  dismissToast(): void {
    this.machine.dismissToast();
  }

  receiveLateInboxCard(card: QuestionTarget): void {
    this.machine.receiveLateInboxCard(card);
  }

  setWorkspaceContext(context: Partial<WorkspaceContext>): void {
    this.machine.setWorkspaceContext(context);
  }

  dispose(): void {
    this.machine.dispose();
  }
}
