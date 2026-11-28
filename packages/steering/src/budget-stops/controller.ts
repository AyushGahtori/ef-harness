import type { CheckpointStore } from "./checkpoints.js";
import { WipBranchHandoffExporter } from "./exporter.js";
import { AtomicBudgetReservationLedger } from "./ledger.js";
import {
  cheapestLevelAtFloor,
  floorForSafetyClass,
  formatCountdown,
  formatGrouped,
  formatMicroUsd,
  isOptionalAdvisoryRole,
  levelRank,
  paidSwitchConfirmation,
  stickerMicroUsd,
  stepRank,
  usageLine,
  meterFor,
} from "./money.js";
import type { IntegrationBranch, KernelStopPort } from "./memory.js";
import type { StopEventStore } from "./stop-events.js";
import {
  ADD_BUDGET_PLUS_10_MICRO_USD,
  ADD_BUDGET_PLUS_5_MICRO_USD,
  BudgetStopError,
  type ActiveWorker,
  type AddBudgetChoice,
  type AttemptCheckpoint,
  type CheaperProjection,
  type CheaperTaskLine,
  type ClaimResult,
  type ConnectionAccount,
  type CrewPreset,
  type DigestNotice,
  type InboxNotice,
  type LadderReading,
  type ParkState,
  type QueuedTask,
  type RecoveryActionId,
  type RecoveryActionModel,
  type RecoveryResult,
  type StopCardModel,
  type StopEventRecord,
  type StopTrigger,
  type WindDownSnapshot,
  type WipExportInput,
  type WipExportResult,
} from "./types.js";

export interface BudgetWindDownOptions {
  readonly ledger: AtomicBudgetReservationLedger;
  readonly integration: IntegrationBranch;
  readonly checkpoints: CheckpointStore;
  readonly kernelStop: KernelStopPort;
  readonly stopEvents: StopEventStore;
  readonly connections: readonly ConnectionAccount[];
  readonly activeConnectionId: string;
  readonly exporter: WipBranchHandoffExporter;
  readonly now: () => number;
  readonly finishedFeatures?: readonly string[];
  readonly finishedTasksCount?: number;
}

interface OpenTask {
  readonly taskId: string;
  readonly title: string;
  readonly safetyClass: string | null;
}

/**
 * 50/80/90/100 wind-down for micro-USD caps and subscription ppm windows.
 * Sibling packages are local ports: ledger (Task 023), checkpoints (Task 053),
 * kernel stop (Task 114), and allowance windows (Task 140).
 */
export class BudgetWindDownController {
  private readonly ledger: AtomicBudgetReservationLedger;
  private readonly integration: IntegrationBranch;
  private readonly checkpoints: CheckpointStore;
  private readonly kernelStop: KernelStopPort;
  private readonly stopEvents: StopEventStore;
  private readonly exporter: WipBranchHandoffExporter;
  private readonly now: () => number;
  private connections: ConnectionAccount[];
  private activeConnectionId: string;
  private readonly active = new Map<string, ActiveWorker>();
  private readonly queued = new Map<string, QueuedTask>();
  private readonly finishedFeatures: string[];
  private finishedTasksCount: number;
  private readonly digest: DigestNotice[] = [];
  private readonly inbox: InboxNotice[] = [];
  private readonly announced = new Set<string>();
  private interruptionCount = 0;
  private officeLights: "day" | "evening" = "day";
  private halted = false;
  private stopped = false;
  private stopCard: StopCardModel | null = null;
  private stopEvent: StopEventRecord | null = null;
  private parked: ParkState | null = null;
  private preset: CrewPreset = "balanced";
  private autoResumeAtReset = false;
  private vscodeCommand: string | null = null;
  private inFlightIds: string[] = [];

