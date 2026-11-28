import { AimdConcurrencyRegulator } from "./aimd-concurrency-regulator.js";
import { AutoResumeScheduler, type ResumePreflightPort } from "./auto-resume-scheduler.js";
import { BurnRateWindowTracker } from "./burn-rate-window-tracker.js";
import { CHECKPOINT_STOP_ACTIONS } from "./constants.js";
import { PacingError } from "./errors.js";
import { harnessCeilingPpm, percentToPpm, rateLimitLabel } from "./format.js";
import type { GlobalConnectionWindowRepo } from "./global-connection-window-repo.js";
import { isInteractiveRequest, InteractivePrioritySlot } from "./interactive-priority-slot.js";
import {
  type AllowanceWeightSink,
  type BoardHealthPort,
  type BudgetLedgerPort,
  type BudgetWindDownPort,
  type SignedPolicyPriorPort,
  type WindDownObservation,
} from "./local-ports.js";
import { ModelAllowanceWeightLearner } from "./model-allowance-weight-learner.js";
import { RateLimitVsUsageLimitClassifier } from "./rate-limit-vs-usage-limit-classifier.js";
import type {
  AppliedLimit,
  AutoResumeDecision,
  AutoResumeSnapshot,
  CheckpointStopCardRequest,
  ConnectionRegistration,
  ConnectionWindowRow,
  CopilotQuotaSnapshot,
  DiskHeadroomCard,
  DispatchRequest,
  ModelWeightView,
  OpenRouterCreditSnapshot,
  PacingState,
  PacingTelemetry,
  PersistedConnection,
  ProviderLimitSignal,
  QuotaSampleSource,
  SiwcRemainingHeaderSnapshot,
  SlotDecision,
  SlotKind,
  SubscriptionWeightFeed,
  TurnCompletion,
  UsageLimitReason,
  WindowKind,
  WindowSharePrediction,
  WindowUsage,
} from "./types.js";

export interface AllowancePacingControllerOptions {
  readonly projectId: string;
  readonly repo: GlobalConnectionWindowRepo;
  readonly windDown: BudgetWindDownPort;
  readonly board: BoardHealthPort;
  readonly ledger: BudgetLedgerPort;
  readonly preflight: ResumePreflightPort;
  readonly weightSink: AllowanceWeightSink;
  /** Task 135 local port. Absent on this base; registration `priors` still seed k[model]. */
  readonly policyPriors?: SignedPolicyPriorPort;
  readonly now: () => number;
  readonly random?: () => number;
  readonly classifier?: RateLimitVsUsageLimitClassifier;
}

type Effect =
  | { readonly kind: "countdown"; readonly countdown: string }
  | { readonly kind: "stop-card"; readonly card: CheckpointStopCardRequest }
  | { readonly kind: "wind-down"; readonly observation: WindDownObservation }
  | { readonly kind: "disk"; readonly card: DiskHeadroomCard }
  | { readonly kind: "weights"; readonly weights: readonly SubscriptionWeightFeed[] };

interface Runtime {
  readonly aimd: AimdConcurrencyRegulator;
  readonly burn: BurnRateWindowTracker;
  readonly slots: InteractivePrioritySlot;
  readonly learner: ModelAllowanceWeightLearner;
  readonly scheduler: AutoResumeScheduler;
}

/**
 * Global broker allowance pacing for one project endpoint.
 * Window rows, cwnd, and k[model] live in the shared connection record, not in project state.
 */
export class AllowancePacingController {
  private readonly projectId: string;
  private readonly repo: GlobalConnectionWindowRepo;
  private readonly windDown: BudgetWindDownPort;
  private readonly board: BoardHealthPort;
  private readonly ledger: BudgetLedgerPort;
  private readonly preflight: ResumePreflightPort;
  private readonly weightSink: AllowanceWeightSink;
  private readonly policyPriors: SignedPolicyPriorPort | null;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly classifier: RateLimitVsUsageLimitClassifier;

