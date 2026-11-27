import type { GlobalBrokerDb } from "@ef-harness/db";
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

export const AUTO_START_HISTORY_SETTING_KEY = "plan_preview.auto_start.history";
export const AUTO_START_SETTINGS_SETTING_KEY = "plan_preview.auto_start.settings";

export interface AutoStartHistoryStorePort {
  readHistory(): readonly AutoStartHistoryEntry[];
  writeHistory(entries: readonly AutoStartHistoryEntry[]): void;
  readSettings(): Partial<AutoStartSettings> | undefined;
  writeSettings(settings: AutoStartSettings): void;
}

export interface GlobalBrokerAutoStartStoreOptions {
  readonly scopeKey?: string;
  readonly historyKey?: string;
  readonly settingsKey?: string;
}

function parseBigIntField(raw: unknown, label: string): bigint {
  if (typeof raw === "bigint") {
    if (raw < 0n) throw new PlanPreviewError("invalid_threshold", `${label} must be non-negative`);
    return raw;
  }
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 0) {
      throw new PlanPreviewError("invalid_threshold", `${label} must be a non-negative integer`);
    }
    return BigInt(raw);
  }
  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    return BigInt(raw);
  }
  throw new PlanPreviewError("invalid_threshold", `${label} must be a non-negative integer string`);
}

