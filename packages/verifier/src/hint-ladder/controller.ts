import { isRecord } from "./canonical-json.js";
import { DisputeCounterexampleError, DisputeReferenceError, HintLadderError } from "./errors.js";
import { appendOutboxEvent, HINT_LADDER_EVENT_CONSUMERS, HINT_LADDER_EVENTS } from "./events.js";
import { localComputeFailureFingerprint } from "./fingerprint.js";
import { nextModelLevel, normalizeFailureType, parseModelLevel } from "./normalize.js";
import { detectCrossWorkerPattern } from "./pattern.js";
import { drawFreshExample } from "./pool.js";
import { localPropertyExample } from "./property-example.js";
import { loadCanonicalQueries, type NamedQueries } from "./queries.js";
import { immediateTransaction, type StateDbPort } from "./sql.js";
import { HintLadderStore, type TaskTransition } from "./store.js";
import {
  EXHAUSTED_DECISION_OPTIONS,
  type BriefDefectEvidence,
  type CandidateExampleRunner,
  type CrossWorkerMatch,
  type DisputeVerdictInput,
  type DisputeVerdictResult,
  type EscalationDecision,
  type FailureFingerprintPort,
  type FailureType,
  type HiddenCheckFailure,
  type HiddenExample,
  type HintFeedbackPayload,
  type LadderHistoryEntry,
  type PropertyExampleGenerator,
  type StaticAuditLadderResult,
  type StaticAuditOutcome,
  type StepOneHint,
  type TaskRuntimeRow,
  type TestDisputeInput,
  type TestDisputeRecord,
} from "./types.js";

export interface HintLadderControllerOptions {
  readonly db: StateDbPort;
  readonly runner: CandidateExampleRunner;
  readonly now?: () => number;
  readonly queries?: NamedQueries;
  readonly fingerprint?: FailureFingerprintPort;
  readonly generator?: PropertyExampleGenerator;
  readonly consumers?: readonly string[];
}

export class HintLadderController {
  private readonly store: HintLadderStore;
  private readonly db: StateDbPort;
  private readonly queries: NamedQueries;
  private readonly now: () => number;
  private readonly fingerprint: FailureFingerprintPort;
  private readonly generator: PropertyExampleGenerator;
  private readonly runner: CandidateExampleRunner;
  private readonly consumers: readonly string[];
  private eventCount = 0;

  constructor(options: HintLadderControllerOptions) {
    this.db = options.db;
    this.queries = options.queries ?? loadCanonicalQueries();
    this.store = new HintLadderStore(this.db, this.queries);
    this.now = options.now ?? (() => Date.now());
    this.fingerprint = options.fingerprint ?? localComputeFailureFingerprint;
    this.generator = options.generator ?? { synthesize: localPropertyExample };
    this.runner = options.runner;
    this.consumers = options.consumers ?? HINT_LADDER_EVENT_CONSUMERS;
    if (this.consumers.length === 0) {
      throw new HintLadderError("hint ladder events require at least one outbox consumer");
    }
  }

