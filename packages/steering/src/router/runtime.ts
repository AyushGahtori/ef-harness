import { DatabaseSync } from "node:sqlite";
import { LocalCandidateCatalog } from "./catalog.js";
import { plannedClause, wholeSpan } from "./clause.js";
import type { MessageRow, RouterStore } from "./database.js";
import { RouterStore as Store } from "./database.js";
import { DeterministicRouterModel, planMessage } from "./decompose.js";
import { RouterPromptBudgetError } from "./errors.js";
import { classifyFastPath } from "./fast-path.js";
import { LocalDualFtsSearch } from "./fts.js";
import { OrderedMultiClauseExecutor } from "./executor.js";
import { renderRouterPrompt } from "./prompt.js";
import {
  LocalOutboxPort,
  RecordingDispatch,
  RecordingHolds,
  RecordingKernel,
  type AmbiguityHoldPort,
  type BudgetReadPort,
  type ClauseDispatchPort,
  type KernelControlPort,
  type OutboxPort,
  type RouterModelPort,
} from "./ports.js";
import { foreignTargetIds, parseRouterV1 } from "./schema.js";
import { UnifiedMessageSequencer } from "./sequencer.js";
import { InputStartFocusSnapshotter } from "./focus.js";
import { RouterShortlistRetriever, type FtsSearchPort, type KnowledgeGraphPort } from "./shortlist.js";
import {
  ROUTER_PROMPT_TOKEN_BUDGET,
  isBlockedExit,
  isCheckpointStatus,
  type ClarificationCard,
  type InputStartFocus,
  type MessageReceipt,
  type PlannedClause,
  type RecentTurn,
  type SubmitMessageInput,
} from "./types.js";

export interface OpenRouterOptions {
  readonly stateDbPath?: string;
  readonly now?: () => number;
  readonly model?: RouterModelPort;
  readonly kernel?: KernelControlPort;
  readonly dispatch?: ClauseDispatchPort;
  readonly holds?: AmbiguityHoldPort;
  readonly budget?: BudgetReadPort | null;
  readonly outbox?: OutboxPort;
  readonly graph?: KnowledgeGraphPort;
  readonly search?: FtsSearchPort;
}

interface RouteMeta {
  readonly fastPath: boolean;
  readonly routerInvoked: boolean;
  readonly providerCalls: number;
  readonly fastPathMs: number | null;
}

/**
 * Sequences user messages, captures input-start focus, retrieves a bounded shortlist,
 * and executes router@1 clauses in safety order.
 */
export class SteeringMessageRouter {
  readonly snapshotter: InputStartFocusSnapshotter;
  readonly sequencer: UnifiedMessageSequencer;
  readonly retriever: RouterShortlistRetriever;
  readonly executor: OrderedMultiClauseExecutor;
  readonly catalog: LocalCandidateCatalog | null;
  private readonly store: RouterStore;
  private readonly model: RouterModelPort;
  private readonly now: () => number;
  private providerCalls = 0;
  private routerInvoked = false;

  constructor(options: OpenRouterOptions & {
    readonly store: RouterStore;
    readonly snapshotter: InputStartFocusSnapshotter;
    readonly sequencer: UnifiedMessageSequencer;
    readonly retriever: RouterShortlistRetriever;
    readonly executor: OrderedMultiClauseExecutor;
    readonly catalog: LocalCandidateCatalog | null;
    readonly model: RouterModelPort;
    readonly now: () => number;
  }) {
    this.store = options.store;
    this.snapshotter = options.snapshotter;
    this.sequencer = options.sequencer;
    this.retriever = options.retriever;
    this.executor = options.executor;
    this.catalog = options.catalog;
    this.model = options.model;
    this.now = options.now;
  }

  beginInput(input: { readonly draftId: string; readonly focus: InputStartFocus; readonly at?: number }) {
    return this.snapshotter.begin(input);
  }

