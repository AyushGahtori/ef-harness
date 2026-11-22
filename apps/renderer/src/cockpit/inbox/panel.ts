import { runAxeCoreAudit, textContent } from "./a11y.js";
import { NotificationCadenceScheduler } from "./cadence.js";
import { applySubscribers, createInboxCard } from "./cards.js";
import { FocusModeAndInterruptionBudget } from "./focus.js";
import { interpretInboxKey, type KeyChord } from "./keyboard.js";
import {
  LocalStaleReplyReconciler,
  MemoryAccountConnections,
  MemoryApprovalDecisions,
  MemoryChatTranscript,
  MemoryComposerBind,
  MemoryDevtoolsLog,
  MemoryHumanStepProbe,
  MemoryNativeNotifications,
  MemorySecretIpc,
  MemoryUserMessageStore,
} from "./memory-ports.js";
import type {
  AccountConnectionPort,
  ApprovalDecisionPort,
  ChatTranscript,
  ComposerQuestionBind,
  DevtoolsLog,
  HumanStepProbePort,
  NativeNotificationPort,
  PreloadSecretIpc,
  StaleReplyReconciler,
  UserMessageStore,
} from "./ports.js";
import { SecretCardController } from "./secrets.js";
import { digestLabel, peekLabel, reviewGroupTitle } from "./text.js";
import {
  RETIRED_LABEL,
  ZEN_MESSAGE,
  type AxeReport,
  type CardDraft,
  type InboxCard,
  type VNode,
  type WindowPresence,
} from "./types.js";
import { renderCalmInbox, type InboxRenderModel } from "./view.js";

export interface CalmInboxPanelOptions {
  readonly ipc?: PreloadSecretIpc;
  readonly chat?: ChatTranscript;
  readonly userMessages?: UserMessageStore;
  readonly devtools?: DevtoolsLog;
  readonly composer?: ComposerQuestionBind;
  readonly reconciler?: StaleReplyReconciler;
  readonly probes?: HumanStepProbePort;
  readonly accounts?: AccountConnectionPort;
  readonly approvals?: ApprovalDecisionPort;
  readonly notifications?: NativeNotificationPort;
  readonly focus?: FocusModeAndInterruptionBudget;
  readonly projectId?: string;
}

export class CalmInboxPanel {
  readonly focus: FocusModeAndInterruptionBudget;
  readonly ipc: PreloadSecretIpc;
  readonly chat: ChatTranscript;
  readonly userMessages: UserMessageStore;
  readonly devtools: DevtoolsLog;
  readonly composer: ComposerQuestionBind;
  readonly probes: HumanStepProbePort;
  readonly accounts: AccountConnectionPort;
  readonly approvals: ApprovalDecisionPort;
  readonly notifications: NativeNotificationPort;

  scrollTop = 0;
  private readonly scheduler: NotificationCadenceScheduler;
  private readonly reconciler: StaleReplyReconciler;
  private readonly cards = new Map<string, InboxCard>();
  private readonly secretControllers = new Map<string, SecretCardController>();
  private readonly projectId: string;
  private historyCards: InboxCard[] = [];
  private appliedReleases = 0;
  private focusIndex = 0;
  private focusedId: string | null = null;
  private windowState: WindowPresence = "foreground";
  private digestOpen = false;

  constructor(options: CalmInboxPanelOptions = {}) {
    this.focus = options.focus ?? new FocusModeAndInterruptionBudget();
    this.ipc = options.ipc ?? new MemorySecretIpc();
    this.chat = options.chat ?? new MemoryChatTranscript();
    this.userMessages = options.userMessages ?? new MemoryUserMessageStore();
    this.devtools = options.devtools ?? new MemoryDevtoolsLog();
    this.composer = options.composer ?? new MemoryComposerBind();
    this.reconciler = options.reconciler ?? new LocalStaleReplyReconciler();
    this.probes = options.probes ?? new MemoryHumanStepProbe();
    this.accounts = options.accounts ?? new MemoryAccountConnections();
    this.approvals = options.approvals ?? new MemoryApprovalDecisions();
    this.notifications = options.notifications ?? new MemoryNativeNotifications();
    this.projectId = options.projectId ?? "local-project";
    this.scheduler = new NotificationCadenceScheduler({ policy: this.focus });
    this.scheduler.subscribe(() => this.onCadence());
  }

