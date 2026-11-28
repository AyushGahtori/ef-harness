export const COMPOSER_TARGET_KINDS = ["Question", "Box", "Element", "General"] as const;

export type ComposerTargetKind = (typeof COMPOSER_TARGET_KINDS)[number];

export const SINGLE_COMPOSER_ID = "single-composer" as const;

export const COMPOSER_SHELL_SLOT = "chat-composer" as const;

export interface QuestionOption {
  readonly position: number;
  readonly label: string;
}

export interface QuestionTarget {
  readonly kind: "Question";
  readonly questionId: string;
  readonly title: string;
  readonly optionsVersion: number;
  readonly options: readonly QuestionOption[];
  readonly selectedOptionPosition?: number;
}

export interface CanvasBox {
  readonly nodeId: string;
  readonly revision: number;
  readonly label: string;
}

export interface BoxTarget {
  readonly kind: "Box";
  readonly boxes: readonly CanvasBox[];
}

export interface PreviewElement {
  readonly elementId: string;
  readonly label: string;
  readonly source: string;
}

export interface ElementTarget {
  readonly kind: "Element";
  readonly element: PreviewElement;
}

export interface GeneralTarget {
  readonly kind: "General";
}

export type ComposerTarget = QuestionTarget | BoxTarget | ElementTarget | GeneralTarget;

export interface NodeRevision {
  readonly nodeId: string;
  readonly revision: number;
}

export interface DraftCaret {
  readonly text: string;
  readonly cursor: number;
  readonly selectionEnd: number;
}

export interface StoredDraft extends DraftCaret {
  readonly targetKey: string;
  readonly savedAt: string;
}

export const EMPTY_CARET: DraftCaret = { text: "", cursor: 0, selectionEnd: 0 };

export type DictationStability = "tentative" | "confirmed";

export interface DictationInterim {
  readonly text: string;
  readonly stability: DictationStability;
}

export interface FocusSnapshot {
  readonly inputStartedAt: string;
  readonly targetType: ComposerTargetKind;
  readonly targetId: string;
  readonly optionsVersion: number | null;
  readonly selectedNodeRevisions: readonly NodeRevision[];
  readonly activeTab: string;
  readonly selectedCanvasNodeIds: readonly string[];
  readonly openQuestionCardId: string | null;
  readonly openQuestionOptionsVersion: number | null;
  readonly focusedFeatureId: string | null;
  readonly inspectedTaskId: string | null;
  readonly previewSelectedElement: string | null;
  readonly frozen: true;
}

export interface FocusCaptureFields {
  readonly inputStartedAt: string;
  readonly targetType: ComposerTargetKind;
  readonly targetId: string;
  readonly optionsVersion: number | null;
  readonly selectedNodeRevisions: readonly NodeRevision[];
  readonly activeTab: string;
  readonly selectedCanvasNodeIds: readonly string[];
  readonly openQuestionCardId: string | null;
  readonly openQuestionOptionsVersion: number | null;
  readonly focusedFeatureId: string | null;
  readonly inspectedTaskId: string | null;
  readonly previewSelectedElement: string | null;
}

export type AttachmentRoute = "intake" | "brand-asset";

export interface AttachmentChip {
  readonly id: string;
  readonly name: string;
  readonly byteSize: number;
  readonly sizeLabel: string;
  readonly typeBadge: string;
  readonly route: AttachmentRoute;
  readonly mediaType: string;
}

export interface DroppedFile {
  readonly name: string;
  readonly byteSize: number;
  readonly mediaType: string;
}

export type MismatchKind = "positional-non-question" | "option-label" | "unrelated-topic";

export type MismatchActionId =
  | "answer-question"
  | "keep-current"
  | "send-as-answer"
  | "switch-to-general";

export interface MismatchAction {
  readonly id: MismatchActionId;
  readonly label: string;
}

export interface MismatchPrompt {
  readonly kind: MismatchKind;
  readonly message: string;
  readonly question: QuestionTarget;
  readonly optionPosition: number | null;
  readonly actions: readonly MismatchAction[];
}

export interface SelectionPreview {
  readonly kind: "box" | "element";
  readonly boxes: readonly CanvasBox[];
  readonly element: PreviewElement | null;
  readonly switchLabel: string;
}