  observeUi(input: { readonly draftId: string; readonly focus: InputStartFocus; readonly explicit: boolean }) {
    return this.snapshotter.observeUi(input);
  }

  accept(input: SubmitMessageInput): MessageRow {
    return this.sequencer.accept(this.toNewMessage(input));
  }

  submit(input: SubmitMessageInput): MessageReceipt {
    const row = this.accept(input);
    this.sequencer.drain((message) => this.route(message));
    return this.receipt(row.messageId);
  }

  resume(): MessageReceipt[] {
    const before = this.store.listMessages().filter((row) => !isCheckpointStatus(row.status));
    this.sequencer.drain((message) => this.route(message));
    return before.map((row) => this.receipt(row.messageId));
  }

  receipt(messageId: string): MessageReceipt {
    const row = this.must(messageId);
    return {
      messageId: row.messageId,
      msgSeq: row.msgSeq,
      origin: row.origin,
      text: row.text,
      status: row.status,
      fastPath: row.fastPath,
      routerInvoked: row.routerInvoked,
      providerCalls: row.providerCalls,
      fastPathMs: row.fastPathMs,
      inputStartedAt: row.inputStartedAt,
      focus: row.focus,
      clauses: this.store.listClauses(row.messageId),
      clarification: row.clarification,
    };
  }

  outboxEventIds(): string[] {
    return this.store.listOutboxIds();
  }

  close(): void {
    this.store.close();
  }

  private toNewMessage(input: SubmitMessageInput) {
    const binding = input.draftId ? this.snapshotter.bind(input.draftId) : null;
    return {
      messageId: input.messageId,
      origin: input.origin,
      text: input.text,
      draftId: input.draftId ?? null,
      inputStartedAt: binding?.capturedAt ?? null,
      focus: binding?.focus ?? null,
      receivedAt: input.receivedAt ?? this.now(),
      explicitAction: input.explicitAction ?? null,
      confirmationRequired: binding?.confirmationRequired ?? false,
    };
  }

  private route(seed: MessageRow): void {
    const current = this.must(seed.messageId);
    if (isCheckpointStatus(current.status)) return;
    this.providerCalls = 0;
    this.routerInvoked = false;
    if (this.store.listClauses(current.messageId).length > 0) {
      this.executor.execute(current);
      return;
    }
    this.store.transaction(() => {
      this.store.markRouting(current.messageId);
    });
    const fast = classifyFastPath({
      text: current.text,
      origin: current.origin,
      explicitAction: current.explicitAction,
      focus: current.focus,
      confirmationRequired: current.confirmationRequired,
    });
    if (fast.kind === "confirm_focus") {
      this.checkpoint(current, focusChangedCard(current), fast.classifyMs, false);
      return;
    }
    if (fast.kind === "clauses") {
      this.persistAndExecute(current.messageId, fast.clauses, {
        fastPath: true,
        routerInvoked: false,
        providerCalls: 0,
        fastPathMs: fast.classifyMs,
      });
      return;
    }
    const history = this.history(current.msgSeq);
    const shortlist = this.retriever.retrieve({
      text: current.text,
      focus: current.focus,
      recentTurns: history.recent,
    });
    const allowed = new Set(shortlist.cards.map((card) => card.id));
    this.providerCalls = 0;
    this.routerInvoked = false;
    const gate = this.gateModel(current.text, shortlist.cards, current.focus, history.previousTargets, allowed);
    if (gate.ok === false) {
      const card = modelFailureCard(current, gate.reason, gate.errors);
      this.checkpoint(current, card, null, true);
      return;
    }
    const planned = planMessage({
      text: current.text,
      cards: shortlist.cards,
      focus: current.focus,
      previousTargets: history.previousTargets,
    });
    this.persistAndExecute(current.messageId, planned, {
      fastPath: false,
      routerInvoked: this.routerInvoked,
      providerCalls: this.providerCalls,
      fastPathMs: null,
    });
  }