  constructor(options: AllowancePacingControllerOptions) {
    this.projectId = options.projectId;
    this.repo = options.repo;
    this.windDown = options.windDown;
    this.board = options.board;
    this.ledger = options.ledger;
    this.preflight = options.preflight;
    this.weightSink = options.weightSink;
    this.policyPriors = options.policyPriors ?? null;
    this.now = options.now;
    this.random = options.random ?? Math.random;
    this.classifier = options.classifier ?? new RateLimitVsUsageLimitClassifier();
  }

  async registerConnection(spec: ConnectionRegistration): Promise<void> {
    const effects: Effect[] = [];
    await this.repo.withTransaction((tx) => {
      if (tx.get(spec.connectionId)) return;
      const state = createConnection(spec, this.now());
      tx.insert(state);
      const learner = ModelAllowanceWeightLearner.restore(spec.connectionId, state.weights);
      if (learner.feeds().length > 0) {
        effects.push({ kind: "weights", weights: learner.feeds() });
      }
    });
    this.flush(effects);
  }

  async telemetry(connectionId: string): Promise<PacingTelemetry> {
    return this.repo.withTransaction((tx) => {
      const state = tx.require(connectionId);
      const now = this.now();
      const runtime = this.hydrate(state, now);
      const aimd = runtime.aimd.snapshot();
      const binding = runtime.burn.bindingWindow(now);
      const paced = runtime.burn.pacedBackgroundSlots(aimd.cwnd, now);
      const pacingState = derivePacingState({
        cwnd: aimd.cwnd,
        nowMs: now,
        backoffUntilMs: aimd.backoffUntilMs,
        pacedSlots: paced,
        usedPpm: binding?.usedPpm ?? 0,
        windDownPpm: runtime.burn.windDownPpm,
      });
      return {
        connectionId: state.connectionId,
        cwnd: aimd.cwnd,
        maxCwnd: aimd.maxCwnd,
        windowUsedPpm: binding?.usedPpm ?? 0,
        reserveCeilingPpm: runtime.burn.ceilingPpm,
        resetAt: binding?.windowEndMs ?? null,
        pacingState,
      };
    });
  }

  async windowRows(connectionId: string): Promise<ConnectionWindowRow[]> {
    return this.repo.listRows(connectionId);
  }

  async weight(connectionId: string, modelId: string): Promise<ModelWeightView> {
    return this.repo.withTransaction((tx) => {
      const state = tx.require(connectionId);
      const learner = ModelAllowanceWeightLearner.restore(connectionId, state.weights);
      this.primeModel(learner, connectionId, modelId);
      return learner.view(modelId);
    });
  }

  async predictWindowShare(
    connectionId: string,
    modelId: string,
    effectiveTokens: number,
  ): Promise<WindowSharePrediction> {
    return this.repo.withTransaction((tx) => {
      const state = tx.require(connectionId);
      const learner = ModelAllowanceWeightLearner.restore(connectionId, state.weights);
      this.primeModel(learner, connectionId, modelId);
      return learner.predictWindowShare(modelId, effectiveTokens);
    });
  }

  async accounting(
    connectionId: string,
  ): Promise<{ admittedDispatches: number; deniedWhileExhausted: number }> {
    const state = await this.repo.read(connectionId);
    if (!state) throw new PacingError("unknown_connection", `No global window for ${connectionId}.`);
    return {
      admittedDispatches: state.admittedDispatches,
      deniedWhileExhausted: state.deniedWhileExhausted,
    };
  }

  async autoResume(connectionId: string): Promise<AutoResumeSnapshot> {
    const state = await this.repo.read(connectionId);
    if (!state) throw new PacingError("unknown_connection", `No global window for ${connectionId}.`);
    return state.autoResume;
  }