  constructor(options: BudgetWindDownOptions) {
    this.ledger = options.ledger;
    this.integration = options.integration;
    this.checkpoints = options.checkpoints;
    this.kernelStop = options.kernelStop;
    this.stopEvents = options.stopEvents;
    this.exporter = options.exporter;
    this.now = options.now;
    this.connections = options.connections.map((connection) => ({ ...connection }));
    this.activeConnectionId = options.activeConnectionId;
    this.finishedFeatures = [...(options.finishedFeatures ?? [])];
    this.finishedTasksCount = options.finishedTasksCount ?? 0;
    if (!this.connections.some((connection) => connection.id === this.activeConnectionId)) {
      throw new BudgetStopError("unknown_connection", "active connection is not connected");
    }
  }

  activeConnection(): string {
    return this.activeConnectionId;
  }

  enqueue(task: QueuedTask): void {
    this.queued.set(task.taskId, task);
  }

  registerActive(worker: Omit<ActiveWorker, "reservationId">): void {
    this.active.set(worker.workerId, { ...worker, reservationId: null });
  }

  setConnectionHealth(id: string, healthy: boolean): void {
    const current = this.connections.find((connection) => connection.id === id);
    if (!current) throw new BudgetStopError("unknown_connection", `unknown connection ${id}`);
    this.connections = this.connections.map((connection) =>
      connection.id === id ? { ...connection, healthy } : connection,
    );
  }

  observe(): WindDownSnapshot {
    const reading = this.ledger.ladder();
    this.announce(reading);
    if (!this.halted) {
      const micro = reading.sides.find((side) => side.currency === "micro-usd");
      const ppm = reading.sides.find((side) => side.currency === "ppm");
      if (micro?.step === "hard_stop_100") {
        this.halt("budget_100");
      } else if (ppm?.step === "hard_stop_100") {
        this.halt("window_exhausted");
      } else if (this.shouldPreviewSubscriptionCard(reading)) {
        this.stopCard = this.buildCard("subscription_wind_down");
      }
    }
    return this.snapshot();
  }

  snapshot(): WindDownSnapshot {
    const reading = this.ledger.ladder();
    return {
      step: reading.step,
      meter: meterFor(reading.step, reading.percent, this.interruptionCount),
      digest: [...this.digest],
      inbox: [...this.inbox],
      claimingEnabled: !this.halted && !this.stopped && stepRank(reading.step) < stepRank("wind_down_90"),
      optionalAdvisoriesSkipped: stepRank(reading.step) >= stepRank("warning_80"),
      mandatoryVerificationIntact: true,
      interruptionCount: this.interruptionCount,
      officeLights: this.officeLights,
      stopCard: this.stopCard,
      activeWorkerIds: [...this.active.keys()],
      queuedTaskIds: [...this.queued.keys()],
      finishedFeatures: [...this.finishedFeatures],
      finishedTasksCount: this.finishedTasksCount,
      parked: this.parked,
      stopped: this.stopped,
      preset: this.preset,
    };
  }

  async tryClaim(taskId: string): Promise<ClaimResult> {
    const task = this.queued.get(taskId);
    if (!task) return claim(false, "unknown_task", null, false);
    if (this.halted || this.stopped) return claim(false, "hard_stop", null, false);
    const step = this.ledger.ladder().step;
    if (step === "hard_stop_100") return claim(false, "hard_stop", null, true);
    if (stepRank(step) >= stepRank("wind_down_90")) return claim(false, "wind_down", null, true);
    if (isOptionalAdvisoryRole(task.role) && stepRank(step) >= stepRank("warning_80")) {
      return claim(false, "optional_advisory_skipped", null, false);
    }
    const reserved = await this.ledger.reserve({
      workerId: task.taskId,
      currency: task.currency,
      ceilingUnits: task.ceilingUnits,
    });
    if (!reserved.ok || reserved.reservationId === null) {
      return claim(false, reserved.windDown ? "wind_down" : "reservation_denied", null, reserved.windDown);
    }
    this.queued.delete(taskId);
    this.active.set(task.taskId, {
      workerId: task.taskId,
      taskId: task.taskId,
      title: task.title,
      featureId: task.featureId,
      role: task.role,
      currency: task.currency,
      ceilingUnits: task.ceilingUnits,
      step: 1,
      steps: 8,
      files: [],
      failingTestOutput: null,
      acceptanceCriteria: task.acceptanceCriteria,
      safetyClass: task.safetyClass,
      reservationId: reserved.reservationId,
    });
    return claim(true, "claimed", reserved.reservationId, reserved.windDown);
  }