export interface AutoReturnToast {
  readonly message: string;
  readonly stayLabel: string;
  readonly returnTo: ComposerTarget;
}

export interface EscConfirm {
  readonly message: string;
}

export interface PausedQuestion {
  readonly questionId: string;
  readonly title: string;
  readonly note: string;
  readonly selectedOptionPosition: number | null;
}

export interface AtomicBoxClause {
  readonly order: number;
  readonly clauseText: string;
  readonly nodeId: string;
  readonly revision: number;
  readonly intentType: "edit_existing";
}

export interface MultiBoxSplit {
  readonly nodeIds: readonly string[];
  readonly nodeRevisions: readonly NodeRevision[];
  readonly clauses: readonly AtomicBoxClause[];
}

export interface ComposerSubmission {
  readonly text: string;
  readonly typedOn: ComposerTarget;
  readonly routedTarget: ComposerTarget;
  readonly routedKind: ComposerTargetKind;
  readonly routedTargetId: string;
  readonly routedOptionsVersion: number | null;
  readonly inputStartSnapshot: FocusSnapshot;
  readonly nodeIds: readonly string[];
  readonly nodeRevisions: readonly NodeRevision[];
  readonly clauses: readonly AtomicBoxClause[];
  readonly attachments: readonly AttachmentChip[];
}

export type SendResult =
  | { readonly status: "empty" }
  | { readonly status: "needs-confirmation"; readonly prompt: MismatchPrompt }
  | {
      readonly status: "sent";
      readonly msgSeq: number;
      readonly messageId: string;
      readonly submission: ComposerSubmission;
    };

export interface KeyModifiers {
  readonly shift?: boolean;
}

export type KeyAction =
  | "newline"
  | "send"
  | "history"
  | "dismiss-mismatch"
  | "dismiss-preview"
  | "cancel-clear"
  | "confirm-clear"
  | "clear-target"
  | "noop"
  | "caret"
  | "none";

export interface KeyResult {
  readonly handled: boolean;
  readonly action: KeyAction;
  readonly send?: SendResult;
}

export interface WorkspaceContext {
  readonly activeTab: string;
  readonly focusedFeatureId: string | null;
  readonly inspectedTaskId: string | null;
}

export interface ComposerViewModel {
  readonly composerId: typeof SINGLE_COMPOSER_ID;
  readonly composerCount: 1;
  readonly slot: typeof COMPOSER_SHELL_SLOT;
  readonly pillText: string;
  readonly pillClearable: boolean;
  readonly target: ComposerTarget;
  readonly targetKey: string;
  readonly draftText: string;
  readonly cursor: number;
  readonly selectionEnd: number;
  readonly interim: DictationInterim | null;
  readonly recording: boolean;
  readonly attachments: readonly AttachmentChip[];
  readonly toast: AutoReturnToast | null;
  readonly mismatch: MismatchPrompt | null;
  readonly preview: SelectionPreview | null;
  readonly escConfirm: EscConfirm | null;
  readonly pausedQuestion: PausedQuestion | null;
  readonly openQuestionId: string | null;
  readonly snapshotLocked: boolean;
  readonly lateInboxCardIds: readonly string[];
  readonly hints: {
    readonly enter: "Enter to send";
    readonly shiftEnter: "Shift+Enter for newline";
    readonly escape: "Esc clears the explicit target";
    readonly arrowUp: "Up Arrow recalls draft history";
    readonly mic: "Dictation";
  };
}

export interface ComposerTargetHookSnapshot {
  readonly composerId: typeof SINGLE_COMPOSER_ID;
  readonly target: ComposerTarget;
  readonly targetKey: string;
  readonly pillText: string;
  readonly draft: DraftCaret;
  readonly inputSnapshot: FocusSnapshot | null;
  readonly openQuestionId: string | null;
}

export const ESC_CONFIRM_MESSAGE =
  "Clear the target and return to General? Your draft stays recoverable.";

export const SWITCH_TO_BOX_LABEL = "Switch composer to this box";

export const SWITCH_TO_BOXES_LABEL = "Switch composer to these boxes";

export const SWITCH_TO_ELEMENT_LABEL = "Switch composer to this element";
