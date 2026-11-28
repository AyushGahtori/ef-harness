import type { ControlOutcome } from "./kernel-stop.js";
import type { ImmediateKernelStopController } from "./kernel-stop.js";
import type { NewFeatureDedupSpawner } from "./dedup-spawner.js";
import type {
  AskOwnerResponderEnginePort,
  ChangeClassifierPort,
  DebouncedRevisionPropagatorPort,
  OrderedMultiClauseExecutorPort,
  ReverseImpactWalkerPort,
  RevisionAutoStartPolicyPort,
  TaskHoldsManagerPort,
} from "./ports.js";
import type { SteeringRuntime } from "./runtime.js";
import {
  addedFeaturePill,
  MidBuildRouteReceipt,
  pauseFeaturePill,
  revivalPill,
  type RouteDispatchResult,
} from "./route-receipt.js";
import {
  QUERY_DEADLINE_MS,
  ReadOnlyViolationError,
  REQUIREMENT_CHANGE_REASON,
  RouteLatencyError,
  SteeringError,
  type ChangeClass,
  type ExecutionControlInput,
  type ExistingFeatureChangeInput,
  type NewFeatureAdditionInput,
  type ReadOnlyQueryInput,
  type ReceiptDetail,
  type RevisionCandidate,
  type RouteNumber,
  type RouteTrace,
  type SteeringClause,
  type WrongRouteChoice,
} from "./types.js";

export interface TelemetryEvent {
  readonly route: RouteNumber;
  readonly latencyMs: number;
  readonly msgSeq: string;
  readonly kind: string;
}

export class RouteTelemetry {
  private readonly rows: TelemetryEvent[] = [];
  private corrections = 0;

  record(event: TelemetryEvent): void {
    this.rows.push(event);
  }

  recordCorrection(fromRoute: RouteNumber, toRoute: RouteNumber, msgSeq: string): void {
    this.corrections += 1;
    this.rows.push({
      route: toRoute,
      latencyMs: 0,
      msgSeq,
      kind: `wrong-route:${fromRoute.toString()}->${toRoute.toString()}`,
    });
  }

  events(): readonly TelemetryEvent[] {
    return [...this.rows];
  }

  correctionRate(): number {
    const dispatches = this.rows.filter((row) => !row.kind.startsWith("wrong-route:")).length;
    if (dispatches === 0) return 0;
    return this.corrections / dispatches;
  }
}

interface StoredReceipt {
  readonly route: RouteNumber;
  readonly msgSeq: string;
  readonly text: string;
  readonly featureId: string | null;
}

const EMPTY_DETAIL: ReceiptDetail = {
  answer: null,
  citations: [],
  holdsAdded: [],
  warning: null,
  planDeltaPreview: false,
  autoStarted: false,
  undoable: false,
  featureId: null,
  featureTitle: null,
  revived: false,
  preservedAnswerIds: [],
  scheduledWave: null,
  llmCalls: 0,
  latencyMs: 0,
  stateFlipMs: null,
  control: null,
  workersStillRunning: 0,
  checkpointRefs: [],
  changeClass: null,
  revisionId: null,
  discoverySessionId: null,
  quarantined: false,
  originalText: null,
};

export class FourRouteSteeringDispatcher {
  readonly trace: RouteTrace = {
    askOwnerCalls: 0,
    classifierCalls: 0,
    walkerCalls: 0,
    propagatorCalls: 0,
    policyCalls: 0,
    discoveryCalls: 0,
    llmCalls: 0,
  };

  private receiptSeq = 0;
  private readonly receipts = new Map<string, StoredReceipt>();