  async finishActive(
    workerId: string,
    actualUnits: number,
    outcome: { readonly verified: boolean; readonly featureId: string; readonly mergeSha: string; readonly subject: string },
  ): Promise<{ readonly finished: boolean; readonly merged: boolean }> {
    const worker = this.active.get(workerId);
    if (!worker) throw new BudgetStopError("unknown_worker", `worker ${workerId} is not active`);
    if (this.halted || this.ledger.ladder().step === "hard_stop_100") {
      this.writeCheckpoint(worker);
      this.active.delete(workerId);
      return { finished: false, merged: false };
    }
    const reservationId = await this.ensureReservation(worker, actualUnits);
    if (reservationId === null) {
      this.writeCheckpoint(worker);
      this.active.delete(workerId);
      return { finished: false, merged: false };
    }
    this.ledger.settle(reservationId, actualUnits);
    if (!outcome.verified) {
      this.writeCheckpoint(worker);
      this.active.delete(workerId);
      return { finished: false, merged: false };
    }
    const before = this.integration.history().map((commit) => commit.sha);
    this.integration.mergeVerified({
      sha: outcome.mergeSha,
      featureId: outcome.featureId,
      subject: outcome.subject,
    });
    const after = this.integration.history().map((commit) => commit.sha);
    if (after.slice(0, before.length).join("|") !== before.join("|")) {
      throw new BudgetStopError("integration_rewritten", "a finish rewrote harness/integration history");
    }
    if (!this.finishedFeatures.includes(outcome.featureId)) this.finishedFeatures.push(outcome.featureId);
    this.finishedTasksCount += 1;
    this.active.delete(workerId);
    return { finished: true, merged: true };
  }

  stopForUser(): StopEventRecord {
    return this.halt("user_stop");
  }

  stopForDiskRed(): StopEventRecord {
    return this.halt("disk_red");
  }

  addBudget(choice: AddBudgetChoice): RecoveryResult {
    if (this.ledger.limit("micro-usd") === null) return blocked("no_dollar_cap");
    const active = this.requireConnection(this.activeConnectionId);
    if (!active.healthy) return blocked("connection_unhealthy");
    const delta = budgetDelta(choice);
    const remainingAfter = this.ledger.remaining("micro-usd") + delta;
    if (remainingAfter <= 0) return blocked("allowance_not_positive");
    this.ledger.raiseMicroUsdLimit(delta);
    this.liftStop();
    this.recordRecovery("add_budget");
    return resumed(this.checkpointShas(), this.ledger.remaining("micro-usd"), ppmOrNull(this.ledger), null, null);
  }

  switchConnection(targetId: string, confirmed: boolean): RecoveryResult {
    const target = this.requireConnection(targetId);
    const source = this.requireConnection(this.activeConnectionId);
    if (source.billing === "subscription" && target.billing === "pay-per-use") {
      const text = paidSwitchConfirmation(
        target.label,
        target.estimateMicroUsd ?? 0,
        target.remainingTasks ?? this.remainingCount(),
      );
      if (!confirmed) return blocked("confirmation_required", text);
    }
    if (!target.healthy) return blocked("connection_unhealthy");
    if (!this.destinationHasHeadroom(target)) return blocked("allowance_not_positive");
    this.activeConnectionId = target.id;
    this.liftStop();
    this.recordRecovery("switch_connection");
    return resumed(this.checkpointShas(), microOrNull(this.ledger), ppmOrNull(this.ledger), null, null);
  }