  enqueue(draft: CardDraft): InboxCard {
    if (draft.type === "review" && draft.groupKey !== undefined) {
      const existing = this.findGroup(draft.groupKey);
      if (existing && existing.payload.kind === "review") {
        existing.payload.items.push({
          id: draft.id,
          title: draft.reviewItemTitle ?? draft.title,
          summary: draft.reviewItemSummary ?? draft.title,
          disposition: "pending",
        });
        existing.title = reviewGroupTitle(existing.payload.items.length);
        existing.needsAction = true;
        return existing;
      }
    }
    const card = createInboxCard(draft, Date.now());
    if (draft.type === "review" && draft.groupKey !== undefined && card.payload.kind === "review") {
      card.id = `review:${draft.groupKey}`;
      card.elementKey = card.id;
      card.groupKey = draft.groupKey;
      const first = card.payload.items[0];
      if (first) first.id = draft.id;
      card.title = reviewGroupTitle(card.payload.items.length);
    }
    this.cards.set(card.id, card);
    if (card.payload.kind === "secret") {
      this.secretControllers.set(
        card.id,
        new SecretCardController(this.ipc, {
          projectId: this.projectId,
          envScope: card.payload.envScope,
          name: card.payload.secretName,
        }),
      );
    }
    this.scheduler.enqueue({
      id: card.id,
      priority: card.priority,
      condition: card.condition,
      subject: card.subject,
      createdAt: card.createdAt,
      subscribers: [...card.subscribers],
      onCriticalPath: card.onCriticalPath,
      blockedTaskCount: card.blockedTaskCount,
      lane: card.lane,
    });
    return card;
  }

  card(id: string): InboxCard | null {
    return this.find(id);
  }

  elementKey(id: string): string | null {
    return this.find(id)?.elementKey ?? null;
  }

  surfaced(): readonly InboxCard[] {
    return this.orderedSurfaced();
  }

  history(): readonly InboxCard[] {
    return this.historyCards;
  }

  unreadCount(): number {
    return this.actionable().length;
  }

  zenMessage(): string | null {
    return this.unreadCount() === 0 ? ZEN_MESSAGE : null;
  }

  peekText(): string | null {
    const count = this.digestCount();
    return count > 0 ? peekLabel(count) : null;
  }

  digestCount(): number {
    let count = 0;
    for (const card of this.cards.values()) {
      if (card.lane === "fyi" && card.status !== "retired") count += 1;
    }
    return count;
  }

  digestText(): string {
    return digestLabel(this.digestCount());
  }

  batchHeadline(): string | null {
    return this.scheduler.lastHeadline();
  }

  releases(): ReturnType<NotificationCadenceScheduler["releases"]> {
    return this.scheduler.releases();
  }

  queuedIds(): readonly string[] {
    return this.scheduler.queuedIds();
  }

  focusMode(): boolean {
    return this.focus.focusMode;
  }

  focusedCardId(): string | null {
    return this.focusedId;
  }

  snoozeControlVisible(): boolean {
    return this.scheduler.coalesced();
  }

  setWindow(state: WindowPresence): void {
    this.windowState = state;
  }

  windowPresence(): WindowPresence {
    return this.windowState;
  }

  setFocusMode(on: boolean): void {
    this.focus.setFocus(on);
    this.scheduler.refresh();
  }

  openManually(): void {
    this.scheduler.openManually();
  }

  snooze(): void {
    this.focus.snooze(Date.now());
    this.scheduler.refresh();
  }

  toggleDigest(): void {
    this.digestOpen = !this.digestOpen;
  }

  peekFyi(): void {
    this.digestOpen = true;
  }

  addSubscriber(id: string, taskId: string): void {
    const card = this.cards.get(id);
    if (!card || card.subscribers.includes(taskId)) return;
    const scroll = this.scrollTop;
    applySubscribers(card, [...card.subscribers, taskId]);
    this.scheduler.update(id, {
      subscribers: [...card.subscribers],
      blockedTaskCount: card.blockedTaskCount,
    });
    this.scrollTop = scroll;
  }