  processHiddenFailure(input: HiddenCheckFailure): HintFeedbackPayload {
    const attribution = input.attribution ?? "implementation";
    if (attribution === "contract_mismatch") {
      const message = input.visibleMessage?.trim() ?? "";
      if (message.length === 0) {
        throw new HintLadderError("contract mismatch requires visible contract feedback");
      }
      const task = this.store.requireTask(input.taskId);
      return {
        kind: "contract_mismatch",
        recordedHiddenFailure: false,
        taskState: task.state,
        hint: { message },
      };
    }
    if (attribution !== "implementation") {
      const task = this.store.requireTask(input.taskId);
      const message =
        input.visibleMessage?.trim() ||
        `${attribution} failure does not advance the hidden-check ladder`;
      return {
        kind: "non_ladder",
        attribution,
        recordedHiddenFailure: false,
        taskState: task.state,
        hint: { message },
      };
    }
    const failureType = normalizeFailureType(input.failureType);
    const workerLevel = parseModelLevel(input.workerLevel);
    requireText(input.taskId, "taskId");
    requireText(input.attemptId, "attemptId");
    requireText(input.model, "model");
    requireText(input.ruleId, "ruleId");
    requireText(input.ruleText, "ruleText");
    requireText(input.checkId, "checkId");
    requireBrief(input.briefVersion);
    const explicit = input.fingerprint?.trim();
    const fingerprint =
      explicit && explicit.length > 0
        ? explicit
        : this.fingerprint({
            failureClass: failureType,
            ruleOrCheckId: input.ruleId,
            filePath: input.filePath ?? "",
            detail: input.detail ?? "",
          });
    const at = this.now();
    return immediateTransaction(this.db, () => {
      const task = this.store.requireTask(input.taskId);
      const previous = this.store.readVerification(input.taskId);
      const sqlStep = this.store.recordHiddenFailure({
        taskId: input.taskId,
        briefVersion: input.briefVersion,
        fingerprint,
        now: at,
      });
      if (previous && previous.briefVersion !== input.briefVersion) {
        this.store.setDisclosed(input.taskId, [], at);
      }
      const recorded = asLadderStep(sqlStep);
      const history = this.store.readHistory(input.taskId);
      const partial = historyEntry({
        taskId: input.taskId,
        attemptId: input.attemptId,
        model: input.model,
        level: workerLevel,
        ruleId: input.ruleId,
        checkId: input.checkId,
        failureType,
        fingerprint,
        ladderStep: recorded,
        briefVersion: input.briefVersion,
        at,
      });
      const cross = detectCrossWorkerPattern({
        history,
        current: partial,
        ruleId: input.ruleId,
        fingerprint,
        briefVersion: input.briefVersion,
      });
      const step: 1 | 2 | 3 = cross && recorded !== 3 ? 3 : recorded;
      if (step !== recorded) this.store.setLadderStep(input.taskId, step, at);
      const current = historyEntry({ ...partial, ladderStep: step });
      const hint = ruleHint(input.ruleId, input.ruleText, failureType);
      if (step === 3 || cross) {
        return this.finishStepThree({
          task,
          hint,
          current,
          history,
          at,
          cross,
          evidence: input.evidence,
        });
      }
      if (step === 1) {
        const taskState = this.resumeCoding(task);
        this.emitAdvanced(current);
        return {
          kind: "step_1",
          ladderStep: 1,
          recordedHiddenFailure: true,
          taskState,
          hint,
        };
      }
      return this.finishStepTwo({
        task,
        hint,
        current,
        at,
        failedCheckId: input.checkId,
        pool: input.pool,
        fingerprint,
      });
    });
  }

  processStaticFailure(input: StaticAuditOutcome): StaticAuditLadderResult {
    requireText(input.taskId, "taskId");
    requireText(input.fingerprint, "fingerprint");
    requireBrief(input.briefVersion);
    const at = this.now();
    return immediateTransaction(this.db, () => {
      const task = this.store.requireTask(input.taskId);
      const previous = this.store.readVerification(input.taskId);
      if (input.outcome === "pass") {
        if (previous) {
          this.store.writeStaticCount({
            taskId: input.taskId,
            briefVersion: previous.briefVersion,
            staticFailures: 0,
            now: at,
          });
          this.store.deleteStaticFingerprint(input.taskId);
        }
        return {
          recordedHiddenFailure: false,
          ladderStep: previous?.ladderStep ?? 0,
          staticFailures: 0,
          taskState: task.state,
          escalated: false,
          escalation: null,
        };
      }
      const stored = this.store.readStaticFingerprint(input.taskId);
      const previousCount = previous?.staticFailures ?? 0;
      const staticFailures = stored === input.fingerprint && previousCount > 0 ? previousCount + 1 : 1;
      this.store.writeStaticCount({
        taskId: input.taskId,
        briefVersion: previous?.briefVersion ?? input.briefVersion,
        staticFailures,
        now: at,
      });
      this.store.writeStaticFingerprint(input.taskId, input.fingerprint);
      const ladderStep = this.store.readVerification(input.taskId)?.ladderStep ?? 0;
      if (staticFailures >= 3) {
        const decision = this.decideEscalation({
          task,
          forceAuthor: false,
          source: "static_audit",
          reason: "Three identical static audit failures.",
          authorMessage: null,
        });
        this.applyEscalation(task, decision, at);
        this.emitEscalated(input.taskId, at, {
          source: "static_audit",
          fingerprint: input.fingerprint,
          staticFailures,
          ladderStep,
          escalation: decision,
        });
        return {
          recordedHiddenFailure: false,
          ladderStep,
          staticFailures,
          taskState: decision.state,
          escalated: true,
          escalation: decision,
        };
      }
      return {
        recordedHiddenFailure: false,
        ladderStep,
        staticFailures,
        taskState: this.resumeCoding(task),
        escalated: false,
        escalation: null,
      };
    });
  }