  armAutoResume(enabled: boolean): void {
    this.autoResumeAtReset = enabled;
    this.refreshCard();
  }

  resumeFromReset(source: "user" | "auto"): RecoveryResult {
    if (source === "auto" && !this.autoResumeAtReset) return blocked("auto_resume_off");
    const subscription = this.subscriptionConnection();
    if (!subscription?.window) return blocked("no_window");
    const active = this.requireConnection(this.activeConnectionId);
    if (!active.healthy) return blocked("connection_unhealthy");
    if (this.now() < subscription.window.resetAtMs) return blocked("window_still_closed");
    if (this.ledger.limit("ppm") !== null) this.ledger.setPpmSpent(0);
    if (this.ledger.limit("ppm") !== null && this.ledger.remaining("ppm") <= 0) {
      return blocked("allowance_not_positive");
    }
    this.liftStop();
    this.recordRecovery("wait_for_reset");
    return resumed(this.checkpointShas(), microOrNull(this.ledger), ppmOrNull(this.ledger), null, null);
  }

  applyCheaper(confirmed: boolean): RecoveryResult {
    const projection = this.projection();
    if (!confirmed) return blocked("confirmation_required", null, projection);
    if (projection.lines.some((line) => levelRank(line.level) < levelRank(line.floor))) {
      return blocked("below_floor", null, projection);
    }
    this.preset = "cheapest";
    const active = this.requireConnection(this.activeConnectionId);
    if (!active.healthy) return blocked("connection_unhealthy", null, projection);
    if (!this.hasResumeHeadroom()) return blocked("allowance_not_positive", null, projection);
    this.liftStop();
    this.recordRecovery("cheaper_models");
    return resumed(this.checkpointShas(), microOrNull(this.ledger), ppmOrNull(this.ledger), null, projection);
  }

  keepParked(): ParkState {
    const checkpointRefs = this.checkpoints.list().map((item) => item.ref);
    this.parked = { cpu: 0, spendPerHourMicroUsd: 0, welcomeBackReady: true, checkpointRefs };
    this.stopped = true;
    this.recordRecovery("keep_parked");
    return this.parked;
  }

  finishByHand(input: WipExportInput): WipExportResult {
    const before = this.integration.head();
    const history = this.integration.history().map((commit) => commit.sha);
    const result = this.exporter.exportBundle(input);
    if (this.integration.head() !== before) {
      throw new BudgetStopError("integration_moved", "finish by hand moved harness/integration");
    }
    const after = this.integration.history().map((commit) => commit.sha);
    if (after.join("|") !== history.join("|")) {
      throw new BudgetStopError("integration_rewritten", "finish by hand rewrote harness/integration");
    }
    this.vscodeCommand = result.openInVsCodeCommand;
    this.recordRecovery("finish_by_hand");
    const checkpointRefs = this.checkpoints.list().map((item) => item.ref);
    this.parked = { cpu: 0, spendPerHourMicroUsd: 0, welcomeBackReady: true, checkpointRefs };
    this.stopped = true;
    this.refreshCard();
    return result;
  }

  private announce(reading: LadderReading): void {
    for (const side of reading.sides) {
      if (side.step === "below") continue;
      const key = `${side.currency}:${side.step}`;
      if (this.announced.has(key)) continue;
      this.announced.add(key);
      if (side.step === "info_50") {
        this.digest.push({
          channel: "digest",
          subtle: true,
          text: usageLine(side.currency, side.committed, side.limit),
        });
      } else if (side.step === "warning_80") {
        this.inbox.push({ text: usageLine(side.currency, side.committed, side.limit) });
      } else if (side.step === "wind_down_90") {
        this.digest.push({
          channel: "digest",
          subtle: false,
          text:
            side.currency === "micro-usd"
              ? "Budget nearly used · finishing current steps"
              : "Allowance nearly used · finishing current steps",
        });
      }
    }
  }