  async requestSlot(request: DispatchRequest): Promise<SlotDecision> {
    const effects: Effect[] = [];
    const decision = await this.repo.withTransaction((tx): SlotDecision => {
      const state = tx.require(request.connectionId);
      const now = this.now();
      const runtime = this.hydrate(state, now);
      if (runtime.burn.allowsAdditiveIncrease()) runtime.aimd.pulse(true);

      if (runtime.aimd.value === 0) {
        state.deniedWhileExhausted += 1;
        this.save(state, runtime, now, effects);
        return this.deny(state, "window_exhausted", false, null, null);
      }

      const backoffUntil = runtime.aimd.snapshot().backoffUntilMs;
      if (now < backoffUntil) {
        this.save(state, runtime, now, effects);
        return this.deny(
          state,
          "backoff_429",
          true,
          backoffUntil,
          rateLimitLabel(backoffUntil - now),
        );
      }

      const interactive = isInteractiveRequest(request.role, request.priority);
      const paced = runtime.burn.pacedBackgroundSlots(runtime.aimd.value, now);
      if (!interactive && paced <= 0) {
        this.save(state, runtime, now, effects);
        return this.deny(state, "burn_paced", false, null, null);
      }

      this.primeModel(runtime.learner, request.connectionId, request.modelId);
      const reservedPpm = runtime.learner.reservationPpm(request.modelId, request.effectiveTokens);
      if (!runtime.burn.tryHold(reservedPpm)) {
        this.save(state, runtime, now, effects);
        return this.deny(state, "reserve_protected", false, null, null);
      }

      const slot: SlotKind = interactive ? "interactive" : "background";
      if (!runtime.slots.tryAcquire(slot, paced)) {
        runtime.burn.releaseHold(reservedPpm);
        this.save(state, runtime, now, effects);
        return this.deny(
          state,
          interactive ? "interactive_slot_busy" : "concurrency_full",
          false,
          null,
          null,
        );
      }

      state.grantCounter += 1;
      const grantId = `${state.connectionId}-${state.grantCounter}`;
      const reservation = this.ledger.reserve({
        connectionId: request.connectionId,
        projectId: this.projectId,
        taskId: request.taskId,
        ppm: reservedPpm,
      });
      state.grants[grantId] = {
        grantId,
        projectId: this.projectId,
        taskId: request.taskId,
        modelId: request.modelId,
        role: request.role,
        slot,
        reservedPpm,
        ledgerReservationId: reservation.reservationId,
      };
      state.admittedDispatches += 1;
      this.save(state, runtime, now, effects);
      return {
        ok: true as const,
        grantId,
        reservedPpm,
        slot,
        pacingState: state.pacingState,
      };
    });
    this.flush(effects);
    return decision;
  }

  async completeTurn(report: TurnCompletion): Promise<PacingTelemetry> {
    const effects: Effect[] = [];
    const telemetry = await this.repo.withTransaction((tx) => {
      const state = tx.require(report.connectionId);
      const grant = state.grants[report.grantId];
      if (!grant) throw new PacingError("unknown_grant", `No open grant ${report.grantId}.`);
      if (grant.projectId !== this.projectId) {
        throw new PacingError("grant_owner", "This project does not hold that grant.");
      }
      const now = this.now();
      const runtime = this.hydrate(state, now);
      runtime.slots.release(grant.slot);
      runtime.burn.settle(grant.reservedPpm, report.actualPpm, now);
      this.primeModel(runtime.learner, report.connectionId, report.modelId);
      if (report.deltaPpm !== null && report.effectiveTokens > 0) {
        runtime.learner.observe({
          connectionId: report.connectionId,
          modelId: report.modelId,
          effectiveTokens: report.effectiveTokens,
          deltaPpm: report.deltaPpm,
          source: report.quotaSource ?? "rateLimits/read",
        });
        effects.push({ kind: "weights", weights: runtime.learner.feeds() });
      }
      runtime.aimd.noteCleanCompletion(runtime.burn.allowsAdditiveIncrease());
      this.ledger.settle(grant.ledgerReservationId, Math.max(0, Math.round(report.actualPpm)));
      delete state.grants[report.grantId];
      this.save(state, runtime, now, effects);
      return this.toTelemetry(state, runtime, now);
    });
    this.flush(effects);
    return telemetry;
  }