  private gateModel(
    text: string,
    cards: Parameters<typeof planMessage>[0]["cards"],
    focus: MessageRow["focus"],
    previousTargets: readonly string[],
    allowed: ReadonlySet<string>,
  ): { ok: true } | { ok: false; reason: "router_blocked" | "invalid_target"; errors: string[] } {
    const firstPrompt = this.prompt(text, cards, focus, previousTargets, null);
    const first = this.invoke(firstPrompt);
    const firstDecision = this.judge(first, text.length, allowed);
    if (firstDecision.ok) return { ok: true };
    if (firstDecision.reason === "router_blocked") {
      return { ok: false, reason: "router_blocked", errors: firstDecision.errors };
    }
    const repair = this.prompt(text, cards, focus, previousTargets, {
      attempt: 1,
      errors: firstDecision.errors,
    });
    const second = this.invoke(repair);
    const secondDecision = this.judge(second, text.length, allowed);
    if (secondDecision.ok) return { ok: true };
    return {
      ok: false,
      reason: secondDecision.reason === "router_blocked" ? "router_blocked" : "invalid_target",
      errors: secondDecision.errors,
    };
  }

  private prompt(
    text: string,
    cards: Parameters<typeof planMessage>[0]["cards"],
    focus: MessageRow["focus"],
    previousTargets: readonly string[],
    repair: { readonly attempt: 1; readonly errors: readonly string[] } | null,
  ) {
    const rendered = renderRouterPrompt({
      messageText: text,
      cards,
      focus,
      previousTargets,
      repair,
    });
    if (rendered.promptTokens >= ROUTER_PROMPT_TOKEN_BUDGET) {
      throw new RouterPromptBudgetError(rendered.promptTokens);
    }
    return rendered;
  }

  private invoke(prompt: ReturnType<typeof renderRouterPrompt>): unknown {
    this.routerInvoked = true;
    if (this.model.usesProvider) this.providerCalls += 1;
    return this.model.complete(prompt);
  }

  private judge(
    value: unknown,
    textLength: number,
    allowed: ReadonlySet<string>,
  ): { ok: true } | { ok: false; reason: "router_blocked" | "invalid_target"; errors: string[] } {
    const parsed = parseRouterV1(value, textLength);
    if (!parsed.ok) return { ok: false, reason: "invalid_target", errors: [...parsed.errors] };
    if (isBlockedExit(parsed.value)) {
      return { ok: false, reason: "router_blocked", errors: [parsed.value.reason] };
    }
    const foreign = foreignTargetIds(parsed.value, allowed);
    if (foreign.length > 0) {
      return {
        ok: false,
        reason: "invalid_target",
        errors: foreign.map((id) => `target ${id} is outside the shortlist`),
      };
    }
    return { ok: true };
  }

  private persistAndExecute(messageId: string, clauses: readonly PlannedClause[], meta: RouteMeta): void {
    this.store.transaction(() => {
      this.store.replaceClauses(messageId, clauses);
      this.store.recordRouteMeta(messageId, meta);
      this.store.markExecuting(messageId);
    });
    this.executor.execute(this.must(messageId));
  }

  private checkpoint(
    message: MessageRow,
    card: ClarificationCard,
    fastPathMs: number | null,
    routerInvoked: boolean,
  ): void {
    const span = wholeSpan(message.text);
    const clause = plannedClause({
      clauseText: message.text.trim() || message.text,
      span,
      intentType: "answer_question",
      routerIntent: "question",
      needsClarification: true,
      confidence: "ambiguous",
      routerConfidence: 0.2,
    });
    this.store.transaction(() => {
      const stored = this.store.replaceClauses(message.messageId, [clause]);
      const clauseId = stored[0]?.clauseId ?? `${message.messageId}#0`;
      this.store.updateClause(message.messageId, clauseId, "AWAITING_CLARIFICATION", card.prompt);
      this.store.recordRouteMeta(message.messageId, {
        fastPath: !routerInvoked,
        routerInvoked,
        providerCalls: this.providerCalls,
        fastPathMs,
      });
      this.store.markMessageDone(message.messageId, "AWAITING_CLARIFICATION", { ...card, clauseId });
    });
  }