  setCriticalPath(id: string, onCriticalPath: boolean): void {
    const card = this.cards.get(id);
    if (!card) return;
    card.onCriticalPath = onCriticalPath;
    this.scheduler.update(id, { onCriticalPath });
  }

  retire(id: string, source: "vscode" | "feature_undo"): void {
    const card = this.cards.get(id);
    if (!card) return;
    card.retiredBy = source;
    this.finish(card);
  }

  activateOption(id: string, number: number): void {
    const card = this.find(id);
    if (!card) return;
    const option = card.options.find((item) => item.number === number);
    if (!option) return;
    this.sendReply(card, card.optionsVersion, option.id);
  }

  replyWithVersion(id: string, optionsVersion: number, number: number): void {
    const card = this.find(id);
    if (!card) return;
    const option = card.options.find((item) => item.number === number);
    if (!option) return;
    this.sendReply(card, optionsVersion, option.id);
  }

  chooseStale(id: string, choice: "keep" | "change"): void {
    const card = this.find(id);
    if (!card) return;
    if (choice === "keep") {
      card.inlinePrompt = null;
      card.pendingOptionId = null;
      return;
    }
    if (card.pendingOptionId !== null) this.applyOption(card, card.pendingOptionId);
  }

  replaceOptions(
    id: string,
    options: readonly { readonly id: string; readonly label: string; readonly recommended?: boolean }[],
  ): void {
    const card = this.cards.get(id);
    if (!card) return;
    card.optionsVersion += 1;
    const marked = options.some((option) => option.recommended === true);
    card.options = options.map((option, index) => ({
      number: index + 1,
      id: option.id,
      label: option.label,
      recommended: marked ? option.recommended === true : index === 0,
    }));
  }

  replyInComposer(id: string): void {
    const card = this.find(id);
    if (!card || card.payload.kind !== "decision") return;
    this.composer.bind(card.payload.questionId);
  }

  handleKey(chord: KeyChord): void {
    if (this.focus.applyShortcut(chord)) {
      this.scheduler.refresh();
      return;
    }
    const command = interpretInboxKey(chord);
    if (!command) return;
    if (command.type === "next") this.move(1);
    else if (command.type === "previous") this.move(-1);
    else if (command.type === "select-option") this.highlightOption(command.number);
    else this.submitFocused();
  }

  typeSecret(id: string, value: string): void {
    const card = this.cards.get(id);
    const controller = this.secretControllers.get(id);
    if (!card || !controller || card.payload.kind !== "secret") return;
    controller.type(value);
    card.payload.inputLength = controller.reactState().length;
    card.payload.refusalMessage = null;
  }

  async saveSecret(id: string): Promise<void> {
    const card = this.cards.get(id);
    const controller = this.secretControllers.get(id);
    if (!card || !controller || card.payload.kind !== "secret") return;
    await controller.save();
    this.copySecret(card, controller);
  }

  async useMock(id: string): Promise<void> {
    const card = this.cards.get(id);
    const controller = this.secretControllers.get(id);
    if (!card || !controller || card.payload.kind !== "secret") return;
    await controller.useMock();
    this.copySecret(card, controller);
  }

  async testConnection(id: string): Promise<void> {
    const card = this.cards.get(id);
    const controller = this.secretControllers.get(id);
    if (!card || !controller || card.payload.kind !== "secret") return;
    await controller.testConnection();
    this.copySecret(card, controller);
  }

  secretController(id: string): SecretCardController | null {
    return this.secretControllers.get(id) ?? null;
  }

  async checkAgain(id: string): Promise<void> {
    const card = this.cards.get(id);
    if (!card || card.payload.kind !== "tool") return;
    const result = await this.probes.checkAgain(card.payload.stepId);
    card.payload.diagnosis = result.diagnosis;
    card.payload.badge = result.badge;
  }

  attest(id: string): void {
    const card = this.cards.get(id);
    if (!card || card.payload.kind !== "tool") return;
    card.payload.badge = "Attested";
  }

  reauthenticate(id: string): void {
    const card = this.cards.get(id);
    if (!card || card.payload.kind !== "account") return;
    this.accounts.reauthenticate(card.payload.provider);
  }

  switchConnection(id: string): void {
    const card = this.cards.get(id);
    if (!card || card.payload.kind !== "account") return;
    this.accounts.switchConnection(card.payload.provider);
  }