  async observeProviderSignal(input: {
    readonly connectionId: string;
    readonly signal: ProviderLimitSignal;
    readonly grantId?: string;
  }): Promise<AppliedLimit> {
    const effects: Effect[] = [];
    const applied = await this.repo.withTransaction((tx) => {
      const state = tx.require(input.connectionId);
      const now = this.now();
      const runtime = this.hydrate(state, now);
      const binding = runtime.burn.bindingWindow(now);
      const result = this.classifier.apply(input.signal, runtime.aimd, {
        connectionId: input.connectionId,
        projectId: this.projectId,
        usedPpm: binding?.usedPpm ?? 0,
        ceilingPpm: runtime.burn.ceilingPpm,
      });
      if (input.grantId) this.dropGrant(state, runtime, input.grantId);
      if (result.classification.kind === "usage_limit_exhausted") {
        runtime.burn.persistReset(
          windowKindForReason(result.classification.reason),
          result.classification.resetAtMs ?? binding?.windowEndMs ?? now,
        );
        if (result.classification.resetAtMs !== null) {
          runtime.scheduler.arm(result.classification.resetAtMs);
        }
        if (result.stopCard && !state.stopCardOpen) {
          state.stopCardOpen = true;
          effects.push({ kind: "stop-card", card: result.stopCard });
        }
      } else if (result.boardMessage) {
        effects.push({ kind: "countdown", countdown: result.boardMessage });
      }
      this.save(state, runtime, now, effects);
      return result;
    });
    this.flush(effects);
    return applied;
  }

  async observeAuthoritativeUsage(input: {
    readonly connectionId: string;
    readonly windowKind: WindowKind;
    readonly usedPpm: number;
    readonly source: string;
  }): Promise<PacingTelemetry> {
    const effects: Effect[] = [];
    const telemetry = await this.repo.withTransaction((tx) => {
      const state = tx.require(input.connectionId);
      const now = this.now();
      const runtime = this.hydrate(state, now);
      runtime.burn.applyAuthoritative(input.windowKind, input.usedPpm, now, input.source);
      this.save(state, runtime, now, effects);
      return this.toTelemetry(state, runtime, now);
    });
    this.flush(effects);
    return telemetry;
  }

  async observeQuotaDelta(input: {
    readonly connectionId: string;
    readonly modelId: string;
    readonly effectiveTokens: number;
    readonly deltaPpm: number;
    readonly source: QuotaSampleSource;
  }): Promise<ModelWeightView> {
    const effects: Effect[] = [];
    const view = await this.repo.withTransaction((tx) => {
      const state = tx.require(input.connectionId);
      const learner = ModelAllowanceWeightLearner.restore(input.connectionId, state.weights);
      this.primeModel(learner, input.connectionId, input.modelId);
      const next = learner.observe({
        connectionId: input.connectionId,
        modelId: input.modelId,
        effectiveTokens: input.effectiveTokens,
        deltaPpm: input.deltaPpm,
        source: input.source,
      });
      state.weights = learner.snapshot();
      effects.push({ kind: "weights", weights: learner.feeds() });
      return next;
    });
    this.flush(effects);
    return view;
  }

  async observeSiwcHeaders(input: {
    readonly connectionId: string;
    readonly modelId: string;
    readonly effectiveTokens: number;
    readonly windowKind: WindowKind;
    readonly previous: SiwcRemainingHeaderSnapshot | null;
    readonly next: SiwcRemainingHeaderSnapshot;
  }): Promise<void> {
    const effects: Effect[] = [];
    await this.repo.withTransaction((tx) => {
      const state = tx.require(input.connectionId);
      const now = this.now();
      const runtime = this.hydrate(state, now);
      const previous = input.previous?.remainingPercent ?? null;
      const next = input.next.remainingPercent;
      this.primeModel(runtime.learner, input.connectionId, input.modelId);
      if (previous !== null && next !== null && next < previous && input.effectiveTokens > 0) {
        runtime.learner.observe({
          connectionId: input.connectionId,
          modelId: input.modelId,
          effectiveTokens: input.effectiveTokens,
          deltaPpm: Math.max(0, Math.round((previous - next) * 10_000)),
          source: "header_remaining_percent",
        });
        effects.push({ kind: "weights", weights: runtime.learner.feeds() });
      }
      if (next !== null) {
        runtime.burn.applyAuthoritative(
          input.windowKind,
          percentToPpm(100 - next),
          now,
          "header_remaining_percent",
        );
      }
      this.save(state, runtime, now, effects);
    });
    this.flush(effects);
  }