  private shouldPreviewSubscriptionCard(reading: LadderReading): boolean {
    if (this.ledger.limit("micro-usd") !== null) return false;
    return stepRank(reading.step) >= stepRank("wind_down_90") && reading.step !== "hard_stop_100";
  }

  private halt(trigger: StopTrigger): StopEventRecord {
    if (this.halted && this.stopEvent) return this.stopEvent;
    const workers = [...this.active.values()];
    const checkpoints = workers.map((worker) => this.writeCheckpoint(worker));
    for (const worker of workers) {
      if (worker.reservationId) this.ledger.release(worker.reservationId);
    }
    this.active.clear();
    this.inFlightIds = checkpoints.map((item) => item.taskId);
    this.halted = true;
    this.stopped = true;
    this.officeLights = "evening";
    this.interruptionCount += 1;
    this.kernelStop.stop(trigger);
    const event = this.stopEvents.record({
      trigger,
      timestampMs: this.now(),
      checkpointShas: checkpoints.map((item) => item.sha),
      recoveryOption: null,
    });
    this.stopEvent = event;
    this.stopCard = this.buildCard(trigger);
    return event;
  }

  private liftStop(): void {
    this.halted = false;
    this.stopped = false;
    this.parked = null;
    this.officeLights = "day";
    this.stopCard = null;
  }

  private refreshCard(): void {
    if (!this.stopCard) return;
    this.stopCard = this.buildCard(this.stopCard.trigger);
  }

  private buildCard(trigger: StopCardModel["trigger"]): StopCardModel {
    const projection = this.projection();
    const subscription = this.subscriptionConnection();
    const dollarCap = this.ledger.limit("micro-usd") !== null;
    const ppm = this.ledger.snapshot("ppm");
    const pressure = ppm !== null && stepRank(ppm.step) >= stepRank("wind_down_90");
    const highlightTrio = !dollarCap && (pressure || trigger === "subscription_wind_down" || trigger === "window_exhausted");
    const countdown = subscription?.window ? formatCountdown(subscription.window.resetAtMs - this.now()) : null;
    const confirmations = this.confirmationTexts();
    const actions: RecoveryActionModel[] = [
      {
        id: "add_budget",
        label: "Add Budget",
        applicable: dollarCap,
        enabled: dollarCap,
        highlighted: false,
        hidden: !dollarCap,
        detail: "+$5 / +$10 / Custom",
      },
      {
        id: "cheaper_models",
        label: "Switch to Cheaper Models",
        applicable: projection.lines.length > 0,
        enabled: projection.lines.length > 0,
        highlighted: false,
        hidden: false,
        detail: cheaperDetail(projection),
      },
      {
        id: "switch_connection",
        label: "Switch Connection",
        applicable: this.connections.length > 1,
        enabled: this.connections.length > 1,
        highlighted: highlightTrio,
        hidden: false,
        detail: confirmations[0] ?? "Choose another connected provider",
      },
      {
        id: "wait_for_reset",
        label: countdown ? `Wait for Reset (${countdown})` : "Wait for Reset",
        applicable: subscription !== null,
        enabled: subscription !== null,
        highlighted: highlightTrio && subscription !== null,
        hidden: subscription === null,
        detail: countdown ? `Resets in ${countdown}. Auto-resume at reset is optional.` : "No subscription window",
      },
      {
        id: "finish_by_hand",
        label: "Finish by Hand",
        applicable: true,
        enabled: true,
        highlighted: false,
        hidden: false,
        detail: "Export a wip branch and HANDOFF.md",
      },
      {
        id: "keep_parked",
        label: "Keep Parked",
        applicable: true,
        enabled: true,
        highlighted: highlightTrio,
        hidden: false,
        detail: "Leave parked at 0 CPU / 0 spend",
      },
    ];
    return {
      trigger,
      finishedFeatures: [...this.finishedFeatures],
      finishedTasksCount: this.finishedTasksCount,
      inFlightCheckpointedTasks: this.openTaskIds(),
      remainingTasksCount: this.queued.size,
      spentSummary: this.spentSummary(trigger),
      officeLights: this.officeLights,
      actions,
      cheaper: projection,
      confirmationTexts: confirmations,
      autoResumeAtReset: this.autoResumeAtReset,
      vscodeCommand: this.vscodeCommand,
    };
  }

