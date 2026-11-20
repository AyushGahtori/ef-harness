import { createAutoStartToast } from "./auto-start-grace-window.js";
import {
  DAILY_CAP_MICRO_USD,
  DAILY_WINDOW_CAP_PPM,
  DELTA_COST_CEILING_MICRO_USD,
  DELTA_TASK_CEILING,
  DELTA_WINDOW_CEILING_PPM,
  PLAN_WINDOW_PPM,
  ROLLING_WINDOW_MS,
  UNIT_SCALE,
} from "./constants.js";
import { PlanPreviewError } from "./errors.js";
import { formatUsd, formatWindowPercent } from "./money.js";
import { PlanSnapshotDiffer } from "./plan-snapshot-diff.js";
import type {
  AutoStartDecision,
  AutoStartHistoryEntry,
  AutoStartSettings,
  HardStopTrigger,
  PlanSnapshot,
  RevisionCandidate,
} from "./types.js";

export const OWNER_AUTO_START_DEFAULTS: AutoStartSettings = {
  deltaTasksCeiling: DELTA_TASK_CEILING,
  deltaCostCeilingMicroUsd: DELTA_COST_CEILING_MICRO_USD,
  deltaWindowCeilingPpm: DELTA_WINDOW_CEILING_PPM,
  dailyCapMicroUsd: DAILY_CAP_MICRO_USD,
  dailyWindowCapPpm: DAILY_WINDOW_CAP_PPM,
};

export class RevisionAutoStartPolicy {
  private settings: AutoStartSettings = { ...OWNER_AUTO_START_DEFAULTS };
  private readonly history: AutoStartHistoryEntry[] = [];
  private readonly differ = new PlanSnapshotDiffer();

  currentSettings(): AutoStartSettings {
    return { ...this.settings };
  }

  configure(input: Partial<AutoStartSettings>): { readonly settings: AutoStartSettings; readonly ceilingApplied: boolean } {
    let ceilingApplied = false;
    const next = { ...this.settings };
    if (input.deltaTasksCeiling !== undefined) {
      assertNonNegativeInt(input.deltaTasksCeiling, "deltaTasksCeiling");
      if (input.deltaTasksCeiling > DELTA_TASK_CEILING) ceilingApplied = true;
      next.deltaTasksCeiling = Math.min(input.deltaTasksCeiling, DELTA_TASK_CEILING);
    }
    if (input.deltaCostCeilingMicroUsd !== undefined) {
      assertNonNegativeBig(input.deltaCostCeilingMicroUsd, "deltaCostCeilingMicroUsd");
      if (input.deltaCostCeilingMicroUsd > DELTA_COST_CEILING_MICRO_USD) ceilingApplied = true;
      next.deltaCostCeilingMicroUsd =
        input.deltaCostCeilingMicroUsd > DELTA_COST_CEILING_MICRO_USD
          ? DELTA_COST_CEILING_MICRO_USD
          : input.deltaCostCeilingMicroUsd;
    }
    if (input.deltaWindowCeilingPpm !== undefined) {
      assertNonNegativeInt(input.deltaWindowCeilingPpm, "deltaWindowCeilingPpm");
      if (input.deltaWindowCeilingPpm > DELTA_WINDOW_CEILING_PPM) ceilingApplied = true;
      next.deltaWindowCeilingPpm = Math.min(input.deltaWindowCeilingPpm, DELTA_WINDOW_CEILING_PPM);
    }
    if (input.dailyCapMicroUsd !== undefined) {
      assertNonNegativeBig(input.dailyCapMicroUsd, "dailyCapMicroUsd");
      if (input.dailyCapMicroUsd > DAILY_CAP_MICRO_USD) ceilingApplied = true;
      next.dailyCapMicroUsd =
        input.dailyCapMicroUsd > DAILY_CAP_MICRO_USD ? DAILY_CAP_MICRO_USD : input.dailyCapMicroUsd;
    }
    if (input.dailyWindowCapPpm !== undefined) {
      assertNonNegativeInt(input.dailyWindowCapPpm, "dailyWindowCapPpm");
      if (input.dailyWindowCapPpm > DAILY_WINDOW_CAP_PPM) ceilingApplied = true;
      next.dailyWindowCapPpm = Math.min(input.dailyWindowCapPpm, DAILY_WINDOW_CAP_PPM);
    }
    this.settings = next;
    return { settings: this.currentSettings(), ceilingApplied };
  }

  record(entry: AutoStartHistoryEntry): void {
    assertNonNegativeInt(entry.atMs, "atMs");
    assertNonNegativeBig(entry.costMicroUsd, "costMicroUsd");
    assertNonNegativeInt(entry.windowPpm, "windowPpm");
    this.history.push({ atMs: entry.atMs, costMicroUsd: entry.costMicroUsd, windowPpm: entry.windowPpm });
  }