  async observeCopilotQuota(input: {
    readonly connectionId: string;
    readonly modelId: string;
    readonly effectiveTokens: number;
    readonly previous: CopilotQuotaSnapshot | null;
    readonly next: CopilotQuotaSnapshot;
  }): Promise<AppliedLimit | null> {
    if (input.next.remaining === 0) {
      return this.observeProviderSignal({
        connectionId: input.connectionId,
        signal: {
          httpStatus: 429,
          bodyText: "copilot remaining 0",
          retryAfterSeconds: null,
          remainingPercent: input.next.remainingPercentage,
          copilotRemaining: 0,
          openRouterCredit: null,
          nowMs: this.now(),
          resetAtMs: input.next.resetDateUtcMs,
        },
      });
    }
    const previous = input.previous?.remainingPercentage ?? null;
    const next = input.next.remainingPercentage;
    if (previous !== null && next !== null && next < previous) {
      await this.observeQuotaDelta({
        connectionId: input.connectionId,
        modelId: input.modelId,
        effectiveTokens: input.effectiveTokens,
        deltaPpm: Math.max(0, Math.round((previous - next) * 10_000)),
        source: "account.getQuota",
      });
      await this.observeAuthoritativeUsage({
        connectionId: input.connectionId,
        windowKind: "weekly",
        usedPpm: percentToPpm(100 - next),
        source: "account.getQuota",
      });
    }
    return null;
  }

  async observeOpenRouterCredit(input: {
    readonly connectionId: string;
    readonly credit: OpenRouterCreditSnapshot;
  }): Promise<AppliedLimit | null> {
    if (input.credit.credit !== 0) return null;
    return this.observeProviderSignal({
      connectionId: input.connectionId,
      signal: {
        httpStatus: 402,
        bodyText: "insufficient credits",
        retryAfterSeconds: null,
        remainingPercent: null,
        copilotRemaining: null,
        openRouterCredit: 0,
        nowMs: this.now(),
        resetAtMs: null,
      },
    });
  }

  async setAutoResumeOptIn(connectionId: string, enabled: boolean): Promise<AutoResumeSnapshot> {
    return this.repo.withTransaction((tx) => {
      const state = tx.require(connectionId);
      const now = this.now();
      const runtime = this.hydrate(state, now);
      runtime.scheduler.setOptIn(enabled);
      if (enabled && runtime.aimd.value === 0) {
        const resetAt = runtime.burn.resetAtMs(now);
        if (resetAt !== null) runtime.scheduler.arm(resetAt);
      }
      this.save(state, runtime, now, []);
      return runtime.scheduler.snapshot();
    });
  }

  async tick(connectionId: string): Promise<AutoResumeDecision> {
    const effects: Effect[] = [];
    const decision = await this.repo.withTransaction((tx) => {
      const state = tx.require(connectionId);
      const now = this.now();
      const runtime = this.hydrate(state, now);
      const result = runtime.scheduler.evaluate(now, this.preflight, connectionId);
      if (result.action === "resume") {
        runtime.aimd.restartAtStart();
        const resetAt = state.autoResume.resetAtMs ?? now;
        runtime.burn.rollAll(resetAt);
        state.stopCardOpen = false;
        state.windDownEmitted = false;
        state.ceilingCardOpen = false;
      } else if (result.diskCard) {
        effects.push({ kind: "disk", card: result.diskCard });
      }
      this.save(state, runtime, now, effects);
      return result;
    });
    this.flush(effects);
    return decision;
  }

  private hydrate(state: PersistedConnection, nowMs: number): Runtime {
    const clock = (): number => nowMs;
    return {
      aimd: AimdConcurrencyRegulator.restore(state.aimd, {
        connectionMaxCap: state.connectionMaxCap,
        hardwareCap: state.hardwareCap,
        now: clock,
        random: this.random,
      }),
      burn: BurnRateWindowTracker.restore({
        reserveFraction: state.reserveFraction,
        windows: state.windows,
        samples: state.burnSamples,
      }),
      slots: InteractivePrioritySlot.restore(state.slots),
      learner: ModelAllowanceWeightLearner.restore(state.connectionId, state.weights),
      scheduler: AutoResumeScheduler.restore(state.autoResume),
    };
  }