function parseIntField(raw: unknown, label: string): number {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    const parsed = Number(raw);
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  }
  throw new PlanPreviewError("invalid_threshold", `${label} must be a non-negative integer`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function bindGlobalBrokerAutoStartStore(
  globalDb: GlobalBrokerDb,
  options: GlobalBrokerAutoStartStoreOptions = {},
): AutoStartHistoryStorePort {
  const suffix = options.scopeKey ? `:${options.scopeKey}` : "";
  const historyKey = options.historyKey ?? `${AUTO_START_HISTORY_SETTING_KEY}${suffix}`;
  const settingsKey = options.settingsKey ?? `${AUTO_START_SETTINGS_SETTING_KEY}${suffix}`;

  return {
    readHistory(): readonly AutoStartHistoryEntry[] {
      const raw = globalDb.getSetting(historyKey);
      if (raw === undefined || raw === null) return [];
      if (!Array.isArray(raw)) {
        throw new PlanPreviewError("corrupt_auto_start_history", "Auto-start history setting must be an array");
      }
      const entries: AutoStartHistoryEntry[] = [];
      for (const item of raw) {
        if (!isRecord(item)) continue;
        entries.push({
          atMs: parseIntField(item.atMs, "atMs"),
          costMicroUsd: parseBigIntField(item.costMicroUsd, "costMicroUsd"),
          windowPpm: parseIntField(item.windowPpm, "windowPpm"),
        });
      }
      return entries;
    },

    writeHistory(entries: readonly AutoStartHistoryEntry[]): void {
      const payload = entries.map((entry) => ({
        atMs: entry.atMs,
        costMicroUsd: entry.costMicroUsd.toString(),
        windowPpm: entry.windowPpm,
      }));
      globalDb.setSetting(historyKey, payload);
    },

    readSettings(): Partial<AutoStartSettings> | undefined {
      const raw = globalDb.getSetting(settingsKey);
      if (raw === undefined || raw === null) return undefined;
      if (!isRecord(raw)) {
        throw new PlanPreviewError("corrupt_auto_start_settings", "Auto-start settings must be an object");
      }
      return {
        ...(raw.deltaTasksCeiling === undefined
          ? {}
          : { deltaTasksCeiling: parseIntField(raw.deltaTasksCeiling, "deltaTasksCeiling") }),
        ...(raw.deltaCostCeilingMicroUsd === undefined
          ? {}
          : { deltaCostCeilingMicroUsd: parseBigIntField(raw.deltaCostCeilingMicroUsd, "deltaCostCeilingMicroUsd") }),
        ...(raw.deltaWindowCeilingPpm === undefined
          ? {}
          : { deltaWindowCeilingPpm: parseIntField(raw.deltaWindowCeilingPpm, "deltaWindowCeilingPpm") }),
        ...(raw.dailyCapMicroUsd === undefined
          ? {}
          : { dailyCapMicroUsd: parseBigIntField(raw.dailyCapMicroUsd, "dailyCapMicroUsd") }),
        ...(raw.dailyWindowCapPpm === undefined
          ? {}
          : { dailyWindowCapPpm: parseIntField(raw.dailyWindowCapPpm, "dailyWindowCapPpm") }),
      };
    },

    writeSettings(settings: AutoStartSettings): void {
      globalDb.setSetting(settingsKey, {
        deltaTasksCeiling: settings.deltaTasksCeiling,
        deltaCostCeilingMicroUsd: settings.deltaCostCeilingMicroUsd.toString(),
        deltaWindowCeilingPpm: settings.deltaWindowCeilingPpm,
        dailyCapMicroUsd: settings.dailyCapMicroUsd.toString(),
        dailyWindowCapPpm: settings.dailyWindowCapPpm,
      });
    },
  };
}

class EphemeralAutoStartStore implements AutoStartHistoryStorePort {
  private entries: AutoStartHistoryEntry[] = [];
  private settings: AutoStartSettings | undefined;

  readHistory(): readonly AutoStartHistoryEntry[] {
    return this.entries;
  }

  writeHistory(entries: readonly AutoStartHistoryEntry[]): void {
    this.entries = [...entries];
  }

  readSettings(): Partial<AutoStartSettings> | undefined {
    return this.settings;
  }

  writeSettings(settings: AutoStartSettings): void {
    this.settings = { ...settings };
  }
}

export interface RevisionAutoStartPolicyOptions {
  readonly globalDb?: GlobalBrokerDb;
  readonly store?: AutoStartHistoryStorePort;
  readonly scopeKey?: string;
  readonly historyKey?: string;
  readonly settingsKey?: string;
}

function isGlobalBrokerDb(value: GlobalBrokerDb | RevisionAutoStartPolicyOptions): value is GlobalBrokerDb {
  return "getSetting" in value && "setSetting" in value;
}

export class RevisionAutoStartPolicy {
  private readonly store: AutoStartHistoryStorePort;
  private readonly differ = new PlanSnapshotDiffer();

  constructor(options?: GlobalBrokerDb | RevisionAutoStartPolicyOptions) {
    if (options === undefined) {
      this.store = new EphemeralAutoStartStore();
    } else if (isGlobalBrokerDb(options)) {
      this.store = bindGlobalBrokerAutoStartStore(options);
    } else if (options.store !== undefined) {
      this.store = options.store;
    } else if (options.globalDb !== undefined) {
      this.store = bindGlobalBrokerAutoStartStore(options.globalDb, {
        ...(options.scopeKey === undefined ? {} : { scopeKey: options.scopeKey }),
        ...(options.historyKey === undefined ? {} : { historyKey: options.historyKey }),
        ...(options.settingsKey === undefined ? {} : { settingsKey: options.settingsKey }),
      });
    } else {
      this.store = new EphemeralAutoStartStore();
    }
  }

  static open(globalDb: GlobalBrokerDb, options: GlobalBrokerAutoStartStoreOptions = {}): RevisionAutoStartPolicy {
    return new RevisionAutoStartPolicy({ globalDb, ...options });
  }

  currentSettings(): AutoStartSettings {
    const stored = this.store.readSettings();
    if (stored === undefined) return { ...OWNER_AUTO_START_DEFAULTS };
    return clampSettings({ ...OWNER_AUTO_START_DEFAULTS }, stored).settings;
  }

  configure(input: Partial<AutoStartSettings>): { readonly settings: AutoStartSettings; readonly ceilingApplied: boolean } {
    const base = this.currentSettings();
    const result = clampSettings(base, input);
    this.store.writeSettings(result.settings);
    return result;
  }

  historySnapshot(): readonly AutoStartHistoryEntry[] {
    return [...this.store.readHistory()];
  }

  record(entry: AutoStartHistoryEntry): void {
    assertNonNegativeInt(entry.atMs, "atMs");
    assertNonNegativeBig(entry.costMicroUsd, "costMicroUsd");
    assertNonNegativeInt(entry.windowPpm, "windowPpm");
    const next = [...this.store.readHistory(), {
      atMs: entry.atMs,
      costMicroUsd: entry.costMicroUsd,
      windowPpm: entry.windowPpm,
    }];
    let maxAtMs = entry.atMs;
    for (const item of next) {
      if (item.atMs > maxAtMs) maxAtMs = item.atMs;
    }
    const pruned = next.filter((item) => item.atMs > maxAtMs - ROLLING_WINDOW_MS);
    this.store.writeHistory(pruned);
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

    const settings = this.currentSettings();
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
    if (candidate.deltaTasks > settings.deltaTasksCeiling) {
      reasons.push(
        `Needs approval: ${candidate.deltaTasks.toString()} tasks exceeds the ${settings.deltaTasksCeiling.toString()}-task ceiling`,
      );
    }
    if (candidate.deltaCostMicroUsd > settings.deltaCostCeilingMicroUsd) {
      reasons.push(
        candidate.connection === "api"
          ? `Needs approval: ${formatUsd(candidate.deltaCostMicroUsd)} exceeds the ${formatUsd(settings.deltaCostCeilingMicroUsd)} ceiling`
          : "Needs approval: revision exceeds the auto-start cost ceiling",
      );
    }
    if (candidate.deltaPlanWindowPpm > settings.deltaWindowCeilingPpm) {
      reasons.push(
        `Needs approval: ${formatWindowPercent(candidate.deltaPlanWindowPpm)} exceeds the ${formatWindowPercent(settings.deltaWindowCeilingPpm)} plan-window ceiling`,
      );
    }
    const daily = this.dailyCapReason(candidate, settings);
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

  private dailyCapReason(candidate: RevisionCandidate, settings: AutoStartSettings): string | null {
    const history = this.store.readHistory();
    const recent = history.filter(
      (entry) => entry.atMs > candidate.nowMs - ROLLING_WINDOW_MS && entry.atMs <= candidate.nowMs,
    );
    if (candidate.connection === "api") {
      const spent = recent.reduce((sum, entry) => sum + entry.costMicroUsd, 0n) + candidate.deltaCostMicroUsd;
      if (spent > settings.dailyCapMicroUsd) {
        return `Needs approval: rolling 24h auto-start spend exceeds ${formatUsd(settings.dailyCapMicroUsd)}`;
      }
      return null;
    }
    const spentPpm = recent.reduce((sum, entry) => sum + entry.windowPpm, 0) + candidate.deltaPlanWindowPpm;
    const capPpm = dailyWindowCapPpm(candidate.planWindowPpm, settings.dailyWindowCapPpm);
    if (spentPpm > capPpm) {
      return `Needs approval: rolling 24h auto-start spend exceeds ${formatWindowPercent(settings.dailyWindowCapPpm)} of the plan window`;
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

function clampSettings(
  base: AutoStartSettings,
  input: Partial<AutoStartSettings>,
): { readonly settings: AutoStartSettings; readonly ceilingApplied: boolean } {
  let ceilingApplied = false;
  const next = { ...base };
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
  return { settings: next, ceilingApplied };
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