  resetOnBriefChange(taskId: string, briefVersion: number): void {
    requireText(taskId, "taskId");
    requireBrief(briefVersion);
    const at = this.now();
    immediateTransaction(this.db, () => {
      this.store.requireTask(taskId);
      this.store.resetForBrief(taskId, briefVersion, at);
    });
  }

  handleTestDispute(input: TestDisputeInput): TestDisputeRecord {
    requireText(input.taskId, "taskId");
    requireText(input.attemptId, "attemptId");
    requireText(input.referenceId, "referenceId");
    assertConcreteCounterexample(input.counterexample);
    const at = this.now();
    return immediateTransaction(this.db, () => {
      const task = this.store.requireTask(input.taskId);
      const attempt = this.store.requireAttempt(input.taskId, input.attemptId);
      const cited = this.resolveDisputeReference(input.referenceId);
      const record: TestDisputeRecord = {
        disputeId: this.nextId("dispute", input.taskId, at),
        taskId: input.taskId,
        attemptId: input.attemptId,
        citedRuleId: cited.ruleId,
        citedCheckId: cited.checkId,
        counterexample: input.counterexample,
        ruleText: cited.ruleText,
        status: "open",
        authorQuote: null,
        pausedAttemptState: attempt.state,
        penalized: false,
        routedTo: "ask-owner-responder@1",
        createdAt: at,
        resolvedAt: null,
      };
      this.pauseForAuthor(task);
      this.store.insertInbox({
        id: record.disputeId,
        taskId: input.taskId,
        payload: record,
        now: at,
      });
      this.emit(HINT_LADDER_EVENTS.dispute, input.taskId, at, record);
      return record;
    });
  }

  applyDisputeVerdict(input: DisputeVerdictInput): DisputeVerdictResult {
    requireText(input.disputeId, "disputeId");
    const at = this.now();
    return immediateTransaction(this.db, () => {
      const open = this.store.readDispute(input.disputeId);
      const task = this.store.requireTask(open.taskId);
      if (input.verdict === "dispute_rejected") {
        const authorQuote = input.authorQuote.trim();
        if (authorQuote.length === 0) {
          throw new HintLadderError("dispute rejection requires the author's decision quote");
        }
        const record = closeDispute(open, "rejected", authorQuote, at);
        this.store.writeDispute(record);
        const taskState = this.resumeCoding(task);
        return {
          record,
          checkId: open.citedCheckId,
          checkVersion: open.citedCheckId ? (this.store.readNode(open.citedCheckId)?.version ?? null) : null,
          taskState,
          authorQuote,
        };
      }
      const checkId = open.citedCheckId ?? this.store.linkedCheckForRule(open.citedRuleId);
      if (!checkId) {
        throw new DisputeReferenceError(
          `dispute ${open.disputeId} has no check node to version for ${open.citedRuleId}`,
        );
      }
      const bumped = this.store.bumpCheckVersion({
        checkId,
        disputeId: open.disputeId,
        correctedExpectation: input.correctedExpectation,
        now: at,
      });
      this.store.resetAfterUpheldDispute(open.taskId, at);
      this.store.transition(task, {
        state: "CLEAN_VERIFY",
        level: task.level,
        clearHolder: false,
        submissionPending: 1,
        updatedRev: bumped.rev,
        mode: "direct",
      });
      const authorQuote = input.authorQuote?.trim() ?? "";
      const record = closeDispute(open, "upheld", authorQuote.length > 0 ? authorQuote : null, at);
      this.store.writeDispute(record);
      return {
        record,
        checkId: bumped.checkId,
        checkVersion: bumped.version,
        taskState: "CLEAN_VERIFY",
        authorQuote: record.authorQuote,
      };
    });
  }

