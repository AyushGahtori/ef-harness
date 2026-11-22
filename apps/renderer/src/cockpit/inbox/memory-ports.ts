import type {
  AccountConnectionPort,
  ApprovalDecisionPort,
  ChatTranscript,
  ComposerQuestionBind,
  DevtoolsLog,
  HumanStepCheck,
  HumanStepProbePort,
  NativeNotice,
  NativeNotificationPort,
  PreloadSecretIpc,
  StaleReplyInput,
  StaleReplyReconciler,
  StaleReplyResult,
  UserMessageStore,
  VaultPutRequest,
  VaultPutResult,
} from "./ports.js";
import { isLiveTestKey } from "./text.js";
import { LIVE_KEY_REFUSAL, OPTIONS_CHANGED_PROMPT, STALE_VS_CODE_PROMPT, type EnvScope } from "./types.js";

export class MemorySecretIpc implements PreloadSecretIpc {
  readonly stored = new Map<string, { readonly name: string; readonly value: string; readonly scope: EnvScope }>();
  readonly probes: string[] = [];
  readonly mocks: string[] = [];
  private serial = 0;

  async put(request: VaultPutRequest): Promise<VaultPutResult> {
    if (isLiveTestKey(request.value, request.envScope)) {
      return { ok: false, code: "live_key_refused", message: LIVE_KEY_REFUSAL };
    }
    this.serial += 1;
    const secretId = `secret-${this.serial}`;
    this.stored.set(secretId, { name: request.name, value: request.value, scope: request.envScope });
    return { ok: true, secretId };
  }

  async probe(secretId: string): Promise<{ readonly ok: boolean; readonly message: string }> {
    this.probes.push(secretId);
    return this.stored.has(secretId)
      ? { ok: true, message: "Verified" }
      : { ok: false, message: "Secret is not in the vault" };
  }

  async useLocalMock(name: string): Promise<{ readonly ok: true }> {
    this.mocks.push(name);
    return { ok: true };
  }
}

export class MemoryChatTranscript implements ChatTranscript {
  private readonly lines: string[] = [];

  append(text: string): void {
    this.lines.push(text);
  }

  messages(): readonly string[] {
    return this.lines;
  }
}

export class MemoryUserMessageStore implements UserMessageStore {
  private readonly stored: string[] = [];

  insert(text: string): void {
    this.stored.push(text);
  }

  rows(): readonly string[] {
    return this.stored;
  }

  byteLength(): number {
    return Buffer.byteLength(this.stored.join("\n"));
  }
}

export class MemoryDevtoolsLog implements DevtoolsLog {
  private readonly stored: string[] = [];

  log(entry: string): void {
    this.stored.push(entry);
  }

  entries(): readonly string[] {
    return this.stored;
  }
}

export class MemoryComposerBind implements ComposerQuestionBind {
  private current: string | null = null;
  private text = "";

  bind(questionId: string): void {
    this.current = questionId;
  }

  draft(): string {
    return this.text;
  }

  writeDraft(text: string): void {
    this.text = text;
  }

  target(): string | null {
    return this.current;
  }
}

/** Local stand-in for Task 116 `StaleReplyReconciler`. */
export class LocalStaleReplyReconciler implements StaleReplyReconciler {
  receive(card: StaleReplyInput, reply: { readonly optionsVersion: number }): StaleReplyResult {
    if (card.status === "retired" && card.retiredBy === "vscode") {
      return { outcome: "needs_choice", prompt: STALE_VS_CODE_PROMPT, choices: ["keep", "change"] };
    }
    if (card.status === "retired") {
      return {
        outcome: "needs_choice",
        prompt: "Already resolved — Keep or Change?",
        choices: ["keep", "change"],
      };
    }
    if (reply.optionsVersion !== card.optionsVersion) {
      return { outcome: "needs_choice", prompt: OPTIONS_CHANGED_PROMPT, choices: ["keep", "change"] };
    }
    return { outcome: "fresh" };
  }
}

export class MemoryHumanStepProbe implements HumanStepProbePort {
  script: HumanStepCheck | null = null;

  async checkAgain(stepId: string): Promise<HumanStepCheck> {
    if (this.script) return this.script;
    return {
      outcome: "fail",
      diagnosis: `Still missing ${stepId}`,
      badge: "Attested",
    };
  }
}

export class MemoryAccountConnections implements AccountConnectionPort {
  private readonly log: string[] = [];

  reauthenticate(provider: string): void {
    this.log.push(`reauthenticate:${provider}`);
  }

  switchConnection(provider: string): void {
    this.log.push(`switch:${provider}`);
  }

  calls(): readonly string[] {
    return this.log;
  }
}

export class MemoryApprovalDecisions implements ApprovalDecisionPort {
  private readonly log: { cardId: string; action: string }[] = [];

  decide(cardId: string, action: "approve" | "edit" | "decline"): void {
    this.log.push({ cardId, action });
  }

  decisions(): readonly { readonly cardId: string; readonly action: string }[] {
    return this.log;
  }
}

export class MemoryNativeNotifications implements NativeNotificationPort {
  private readonly items: NativeNotice[] = [];

  show(notice: NativeNotice): void {
    if (this.items.some((item) => item.cardId === notice.cardId)) return;
    this.items.push(notice);
  }

  notices(): readonly NativeNotice[] {
    return this.items;
  }
}