  constructor(
    readonly runtime: SteeringRuntime,
    readonly stopController: ImmediateKernelStopController,
    readonly dedup: NewFeatureDedupSpawner,
    private readonly askOwner: AskOwnerResponderEnginePort,
    private readonly classifier: ChangeClassifierPort,
    private readonly walker: ReverseImpactWalkerPort,
    private readonly propagator: DebouncedRevisionPropagatorPort,
    private readonly policy: RevisionAutoStartPolicyPort,
    private readonly holds: TaskHoldsManagerPort,
    readonly telemetry: RouteTelemetry,
    private readonly clauses: OrderedMultiClauseExecutorPort,
  ) {}

  dispatchClauses(clauses: readonly SteeringClause[]): readonly RouteDispatchResult[] {
    return this.clauses.execute(clauses, (clause) => this.dispatchClause(clause));
  }

  dispatchReadOnlyQuery(input: ReadOnlyQueryInput): RouteDispatchResult {
    const before = this.runtime.fingerprint();
    const started = performance.now();
    this.trace.askOwnerCalls += 1;
    const answer = this.askOwner.answerQuestion(input.text);
    const latencyMs = performance.now() - started;
    if (this.runtime.fingerprint() !== before) throw new ReadOnlyViolationError();
    if (answer.llmCalls !== 0 || this.runtime.llmCalls !== 0) {
      throw new SteeringError("READ_ONLY_LLM", "read-only evidence answer must not be a model guess");
    }
    if (latencyMs >= QUERY_DEADLINE_MS) {
      throw new RouteLatencyError("QUERY_LATENCY", `read-only query took ${latencyMs.toString()} ms`);
    }
    return this.finish(1, input.msgSeq, "Answered from state.db · build continuing", input.text, {
      ...EMPTY_DETAIL,
      answer: answer.text,
      citations: answer.citations,
      llmCalls: 0,
      latencyMs,
      workersStillRunning: this.runningCount(),
      originalText: input.text,
    });
  }

  dispatchExistingFeatureChange(input: ExistingFeatureChangeInput): RouteDispatchResult {
    const stopped = this.ignoredAfterStop(2, input.msgSeq, input.edit.afterText);
    if (stopped) return stopped;
    const started = performance.now();
    this.trace.classifierCalls += 1;
    const classified = this.classifier.classify(input.edit);
    this.trace.walkerCalls += 1;
    const impact = this.walker.walkCombined([input.targetId]);
    const impacted = [...impact.affectedActiveTasks];
    this.trace.propagatorCalls += 1;
    const batch = this.propagator.apply({
      targetId: input.targetId,
      changeClass: classified.changeClass,
      impactedTaskIds: impacted,
      msgSeq: input.msgSeq,
    });
    const holdsAdded: string[] = [];
    for (const taskId of impacted) {
      this.holds.placeHold(taskId, REQUIREMENT_CHANGE_REASON, `msg:${input.msgSeq}`, input.nowMs ?? Date.now());
      holdsAdded.push(taskId);
      for (const worker of this.runtime.listWorkers()) {
        if (worker.taskId === taskId && worker.state === "running") this.runtime.markWorker(worker.id, "held");
      }
    }
    const candidate = this.candidate(batch.revisionId, classified.changeClass, impacted.length, input);
    this.trace.policyCalls += 1;
    const decision = this.policy.evaluate(candidate);
    const feature = this.runtime.features.get(input.targetId);
    const title = feature?.title ?? input.targetId;
    const latencyMs = performance.now() - started;
    const pill = decision.autoStart
      ? `Updated '${title}' · undoable`
      : `Paused at Plan Delta Preview for '${title}'`;
    return this.finish(2, input.msgSeq, pill, input.edit.afterText, {
      ...EMPTY_DETAIL,
      holdsAdded,
      planDeltaPreview: decision.openPlanPreview,
      autoStarted: decision.autoStart,
      undoable: decision.undoable,
      featureId: input.targetId,
      featureTitle: title,
      llmCalls: batch.llmCalls,
      latencyMs,
      workersStillRunning: this.runningCount(),
      changeClass: classified.changeClass,
      revisionId: batch.revisionId,
      warning: decision.autoStart ? null : decision.reasons.join("; "),
      originalText: input.edit.afterText,
    });
  }