  decide(id: string, action: "approve" | "edit" | "decline"): void {
    const card = this.cards.get(id);
    if (!card || card.payload.kind !== "approval") return;
    card.payload.decision = action === "approve" ? "approved" : action === "decline" ? "declined" : "editing";
    card.needsAction = action === "edit";
    this.approvals.decide(id, action);
  }

  approveAll(id: string): void {
    const card = this.find(id);
    if (!card || card.payload.kind !== "review") return;
    for (const item of card.payload.items) item.disposition = "approved";
    this.refreshReviewNeed(card);
  }

  editReviewItem(cardId: string, itemId: string): void {
    this.setReviewItem(cardId, itemId, "editing");
  }

  rejectReviewItem(cardId: string, itemId: string): void {
    this.setReviewItem(cardId, itemId, "rejected");
  }

  toggleReview(id: string): void {
    const card = this.find(id);
    if (!card || card.payload.kind !== "review") return;
    card.payload.expanded = !card.payload.expanded;
  }

  clickNotification(id: string): void {
    const notice = this.notifications.notices().find((item) => item.id === id);
    if (!notice) return;
    this.windowState = "foreground";
    this.focusedId = notice.cardId;
  }

  userMessageBytes(): number {
    return this.userMessages.byteLength();
  }

  leakText(): string {
    return [
      ...this.chat.messages(),
      ...this.userMessages.rows(),
      ...this.devtools.entries(),
      this.composer.draft(),
      textContent(this.render()),
      JSON.stringify(this.render()),
    ].join("\n");
  }

  render(): VNode {
    const digest = [...this.cards.values()].filter((card) => card.lane === "fyi");
    const model: InboxRenderModel = {
      surfaced: this.orderedSurfaced(),
      history: this.historyCards,
      digest,
      digestOpen: this.digestOpen,
      headline: this.batchHeadline(),
      zen: this.zenMessage(),
      peek: this.zenMessage() !== null ? this.peekText() : null,
      snoozeVisible: this.snoozeControlVisible(),
      focusMode: this.focusMode(),
      unread: this.unreadCount(),
      focusedId: this.focusedId,
      digestText: this.digestText(),
    };
    return renderCalmInbox(model);
  }

  audit(): AxeReport {
    return runAxeCoreAudit(this.render());
  }

  private onCadence(): void {
    const releases = this.scheduler.releases();
    for (let index = this.appliedReleases; index < releases.length; index += 1) {
      const release = releases[index];
      if (!release) continue;
      for (const id of release.cardIds) {
        const card = this.cards.get(id);
        if (!card) continue;
        card.status = "surfaced";
        if (release.reason === "interrupt") this.maybeToast(card);
      }
    }
    this.appliedReleases = releases.length;
    this.syncFocus();
  }

  private maybeToast(card: InboxCard): void {
    if (this.windowState === "foreground") return;
    if (!this.focus.allowOsToast()) return;
    if (card.lane !== "interrupt_now") return;
    const body =
      card.payload.kind === "account"
        ? card.payload.toastBody
        : `EF Harness needs you: ${card.title}`;
    this.notifications.show({ id: `toast:${card.id}`, body, cardId: card.id });
  }

  private sendReply(card: InboxCard, optionsVersion: number, optionId: string): void {
    const result = this.reconciler.receive(
      {
        status: card.status === "retired" ? "retired" : "open",
        retiredBy: card.retiredBy,
        optionsVersion: card.optionsVersion,
      },
      { optionsVersion, optionId },
    );
    if (result.outcome === "needs_choice") {
      card.inlinePrompt = result.prompt;
      card.pendingOptionId = optionId;
      return;
    }
    this.applyOption(card, optionId);
  }

  private applyOption(card: InboxCard, optionId: string): void {
    card.settledOptionId = optionId;
    card.inlinePrompt = null;
    card.pendingOptionId = null;
    if (card.payload.kind === "decision") card.payload.selectedOptionId = optionId;
    card.needsAction = false;
    if (card.status !== "retired") this.finish(card);
  }