  private history(beforeSeq: number): { recent: RecentTurn[]; previousTargets: string[] } {
    const done = this.store.listMessages().filter((row) => row.msgSeq < beforeSeq && isCheckpointStatus(row.status));
    const recent = done.slice(-3).map((row) => ({
      messageId: row.messageId,
      text: row.text,
      targetIds: this.store.listClauses(row.messageId).flatMap((clause) => [...clause.targetCandidateIds]),
    }));
    const last = done[done.length - 1];
    const previousTargets = last
      ? this.store.listClauses(last.messageId).flatMap((clause) =>
          clause.intentType === "edit_existing" ||
          clause.intentType === "add_new_feature" ||
          clause.intentType === "undo_feature"
            ? [...clause.targetCandidateIds]
            : [],
        )
      : [];
    return { recent, previousTargets };
  }

  private must(messageId: string): MessageRow {
    const row = this.store.getMessage(messageId);
    if (!row) throw new Error(`missing sequenced message ${messageId}`);
    return row;
  }
}

function focusChangedCard(message: MessageRow): ClarificationCard {
  const started = message.focus?.openQuestionCardId ?? "the draft focus";
  return {
    kind: "clarification",
    messageId: message.messageId,
    msgSeq: message.msgSeq,
    clauseId: `${message.messageId}#0`,
    reason: "focus_changed",
    prompt: `This draft started on ${started}. Focus changed before send. Confirm where the reply belongs.`,
    alternateReadings: [],
    pipeline: "router",
  };
}

function modelFailureCard(
  message: MessageRow,
  reason: "router_blocked" | "invalid_target",
  errors: readonly string[],
): ClarificationCard {
  return {
    kind: "clarification",
    messageId: message.messageId,
    msgSeq: message.msgSeq,
    clauseId: `${message.messageId}#0`,
    reason,
    prompt:
      reason === "invalid_target"
        ? `router@1 cited an id outside the shortlist (${errors.join("; ")}). Which target did you mean?`
        : `router@1 returned blocked: ${errors.join("; ")}`,
    alternateReadings: [],
    pipeline: "router",
  };
}

export function openSteeringRouter(options: OpenRouterOptions = {}): SteeringMessageRouter {
  const now = options.now ?? (() => Date.now());
  const database = new DatabaseSync(options.stateDbPath ?? ":memory:");
  const store = new Store(database);
  const fts = options.search ? null : new LocalDualFtsSearch(database);
  const catalog = options.graph || !fts ? null : new LocalCandidateCatalog(store, fts);
  const graph = options.graph ?? catalog;
  const search = options.search ?? fts;
  if (!graph || !search) {
    database.close();
    throw new Error("router requires a knowledge graph port and an FTS port");
  }
  const kernel = options.kernel ?? new RecordingKernel();
  const dispatch = options.dispatch ?? new RecordingDispatch(options.budget ?? null);
  const holds = options.holds ?? new RecordingHolds();
  const outbox = options.outbox ?? new LocalOutboxPort(store, now);
  const snapshotter = new InputStartFocusSnapshotter(store, now);
  const sequencer = new UnifiedMessageSequencer(store, outbox, now);
  const retriever = new RouterShortlistRetriever(graph, search);
  const executor = new OrderedMultiClauseExecutor(store, kernel, dispatch, holds, outbox, now);
  return new SteeringMessageRouter({
    ...options,
    store,
    snapshotter,
    sequencer,
    retriever,
    executor,
    catalog,
    model: options.model ?? new DeterministicRouterModel(),
    now,
  });
}