  private projection(): CheaperProjection {
    const tasks = [...this.queued.values(), ...this.active.values(), ...this.checkpointTasks()];
    const seen = new Set<string>();
    const lines: CheaperTaskLine[] = [];
    for (const task of tasks) {
      if (seen.has(task.taskId)) continue;
      seen.add(task.taskId);
      const floor = floorForSafetyClass(task.safetyClass);
      const level = cheapestLevelAtFloor(floor);
      lines.push({
        taskId: task.taskId,
        title: task.title,
        floor,
        level,
        estimatedMicroUsd: stickerMicroUsd(level),
      });
    }
    const projectedRemainingMicroUsd = lines.reduce((sum, line) => sum + line.estimatedMicroUsd, 0);
    return { preset: "cheapest", projectedRemainingMicroUsd, lines };
  }

  private checkpointTasks(): OpenTask[] {
    return this.checkpoints
      .list()
      .filter((item) => this.inFlightIds.includes(item.taskId))
      .map((item) => ({ taskId: item.taskId, title: item.taskId, safetyClass: null }));
  }

  private openTaskIds(): string[] {
    const ids = new Set<string>(this.inFlightIds);
    for (const worker of this.active.values()) ids.add(worker.taskId);
    return [...ids];
  }

  private spentSummary(trigger: StopCardModel["trigger"]): string {
    const micro = this.ledger.snapshot("micro-usd");
    const ppm = this.ledger.snapshot("ppm");
    if (micro && (trigger === "budget_100" || ppm === null)) {
      return `${formatMicroUsd(micro.committed)} of ${formatMicroUsd(micro.limit)}`;
    }
    if (ppm) return `${formatGrouped(ppm.committed)} / ${formatGrouped(ppm.limit)} ppm`;
    if (micro) return `${formatMicroUsd(micro.committed)} of ${formatMicroUsd(micro.limit)}`;
    return "No spend cap";
  }

  private confirmationTexts(): string[] {
    const active = this.requireConnection(this.activeConnectionId);
    if (active.billing !== "subscription") return [];
    const texts: string[] = [];
    for (const connection of this.connections) {
      if (connection.billing !== "pay-per-use" || connection.estimateMicroUsd === null) continue;
      texts.push(
        paidSwitchConfirmation(
          connection.label,
          connection.estimateMicroUsd,
          connection.remainingTasks ?? this.remainingCount(),
        ),
      );
    }
    return texts;
  }

  private subscriptionConnection(): ConnectionAccount | null {
    return this.connections.find((connection) => connection.billing === "subscription" && connection.window !== null) ?? null;
  }

  private remainingCount(): number {
    return this.queued.size + this.active.size + this.inFlightIds.length;
  }

  private destinationHasHeadroom(target: ConnectionAccount): boolean {
    if (target.billing === "local") return true;
    if (target.billing === "pay-per-use") {
      const projectRoom = this.ledger.limit("micro-usd") !== null && this.ledger.remaining("micro-usd") > 0;
      const accountRoom = target.microUsdRemaining !== null && target.microUsdRemaining > 0;
      return projectRoom || accountRoom;
    }
    return this.ledger.limit("ppm") === null || this.ledger.remaining("ppm") > 0;
  }