  private save(state: PersistedConnection, runtime: Runtime, nowMs: number, effects: Effect[]): void {
    const aimd = runtime.aimd.snapshot();
    const burn = runtime.burn.snapshot();
    state.aimd = aimd;
    state.windows = burn.windows.map((window) => ({ ...window }));
    state.burnSamples = burn.samples.map((sample) => ({ ...sample }));
    state.slots = runtime.slots.snapshot();
    state.weights = runtime.learner.snapshot();
    state.autoResume = runtime.scheduler.snapshot();
    const binding = runtime.burn.bindingWindow(nowMs);
    const used = binding?.usedPpm ?? 0;
    const paced = runtime.burn.pacedBackgroundSlots(aimd.cwnd, nowMs);
    state.pacingState = derivePacingState({
      cwnd: aimd.cwnd,
      nowMs,
      backoffUntilMs: aimd.backoffUntilMs,
      pacedSlots: paced,
      usedPpm: used,
      windDownPpm: runtime.burn.windDownPpm,
    });
    this.collectProtection(state, runtime, nowMs, effects);
  }

  private collectProtection(
    state: PersistedConnection,
    runtime: Runtime,
    nowMs: number,
    effects: Effect[],
  ): void {
    const binding = runtime.burn.bindingWindow(nowMs);
    const used = binding?.usedPpm ?? 0;
    const resetAtMs = binding?.windowEndMs ?? null;
    if (runtime.burn.crossedWindDown() && !state.windDownEmitted) {
      state.windDownEmitted = true;
      effects.push({
        kind: "wind-down",
        observation: {
          connectionId: state.connectionId,
          projectId: this.projectId,
          usedPpm: used,
          ceilingPpm: runtime.burn.ceilingPpm,
          windDownPpm: runtime.burn.windDownPpm,
          resetAtMs,
          phase: "wind_down",
        },
      });
    }
    if (runtime.burn.settledAtCeiling() && !state.ceilingCardOpen && state.aimd.cwnd > 0) {
      state.ceilingCardOpen = true;
      effects.push({
        kind: "stop-card",
        card: {
          kind: "checkpoint_stop",
          connectionId: state.connectionId,
          projectId: this.projectId,
          reason: "reserve_ceiling",
          usageLimitReason: null,
          resetAtMs,
          actions: CHECKPOINT_STOP_ACTIONS,
          retryAllowed: false,
          usedPpm: used,
          ceilingPpm: runtime.burn.ceilingPpm,
        },
      });
    }
  }

  private dropGrant(state: PersistedConnection, runtime: Runtime, grantId: string): void {
    const grant = state.grants[grantId];
    if (!grant) throw new PacingError("unknown_grant", `No open grant ${grantId}.`);
    runtime.slots.release(grant.slot);
    runtime.burn.releaseHold(grant.reservedPpm);
    this.ledger.release(grant.ledgerReservationId);
    delete state.grants[grantId];
  }

  /** Task 135 prior, else the learner's conservative seed on first sight of the model. */
  private primeModel(
    learner: ModelAllowanceWeightLearner,
    connectionId: string,
    modelId: string,
  ): void {
    if (learner.snapshot()[modelId]) return;
    const prior = this.policyPriors?.priorPpmPer1k(connectionId, modelId) ?? null;
    if (prior !== null && prior > 0) learner.seed(modelId, prior);
  }

  private deny(
    state: PersistedConnection,
    reason: string,
    retryAllowed: boolean,
    retryAtMs: number | null,
    boardMessage: string | null,
  ): SlotDecision {
    return {
      ok: false,
      reason,
      pacingState: state.pacingState,
      retryAllowed,
      retryAtMs,
      boardMessage,
    };
  }