  dispatchNewFeatureAddition(input: NewFeatureAdditionInput): RouteDispatchResult {
    const stopped = this.ignoredAfterStop(3, input.msgSeq, input.text);
    if (stopped) return stopped;
    const started = performance.now();
    const beforeDiscovery = this.trace.discoveryCalls;
    const plan = this.dedup.spawn(input);
    if (plan.session) this.trace.discoveryCalls = beforeDiscovery + 1;
    if (plan.scheduledWave !== null && input.completelyDisjoint === true) this.trace.policyCalls += 1;
    const prior = plan.revived ? this.runtime.features.get(plan.featureId)?.priorStatus : null;
    const pill = plan.warning
      ? plan.warning
      : plan.revived && (prior === "deferred" || prior === "undone")
        ? revivalPill(prior, plan.featureId)
        : plan.action === "reused_active"
          ? `Reusing active feature ${plan.featureId} — build continuing`
          : addedFeaturePill(plan.title);
    const latencyMs = performance.now() - started;
    return this.finish(3, input.msgSeq, pill, input.text, {
      ...EMPTY_DETAIL,
      warning: plan.warning,
      featureId: plan.action === "budget_blocked" ? null : plan.featureId,
      featureTitle: plan.title,
      revived: plan.revived,
      preservedAnswerIds: plan.preservedAnswerIds,
      scheduledWave: plan.scheduledWave,
      llmCalls: 0,
      latencyMs,
      workersStillRunning: this.runningCount(),
      discoverySessionId: plan.session?.sessionId ?? null,
      originalText: input.text,
    });
  }

  async dispatchExecutionControl(input: ExecutionControlInput): Promise<RouteDispatchResult> {
    const outcome = await this.stopController.execute(input);
    return this.finishControl(input, outcome);
  }

  overrideWrongRoute(choice: WrongRouteChoice): RouteDispatchResult {
    const original = this.receipts.get(choice.receiptId);
    if (!original) throw new SteeringError("UNKNOWN_RECEIPT", `no receipt ${choice.receiptId}`);
    if (original.route === 3 && original.featureId) this.runtime.archiveEmptyStub(original.featureId);
    this.telemetry.recordCorrection(original.route, choice.route, original.msgSeq);
    const target = this.runtime.features.get(choice.targetId);
    return this.dispatchExistingFeatureChange({
      msgSeq: original.msgSeq,
      targetId: choice.targetId,
      edit: {
        targetId: choice.targetId,
        beforeText: target?.scope ?? "",
        afterText: original.text,
      },
    });
  }

  private dispatchClause(clause: SteeringClause): RouteDispatchResult {
    if (clause.kind === "stop" || clause.kind === "control") {
      return this.finishControl({ msgSeq: clause.id, control: "stop_now" }, this.stopController.applyStop());
    }
    if (clause.kind === "answer" || clause.kind === "query") {
      return this.dispatchReadOnlyQuery({ msgSeq: clause.id, text: clause.text });
    }
    if (clause.kind === "edit") {
      const targetId = clause.targetId ?? "unknown";
      return this.dispatchExistingFeatureChange({
        msgSeq: clause.id,
        targetId,
        edit: { targetId, beforeText: "", afterText: clause.text },
      });
    }
    return this.dispatchNewFeatureAddition({ msgSeq: clause.id, text: clause.text });
  }