  evaluate(
    candidate: RevisionCandidate,
    snapshots?: {
      readonly before: PlanSnapshot;
      readonly after: PlanSnapshot;
      readonly reverifiedTaskCount: number;
    },
  ): AutoStartDecision {
    validateCandidate(candidate);
    if (candidate.isFirstBuild) {
      return this.blocked(["Needs approval: first build waits for Start build"], [], candidate, snapshots);
    }

    const reasons: string[] = [];
    const triggers: HardStopTrigger[] = [];
    if (candidate.unresolvedMustAsk) {
      triggers.push("must_ask");
      reasons.push("Needs approval: unresolved must-ask criterion");
    }
    if (candidate.unresolvedConflict) {
      triggers.push("conflict");
      reasons.push("Needs approval: unresolved conflict");
    }
    if (candidate.breakingContract) {
      triggers.push("breaking_contract");
      reasons.push("Needs approval: breaking contract change");
    }
    if (candidate.destructiveMigration) {
      triggers.push("destructive_migration");
      reasons.push("Needs approval: destructive migration");
    }
    if (candidate.newPackages.length > 0) {
      triggers.push("new_dependency");
      reasons.push(packageReason(candidate.newPackages));
    }
    if (candidate.externalEffects.length > 0) {
      triggers.push("external_effect");
      reasons.push("Needs approval: external side effect");
    }
    if (candidate.deltaTasks > this.settings.deltaTasksCeiling) {
      reasons.push(
        `Needs approval: ${candidate.deltaTasks.toString()} tasks exceeds the ${this.settings.deltaTasksCeiling.toString()}-task ceiling`,
      );
    }
    if (candidate.deltaCostMicroUsd > this.settings.deltaCostCeilingMicroUsd) {
      reasons.push(
        candidate.connection === "api"
          ? `Needs approval: ${formatUsd(candidate.deltaCostMicroUsd)} exceeds the ${formatUsd(this.settings.deltaCostCeilingMicroUsd)} ceiling`
          : "Needs approval: revision exceeds the auto-start cost ceiling",
      );
    }
    if (candidate.deltaPlanWindowPpm > this.settings.deltaWindowCeilingPpm) {
      reasons.push(
        `Needs approval: ${formatWindowPercent(candidate.deltaPlanWindowPpm)} exceeds the ${formatWindowPercent(this.settings.deltaWindowCeilingPpm)} plan-window ceiling`,
      );
    }
    const daily = this.dailyCapReason(candidate);
    if (daily) reasons.push(daily);

    if (reasons.length > 0) return this.blocked(reasons, triggers, candidate, snapshots);

    const toast = createAutoStartToast({
      revisionId: candidate.revisionId,
      connection: candidate.connection,
      taskCount: candidate.deltaTasks,
      costMicroUsd: candidate.deltaCostMicroUsd,
      windowPpm: candidate.deltaPlanWindowPpm,
      nowMs: candidate.nowMs,
    });
    return {
      autoStart: true,
      openPlanPreview: false,
      explicitConfirmationRequired: false,
      approvalReason: null,
      reasons: [],
      triggers: [],
      toast,
      planDelta: null,
    };
  }

  private dailyCapReason(candidate: RevisionCandidate): string | null {
    const recent = this.history.filter((entry) => entry.atMs > candidate.nowMs - ROLLING_WINDOW_MS && entry.atMs <= candidate.nowMs);
    if (candidate.connection === "api") {
      const spent = recent.reduce((sum, entry) => sum + entry.costMicroUsd, 0n) + candidate.deltaCostMicroUsd;
      if (spent > this.settings.dailyCapMicroUsd) {
        return `Needs approval: rolling 24h auto-start spend exceeds ${formatUsd(this.settings.dailyCapMicroUsd)}`;
      }
      return null;
    }
    const spentPpm = recent.reduce((sum, entry) => sum + entry.windowPpm, 0) + candidate.deltaPlanWindowPpm;
    const capPpm = dailyWindowCapPpm(candidate.planWindowPpm, this.settings.dailyWindowCapPpm);
    if (spentPpm > capPpm) {
      return `Needs approval: rolling 24h auto-start spend exceeds ${formatWindowPercent(this.settings.dailyWindowCapPpm)} of the plan window`;
    }
    return null;
  }

  private blocked(
    reasons: readonly string[],
    triggers: readonly HardStopTrigger[],
    candidate: RevisionCandidate,
    snapshots:
      | {
          readonly before: PlanSnapshot;
          readonly after: PlanSnapshot;
          readonly reverifiedTaskCount: number;
        }
      | undefined,
  ): AutoStartDecision {
    const approvalReason = reasons[0] ?? "Needs approval";
    const planDelta = snapshots
      ? this.differ.diff({
          before: snapshots.before,
          after: snapshots.after,
          reverifiedTaskCount: snapshots.reverifiedTaskCount,
          approvalReason,
        })
      : null;
    return {
      autoStart: false,
      openPlanPreview: true,
      explicitConfirmationRequired: true,
      approvalReason,
      reasons,
      triggers,
      toast: null,
      planDelta,
    };
  }
}

function packageReason(packages: readonly string[]): string {
  const first = packages[0];
  if (packages.length === 1 && first) return `Needs approval: adds new package '${first}'`;
  const quoted = packages.map((name) => `'${name}'`).join(", ");
  return `Needs approval: adds new package ${quoted}`;
}

function dailyWindowCapPpm(planWindowPpm: number, capRatioPpm: number): number {
  const windowPpm = planWindowPpm > 0 ? planWindowPpm : PLAN_WINDOW_PPM;
  return Math.floor((windowPpm * capRatioPpm) / Number(UNIT_SCALE));
}

function validateCandidate(candidate: RevisionCandidate): void {
  if (!candidate.revisionId) throw new PlanPreviewError("invalid_revision", "revisionId is required");
  assertNonNegativeInt(candidate.deltaTasks, "deltaTasks");
  assertNonNegativeBig(candidate.deltaCostMicroUsd, "deltaCostMicroUsd");
  assertNonNegativeInt(candidate.deltaPlanWindowPpm, "deltaPlanWindowPpm");
  assertNonNegativeInt(candidate.planWindowPpm, "planWindowPpm");
  assertNonNegativeInt(candidate.nowMs, "nowMs");
}

function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new PlanPreviewError("invalid_threshold", `${label} must be a non-negative integer`);
  }
}

function assertNonNegativeBig(value: bigint, label: string): void {
  if (value < 0n) throw new PlanPreviewError("invalid_threshold", `${label} must be a non-negative integer`);
}