  private finish(card: InboxCard): void {
    const scroll = this.scrollTop;
    card.status = "retired";
    card.motion = "retire-to-history";
    card.historyLabel = RETIRED_LABEL;
    card.needsAction = false;
    if (!this.historyCards.includes(card)) this.historyCards.push(card);
    this.cards.delete(card.id);
    this.scheduler.retire(card.id);
    this.scrollTop = scroll;
    this.syncFocus();
  }

  private highlightOption(number: number): void {
    const card = this.focused();
    if (!card || card.payload.kind !== "decision") return;
    const option = card.options.find((item) => item.number === number);
    if (!option) return;
    card.payload.selectedOptionId = option.id;
  }

  private submitFocused(): void {
    const card = this.focused();
    if (!card) return;
    if (card.payload.kind === "decision") {
      const payload = card.payload;
      const selected = card.options.find((item) => item.id === payload.selectedOptionId);
      const recommended = card.options.find((item) => item.recommended);
      const option = selected ?? recommended;
      if (!option) return;
      this.sendReply(card, card.optionsVersion, option.id);
      return;
    }
    if (card.payload.kind === "approval") this.decide(card.id, "approve");
    if (card.payload.kind === "secret") void this.saveSecret(card.id);
  }

  private move(delta: number): void {
    const cards = this.actionable();
    if (cards.length === 0) return;
    const next = Math.min(cards.length - 1, Math.max(0, this.focusIndex + delta));
    this.focusIndex = next;
    this.focusedId = cards[next]?.id ?? null;
  }

  private syncFocus(): void {
    const cards = this.actionable();
    if (cards.length === 0) {
      this.focusedId = null;
      this.focusIndex = 0;
      return;
    }
    const current = this.focusedId === null ? -1 : cards.findIndex((card) => card.id === this.focusedId);
    if (current === -1) {
      this.focusIndex = 0;
      this.focusedId = cards[0]?.id ?? null;
      return;
    }
    this.focusIndex = current;
  }

  private actionable(): InboxCard[] {
    return this.orderedSurfaced().filter((card) => card.needsAction && card.lane !== "fyi");
  }

  private orderedSurfaced(): InboxCard[] {
    return [...this.cards.values()]
      .filter((card) => card.status === "surfaced")
      .sort((left, right) => {
        if (left.onCriticalPath !== right.onCriticalPath) return left.onCriticalPath ? -1 : 1;
        if (left.blockedTaskCount !== right.blockedTaskCount) {
          return right.blockedTaskCount - left.blockedTaskCount;
        }
        if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
        return 0;
      });
  }

  private find(id: string): InboxCard | null {
    return this.cards.get(id) ?? this.historyCards.find((card) => card.id === id) ?? null;
  }

  private findGroup(groupKey: string): InboxCard | null {
    for (const card of this.cards.values()) {
      if (card.type === "review" && card.groupKey === groupKey) return card;
    }
    return this.historyCards.find((card) => card.type === "review" && card.groupKey === groupKey) ?? null;
  }

  private focused(): InboxCard | null {
    if (this.focusedId === null) return null;
    return this.cards.get(this.focusedId) ?? null;
  }

  private copySecret(card: InboxCard, controller: SecretCardController): void {
    if (card.payload.kind !== "secret") return;
    card.payload.refusalMessage = controller.refusalMessage;
    card.payload.saved = controller.saved;
    card.payload.secretId = controller.secretId;
    card.payload.inputLength = controller.reactState().length;
    card.payload.probeStatus = controller.probeStatus;
  }

  private setReviewItem(
    cardId: string,
    itemId: string,
    disposition: "editing" | "rejected",
  ): void {
    const card = this.find(cardId);
    if (!card || card.payload.kind !== "review") return;
    const item = card.payload.items.find((entry) => entry.id === itemId);
    if (!item) return;
    item.disposition = disposition;
    this.refreshReviewNeed(card);
  }

  private refreshReviewNeed(card: InboxCard): void {
    if (card.payload.kind !== "review") return;
    card.needsAction = card.payload.items.some(
      (item) => item.disposition === "pending" || item.disposition === "editing",
    );
  }
}

export function createLeftRailInboxMount(panel: CalmInboxPanel): {
  readonly ownerTask: "Task 127";
  render(): VNode;
} {
  return {
    ownerTask: "Task 127",
    render: () => panel.render(),
  };
}