  checkCrossWorkerPattern(input: {
    readonly taskId: string;
    readonly ruleId: string;
    readonly fingerprint: string;
    readonly briefVersion?: number;
  }): CrossWorkerMatch | null {
    const stored = this.store.readVerification(input.taskId);
    const briefVersion = input.briefVersion ?? stored?.briefVersion;
    if (briefVersion === undefined) return null;
    const history = this.store.readHistory(input.taskId);
    const matching = history.filter(
      (entry) =>
        entry.ruleId === input.ruleId &&
        entry.fingerprint === input.fingerprint &&
        entry.briefVersion === briefVersion,
    );
    const current = matching[matching.length - 1];
    if (!current) return null;
    return detectCrossWorkerPattern({
      history: matching.slice(0, -1),
      current,
      ruleId: input.ruleId,
      fingerprint: input.fingerprint,
      briefVersion,
    });
  }

  private finishStepTwo(input: {
    readonly task: TaskRuntimeRow;
    readonly hint: StepOneHint;
    readonly current: LadderHistoryEntry;
    readonly at: number;
    readonly failedCheckId: string;
    readonly pool: readonly HiddenExample[] | undefined;
    readonly fingerprint: string;
  }): HintFeedbackPayload {
    if (!input.pool || input.pool.length === 0) {
      throw new HintLadderError("step 2 requires the rule's hidden example pool");
    }
    const disclosed = this.store.readVerification(input.task.taskId)?.disclosedChecks ?? [];
    const draw = drawFreshExample({
      pool: input.pool,
      disclosedCheckIds: disclosed,
      failedCheckId: input.failedCheckId,
      synthesize: (sealedCheckIds) =>
        this.generator.synthesize({
          ruleId: input.hint.ruleId,
          ruleText: input.hint.ruleText,
          failedCheckId: input.failedCheckId,
          sealedCheckIds,
          seed: `${input.task.taskId}:${input.current.briefVersion}:${input.fingerprint}`,
        }),
    });
    const candidateActualOutput = this.runner.run({
      taskId: input.task.taskId,
      attemptId: input.current.attemptId,
      ruleId: input.hint.ruleId,
      checkId: draw.example.checkId,
      freshInput: draw.example.input,
      expectedOutput: draw.example.expectedOutput,
    });
    this.store.setDisclosed(input.task.taskId, [...disclosed, draw.example.checkId], input.at);
    const taskState = this.resumeCoding(input.task);
    this.emitAdvanced(input.current);
    this.emit(HINT_LADDER_EVENTS.disclosed, input.task.taskId, input.at, {
      taskId: input.task.taskId,
      ruleId: input.hint.ruleId,
      checkId: draw.example.checkId,
      freshInput: draw.example.input,
      expectedOutput: draw.example.expectedOutput,
      candidateActualOutput,
      synthesized: draw.synthesized,
      remainingSealedCount: draw.sealedCheckIds.length,
    });
    return {
      kind: "step_2",
      ladderStep: 2,
      recordedHiddenFailure: true,
      taskState,
      disclosedCheckId: draw.example.checkId,
      synthesized: draw.synthesized,
      hint: {
        ruleId: input.hint.ruleId,
        ruleText: input.hint.ruleText,
        failureType: input.hint.failureType,
        freshInput: draw.example.input,
        expectedOutput: draw.example.expectedOutput,
        candidateActualOutput,
      },
    };
  }