  private finishControl(input: ExecutionControlInput, outcome: ControlOutcome): RouteDispatchResult {
    const feature = input.featureId ? this.runtime.features.get(input.featureId) : undefined;
    const title = input.featureTitle ?? feature?.title ?? input.featureId ?? "feature";
    const pill = controlPill(input, outcome, title);
    const latencyMs = input.control === "stop_now" ? outcome.stateFlipMs : outcome.latencyMs;
    if (input.control === "stop_now" && outcome.stateFlipMs >= 100) {
      throw new RouteLatencyError("STOP_LATENCY", `STOP took ${outcome.stateFlipMs.toString()} ms`);
    }
    if (outcome.llmCalls !== 0) throw new SteeringError("CONTROL_LLM", "execution control called the model");
    return this.finish(4, input.msgSeq, pill, input.featureId ?? input.control, {
      ...EMPTY_DETAIL,
      holdsAdded: outcome.holdsAdded,
      featureId: input.featureId ?? null,
      featureTitle: input.featureId ? title : null,
      llmCalls: 0,
      latencyMs,
      stateFlipMs: outcome.stateFlipMs,
      control: outcome.control,
      workersStillRunning: outcome.workersStillRunning,
      checkpointRefs: outcome.checkpointRefs,
      quarantined: outcome.quarantined,
      originalText: input.control,
    });
  }

  private candidate(
    revisionId: string,
    changeClass: ChangeClass,
    deltaTasks: number,
    input: ExistingFeatureChangeInput,
  ): RevisionCandidate {
    return {
      revisionId,
      deltaTasks,
      deltaCostMicroUsd: input.edit.estimatedCostMicroUsd ?? 100_000n,
      deltaPlanWindowPpm: input.edit.estimatedWindowPpm ?? 1_000,
      breakingContract: changeClass === "breaking",
      destructiveMigration: input.edit.destructiveMigration === true,
      unresolvedMustAsk: input.edit.unresolvedMustAsk === true,
      unresolvedConflict: input.edit.unresolvedConflict === true,
      newPackages: input.edit.newPackages ?? [],
      externalEffects: input.edit.externalEffects ?? [],
      nowMs: input.nowMs ?? 0,
    };
  }

  private finish(
    route: RouteNumber,
    msgSeq: string,
    pill: string,
    text: string,
    detail: ReceiptDetail,
  ): RouteDispatchResult {
    this.receiptSeq += 1;
    const id = `receipt-${msgSeq}-${this.receiptSeq.toString()}`;
    this.telemetry.record({
      route,
      latencyMs: detail.latencyMs,
      msgSeq,
      kind: route === 4 && detail.control === "stop_now" ? "stop" : `route-${route.toString()}`,
    });
    const receipt = new MidBuildRouteReceipt(id, route, msgSeq, pill, detail, (choice) => this.overrideWrongRoute(choice));
    this.receipts.set(id, { route, msgSeq, text, featureId: detail.featureId });
    return { receipt, route, msgSeq };
  }

  private runningCount(): number {
    return this.runtime.listWorkers().filter((worker) => worker.state === "running").length;
  }

  private ignoredAfterStop(route: RouteNumber, msgSeq: string, text: string): RouteDispatchResult | null {
    if (this.runtime.controlState !== "STOPPED") return null;
    return this.finish(route, msgSeq, "Ignored after STOP · build is stopped", text, {
      ...EMPTY_DETAIL,
      originalText: text,
      workersStillRunning: this.runningCount(),
    });
  }
}

function controlPill(input: ExecutionControlInput, outcome: ControlOutcome, title: string): string {
  if (input.control === "pause_feature") {
    return pauseFeaturePill(title, outcome.holdsAdded.length, outcome.workersStillRunning);
  }
  if (input.control === "stop_now") return "Stopped · checkpoints saved · merge blocked";
  if (input.control === "pause_build") return "Paused build · finishing current steps";
  if (input.control === "resume") return "Resumed · held features stay paused until they are resumed";
  if (input.control === "cancel_task") return `Cancelled ${input.taskId ?? "task"}`;
  if (input.control === "retry_task") return `Retrying ${input.taskId ?? "task"} from its checkpoint`;
  if (input.control === "switch_preset") return `Switched preset to ${input.presetId ?? "standard"}`;
  return `Skipped optional ${input.taskId ?? "task"}`;
}
