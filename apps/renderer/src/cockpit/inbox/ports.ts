import type { EnvScope, HonestyBadge } from "./types.js";

/**
 * Local ports for sibling tasks that are not on this foundation base.
 * Swap these for the real exports at integration. See the task handoff.
 */

export interface VaultPutRequest {
  readonly projectId: string;
  readonly envScope: EnvScope;
  readonly name: string;
  readonly value: string;
}

export type VaultPutResult =
  | { readonly ok: true; readonly secretId: string }
  | { readonly ok: false; readonly code: "live_key_refused"; readonly message: string };

export interface PreloadSecretIpc {
  put(request: VaultPutRequest): Promise<VaultPutResult>;
  probe(secretId: string): Promise<{ readonly ok: boolean; readonly message: string }>;
  useLocalMock(name: string): Promise<{ readonly ok: true }>;
}

export interface ChatTranscript {
  append(text: string): void;
  messages(): readonly string[];
}

export interface UserMessageStore {
  insert(text: string): void;
  rows(): readonly string[];
  byteLength(): number;
}

export interface DevtoolsLog {
  log(entry: string): void;
  entries(): readonly string[];
}

export interface ComposerQuestionBind {
  bind(questionId: string): void;
  draft(): string;
  writeDraft(text: string): void;
  target(): string | null;
}

export interface StaleReplyInput {
  readonly status: "open" | "retired";
  readonly retiredBy: "vscode" | "feature_undo" | null;
  readonly optionsVersion: number;
}

export interface QuestionReply {
  readonly optionsVersion: number;
  readonly optionId: string;
}

export type StaleReplyResult =
  | { readonly outcome: "fresh" }
  | {
      readonly outcome: "needs_choice";
      readonly prompt: string;
      readonly choices: readonly ["keep", "change"];
    };

/** Task 116 `StaleReplyReconciler.receive`. */
export interface StaleReplyReconciler {
  receive(card: StaleReplyInput, reply: QuestionReply): StaleReplyResult;
}

export interface HumanStepCheck {
  readonly outcome: "pass" | "fail";
  readonly diagnosis: string;
  readonly badge: HonestyBadge;
}

/** Task 121 `HumanStepProbeRegistry.checkAgain`. */
export interface HumanStepProbePort {
  checkAgain(stepId: string): Promise<HumanStepCheck>;
}

export interface AccountConnectionPort {
  reauthenticate(provider: string): void;
  switchConnection(provider: string): void;
  calls(): readonly string[];
}

export interface ApprovalDecisionPort {
  decide(cardId: string, action: "approve" | "edit" | "decline"): void;
  decisions(): readonly { readonly cardId: string; readonly action: string }[];
}

export interface NativeNotice {
  readonly id: string;
  readonly body: string;
  readonly cardId: string;
}

/** Task 131 tray notification. This task only asks the port to show one notice. */
export interface NativeNotificationPort {
  show(notice: NativeNotice): void;
  notices(): readonly NativeNotice[];
}