  private finishStepThree(input: {
    readonly task: TaskRuntimeRow;
    readonly hint: StepOneHint;
    readonly current: LadderHistoryEntry;
    readonly history: readonly LadderHistoryEntry[];
    readonly at: number;
    readonly cross: CrossWorkerMatch | null;
    readonly evidence: BriefDefectEvidence | undefined;
  }): HintFeedbackPayload {
    const next = nextModelLevel(input.task.level);
    let reason = next
      ? `Escalate from ${input.task.level} to ${next} after hidden-check ladder step 3.`
      : "Model level Manager cannot escalate higher.";
    let forceAuthor = false;
    if (input.cross) {
      reason = input.cross.message;
      forceAuthor = true;
    } else if (input.evidence) {
      reason =
        input.evidence === "defective_expectation"
          ? `Evidence indicates a defective expectation for ${input.hint.ruleId}.`
          : `Evidence indicates an unclear brief for ${input.hint.ruleId}.`;
      forceAuthor = true;
    }
    const decision = this.decideEscalation({
      task: input.task,
      forceAuthor,
      source: "hidden_check",
      reason,
      authorMessage: forceAuthor ? reason : null,
    });
    this.applyEscalation(input.task, decision, input.at);
    const history = [...input.history, input.current];
    this.emitAdvanced(input.current);
    this.emitEscalated(input.task.taskId, input.at, {
      source: "hidden_check",
      ruleId: input.hint.ruleId,
      checkId: input.current.checkId,
      fingerprint: input.current.fingerprint,
      ladderStep: 3,
      escalation: decision,
      history,
    });
    return {
      kind: "step_3",
      ladderStep: 3,
      recordedHiddenFailure: true,
      taskState: decision.state,
      hint: input.hint,
      escalation: decision,
      history,
    };
  }

  private decideEscalation(input: {
    readonly task: TaskRuntimeRow;
    readonly forceAuthor: boolean;
    readonly source: "hidden_check" | "static_audit";
    readonly reason: string;
    readonly authorMessage: string | null;
  }): EscalationDecision {
    const fromLevel = input.task.level;
    const toLevel = nextModelLevel(fromLevel);
    if (input.forceAuthor && toLevel) {
      return {
        route: "task_author",
        state: "ESCALATED",
        fromLevel,
        toLevel: null,
        reason: input.reason,
        authorMessage: input.authorMessage ?? input.reason,
        decisionCard: null,
        routedTo: "ask-owner-responder@1",
        source: input.source,
      };
    }
    if (!toLevel) {
      return {
        route: "exhausted",
        state: "EXHAUSTED",
        fromLevel,
        toLevel: null,
        reason: input.reason,
        authorMessage: input.authorMessage ?? input.reason,
        decisionCard: { options: EXHAUSTED_DECISION_OPTIONS },
        routedTo: "ask-owner-responder@1",
        source: input.source,
      };
    }
    return {
      route: "model_level",
      state: "ESCALATED",
      fromLevel,
      toLevel,
      reason: input.reason,
      authorMessage: null,
      decisionCard: null,
      routedTo: null,
      source: input.source,
    };
  }

  private applyEscalation(task: TaskRuntimeRow, decision: EscalationDecision, at: number): void {
    this.store.transition(task, directTransition(task, {
      state: decision.state,
      level: decision.toLevel ?? task.level,
      clearHolder: true,
      submissionPending: 0,
      mode: "finish_if_pending",
    }));
    if (!decision.routedTo) return;
    this.store.insertInbox({
      id: this.nextId("review", task.taskId, at),
      taskId: task.taskId,
      now: at,
      payload: {
        routedTo: decision.routedTo,
        route: decision.route,
        reason: decision.reason,
        authorMessage: decision.authorMessage,
        decisionCard: decision.decisionCard,
        source: decision.source,
      },
    });
  }

  private resumeCoding(task: TaskRuntimeRow): string {
    const state = task.holderAttempt === null ? "READY" : "CODING";
    this.store.transition(
      task,
      directTransition(task, {
        state,
        level: task.level,
        clearHolder: false,
        submissionPending: 0,
        mode: "finish_if_pending",
      }),
    );
    return state;
  }

  private pauseForAuthor(task: TaskRuntimeRow): void {
    this.store.transition(task, {
      state: "WAITING_INPUT",
      level: task.level,
      clearHolder: false,
      submissionPending: task.submissionPending,
      updatedRev: task.updatedRev,
      mode: "direct",
    });
  }