  private toTelemetry(state: PersistedConnection, runtime: Runtime, nowMs: number): PacingTelemetry {
    const binding = runtime.burn.bindingWindow(nowMs);
    return {
      connectionId: state.connectionId,
      cwnd: state.aimd.cwnd,
      maxCwnd: state.aimd.maxCwnd,
      windowUsedPpm: binding?.usedPpm ?? 0,
      reserveCeilingPpm: runtime.burn.ceilingPpm,
      resetAt: binding?.windowEndMs ?? null,
      pacingState: state.pacingState,
    };
  }

  private flush(effects: readonly Effect[]): void {
    for (const effect of effects) {
      if (effect.kind === "countdown") this.board.showCountdown(effect.countdown);
      if (effect.kind === "stop-card") this.windDown.openCheckpointStopCard(effect.card);
      if (effect.kind === "wind-down") this.windDown.observe(effect.observation);
      if (effect.kind === "disk") this.windDown.openDiskHeadroomCard(effect.card);
      if (effect.kind === "weights") this.weightSink.publish(effect.weights);
    }
  }
}

function derivePacingState(input: {
  cwnd: number;
  nowMs: number;
  backoffUntilMs: number;
  pacedSlots: number;
  usedPpm: number;
  windDownPpm: number;
}): PacingState {
  if (input.cwnd === 0) return "window_exhausted";
  if (input.nowMs < input.backoffUntilMs) return "backoff_429";
  if (input.pacedSlots < input.cwnd || input.usedPpm >= input.windDownPpm) return "burn_paced";
  return "normal";
}

function windowKindForReason(reason: UsageLimitReason | null): WindowKind | null {
  if (reason === "weekly_cap" || reason === "copilot_remaining_zero") return "weekly";
  if (reason === "monthly_cap") return "monthly";
  if (reason === "five_hour_window" || reason === "usage_limit_reached") return "5h";
  return null;
}

function createConnection(spec: ConnectionRegistration, nowMs: number): PersistedConnection {
  if (!spec.connectionId.trim()) {
    throw new PacingError("invalid_connection", "connectionId is required.");
  }
  if (spec.windows.length === 0) {
    throw new PacingError("invalid_window", "A connection needs at least one allowance window.");
  }
  harnessCeilingPpm(spec.reserveFraction);
  const aimd = new AimdConcurrencyRegulator({
    connectionMaxCap: spec.connectionMaxCap,
    hardwareCap: spec.hardwareCap,
    now: () => nowMs,
    random: () => 0,
  });
  const windows: WindowUsage[] = spec.windows.map((window) => {
    if (window.windowEndMs <= window.windowStartMs) {
      throw new PacingError("invalid_window", "windowEndMs must be after windowStartMs.");
    }
    return {
      kind: window.kind,
      windowStartMs: window.windowStartMs,
      windowEndMs: window.windowEndMs,
      durationMs: window.windowEndMs - window.windowStartMs,
      usedPpm: 0,
      observedPpm: null,
      reservedInFlightPpm: 0,
      source: "harness_estimate",
      observedAtMs: null,
    };
  });
  const learner = new ModelAllowanceWeightLearner(spec.connectionId);
  for (const prior of spec.priors) learner.seed(prior.modelId, prior.ppmPer1k);
  return {
    connectionId: spec.connectionId,
    provider: spec.provider,
    reserveFraction: spec.reserveFraction,
    connectionMaxCap: spec.connectionMaxCap,
    hardwareCap: spec.hardwareCap,
    aimd: aimd.snapshot(),
    slots: { backgroundInFlight: 0, interactiveInFlight: 0 },
    windows,
    burnSamples: [],
    weights: learner.snapshot(),
    autoResume: { optIn: false, resetAtMs: null, wakeAtMs: null },
    pacingState: "normal",
    stopCardOpen: false,
    windDownEmitted: false,
    ceilingCardOpen: false,
    admittedDispatches: 0,
    deniedWhileExhausted: 0,
    grantCounter: 0,
    grants: {},
  };
}

export function emptyLimitSignal(nowMs: number): ProviderLimitSignal {
  return {
    httpStatus: null,
    bodyText: "",
    retryAfterSeconds: null,
    remainingPercent: null,
    copilotRemaining: null,
    openRouterCredit: null,
    nowMs,
    resetAtMs: null,
  };
}