  private hasResumeHeadroom(): boolean {
    const micro = this.ledger.limit("micro-usd");
    const ppm = this.ledger.limit("ppm");
    if (micro === null && ppm === null) return true;
    if (micro !== null && this.ledger.remaining("micro-usd") > 0) return true;
    if (ppm !== null && this.ledger.remaining("ppm") > 0) return true;
    return false;
  }

  private async ensureReservation(worker: ActiveWorker, actualUnits: number): Promise<string | null> {
    if (worker.reservationId) return worker.reservationId;
    const ceiling = Math.max(worker.ceilingUnits, actualUnits);
    const reserved = await this.ledger.reserve({
      workerId: worker.workerId,
      currency: worker.currency,
      ceilingUnits: ceiling,
    });
    if (!reserved.ok || reserved.reservationId === null) return null;
    worker.reservationId = reserved.reservationId;
    return reserved.reservationId;
  }

  private writeCheckpoint(worker: ActiveWorker): AttemptCheckpoint {
    return this.checkpoints.write({
      taskId: worker.taskId,
      files: worker.files,
      failingTestOutput: worker.failingTestOutput,
    });
  }

  private checkpointShas(): string[] {
    return this.checkpoints.list().map((item) => item.sha);
  }

  private recordRecovery(action: RecoveryActionId): void {
    if (!this.stopEvent) return;
    this.stopEvent = this.stopEvents.setRecovery(this.stopEvent.id, action);
  }

  private requireConnection(id: string): ConnectionAccount {
    const connection = this.connections.find((item) => item.id === id);
    if (!connection) throw new BudgetStopError("unknown_connection", `unknown connection ${id}`);
    return connection;
  }
}

export function createBudgetWindDownController(options: BudgetWindDownOptions): BudgetWindDownController {
  return new BudgetWindDownController(options);
}

function claim(claimed: boolean, reason: ClaimResult["reason"], reservationId: string | null, windDown: boolean): ClaimResult {
  return { claimed, reason, reservationId, windDown };
}

function blocked(reason: string, confirmationText: string | null = null, projection: CheaperProjection | null = null): RecoveryResult {
  return {
    resumed: false,
    reason,
    confirmationText,
    resumeFrom: [],
    remainingMicroUsd: null,
    remainingPpm: null,
    projection,
  };
}

function resumed(
  resumeFrom: readonly string[],
  remainingMicroUsd: number | null,
  remainingPpm: number | null,
  confirmationText: string | null,
  projection: CheaperProjection | null,
): RecoveryResult {
  return {
    resumed: true,
    reason: null,
    confirmationText,
    resumeFrom,
    remainingMicroUsd,
    remainingPpm,
    projection,
  };
}

function budgetDelta(choice: AddBudgetChoice): number {
  if (choice.kind === "plus_5") return ADD_BUDGET_PLUS_5_MICRO_USD;
  if (choice.kind === "plus_10") return ADD_BUDGET_PLUS_10_MICRO_USD;
  if (!Number.isSafeInteger(choice.customMicroUsd) || choice.customMicroUsd <= 0) {
    throw new BudgetStopError("bad_budget", "custom budget must be a positive integer micro-USD amount");
  }
  return choice.customMicroUsd;
}

function cheaperDetail(projection: CheaperProjection): string {
  const floors = projection.lines
    .filter((line) => line.floor !== "junior")
    .map((line) => `${line.taskId} stays at ${line.floor}`);
  const floorNote = floors.length > 0 ? ` ${floors.join("; ")}.` : "";
  return `Preset Cheapest. Remaining ${projection.lines.length} tasks: ${formatMicroUsd(projection.projectedRemainingMicroUsd)}.${floorNote}`;
}

function microOrNull(ledger: AtomicBudgetReservationLedger): number | null {
  return ledger.limit("micro-usd") === null ? null : ledger.remaining("micro-usd");
}

function ppmOrNull(ledger: AtomicBudgetReservationLedger): number | null {
  return ledger.limit("ppm") === null ? null : ledger.remaining("ppm");
}