  private resolveDisputeReference(referenceId: string): {
    ruleId: string;
    ruleText: string;
    checkId: string | null;
  } {
    const node = this.store.readNode(referenceId);
    if (!node) throw new DisputeReferenceError(`unknown dispute reference ${referenceId}`);
    if (node.kind === "rule") {
      if (node.text.trim().length === 0) {
        throw new DisputeReferenceError(`rule ${referenceId} has no disclosed text`);
      }
      return { ruleId: node.id, ruleText: node.text, checkId: null };
    }
    if (node.kind === "check") {
      const rule = this.store.ruleForCheck(node.id);
      if (!rule || rule.text.trim().length === 0) {
        throw new DisputeReferenceError(`check ${referenceId} is not linked to a disclosed rule`);
      }
      return { ruleId: rule.id, ruleText: rule.text, checkId: node.id };
    }
    throw new DisputeReferenceError(`dispute reference ${referenceId} is not a check or a rule`);
  }

  private emitAdvanced(entry: LadderHistoryEntry): void {
    this.emit(HINT_LADDER_EVENTS.advanced, entry.taskId, entry.at, entry);
  }

  private emitEscalated(taskId: string, at: number, payload: unknown): void {
    this.emit(HINT_LADDER_EVENTS.escalated, taskId, at, payload);
  }

  private emit(type: string, taskId: string, at: number, payload: unknown): void {
    const task = this.store.requireTask(taskId);
    appendOutboxEvent(this.db, this.queries, {
      id: this.nextId(type, taskId, at),
      type,
      subject: taskId,
      rev: task.updatedRev,
      payload,
      createdAt: at,
      consumers: this.consumers,
    });
  }

  private nextId(prefix: string, taskId: string, at: number): string {
    this.eventCount += 1;
    return `${prefix}:${taskId}:${at}:${this.eventCount}`;
  }
}

function directTransition(
  task: TaskRuntimeRow,
  input: Omit<TaskTransition, "updatedRev">,
): TaskTransition {
  return { ...input, updatedRev: task.updatedRev };
}

function historyEntry(entry: LadderHistoryEntry): LadderHistoryEntry {
  return {
    taskId: entry.taskId,
    attemptId: entry.attemptId,
    model: entry.model,
    level: entry.level,
    ruleId: entry.ruleId,
    checkId: entry.checkId,
    failureType: entry.failureType,
    fingerprint: entry.fingerprint,
    ladderStep: entry.ladderStep,
    briefVersion: entry.briefVersion,
    at: entry.at,
  };
}

function ruleHint(ruleId: string, ruleText: string, failureType: FailureType): StepOneHint {
  return { ruleId, ruleText, failureType };
}

function asLadderStep(step: number): 1 | 2 | 3 {
  if (step === 1 || step === 2 || step === 3) return step;
  throw new HintLadderError(`unexpected ladder step ${step}`);
}

function closeDispute(
  open: TestDisputeRecord,
  status: "upheld" | "rejected",
  authorQuote: string | null,
  at: number,
): TestDisputeRecord {
  return {
    disputeId: open.disputeId,
    taskId: open.taskId,
    attemptId: open.attemptId,
    citedRuleId: open.citedRuleId,
    citedCheckId: open.citedCheckId,
    counterexample: open.counterexample,
    ruleText: open.ruleText,
    status,
    authorQuote,
    pausedAttemptState: open.pausedAttemptState,
    penalized: false,
    routedTo: "ask-owner-responder@1",
    createdAt: open.createdAt,
    resolvedAt: at,
  };
}

function assertConcreteCounterexample(value: unknown): void {
  if (typeof value === "string") {
    if (value.trim().length === 0) {
      throw new DisputeCounterexampleError("counterexample is empty");
    }
    return;
  }
  if (!isRecord(value)) {
    throw new DisputeCounterexampleError("counterexample must be a concrete example");
  }
  const note = value.note;
  const hasNote = typeof note === "string" && note.trim().length > 0;
  const hasExample = "input" in value || "expected" in value || "actual" in value;
  if (!hasNote && !hasExample) {
    throw new DisputeCounterexampleError("counterexample must cite an input, result, or note");
  }
}

function requireText(value: string, label: string): void {
  if (value.trim().length === 0) throw new HintLadderError(`${label} is required`);
}

function requireBrief(value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new HintLadderError("brief version must be a positive integer");
  }
}
