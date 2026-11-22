export const PAUSE_AND_QUIT_BUDGET_MS = 10_000;
export const IDLE_QUIT_BUDGET_MS = 1_000;
export const SHORT_SLEEP_MS = 10 * 60 * 1000;
export const WELCOME_BACK_SLEEP_MS = 30 * 60 * 1000;
export const LOW_BATTERY_PERCENT = 20;
export const HIDDEN_TRAY_ARG = "--hidden-tray";
export const PREVENT_APP_SUSPENSION = "prevent-app-suspension";
export const MINIMIZE_TO_TRAY_PREFERENCE_KEY = "window.close.minimizeToTray";

export const QUIT_CHOICES = [
  {
    id: "keep-building-in-background",
    label: "Keep building in background (Minimize to tray)",
    shortLabel: "Keep building in tray",
  },
  {
    id: "pause-safely-and-quit",
    label: "Pause safely & Quit",
    shortLabel: "Pause safely & Quit",
  },
  {
    id: "cancel",
    label: "Cancel (Stay open)",
    shortLabel: "Cancel",
  },
] as const;

export type QuitChoiceId = (typeof QUIT_CHOICES)[number]["id"];
export type QuitSource = "alt+f4" | "tray" | "file-menu" | "before-quit" | "window-x";

export type ExecutionState =
  | "IDLE"
  | "BUILDING"
  | "VERIFYING"
  | "MERGE_QUEUE"
  | "DONE"
  | "PAUSED"
  | "STOPPED"
  | "WAITING_ON_USER";

export interface BuildActivity {
  readonly state: ExecutionState;
  readonly projectName: string;
  readonly activeWorkers: number;
  readonly questionsNeedingYou: number;
  readonly verificationActive: boolean;
  readonly mergeQueueActive: boolean;
  readonly backgroundSyncActive: boolean;
  readonly batteryPercent: number | null;
  readonly waveLabel: string | null;
  readonly priorityCard: "P0" | null;
}

export function idleActivity(overrides: Partial<BuildActivity> = {}): BuildActivity {
  return {
    state: "IDLE",
    projectName: "",
    activeWorkers: 0,
    questionsNeedingYou: 0,
    verificationActive: false,
    mergeQueueActive: false,
    backgroundSyncActive: false,
    batteryPercent: null,
    waveLabel: null,
    priorityCard: null,
    ...overrides,
  };
}

export function hasActiveExecution(activity: BuildActivity): boolean {
  if (
    activity.state === "BUILDING" ||
    activity.state === "VERIFYING" ||
    activity.state === "MERGE_QUEUE"
  ) {
    return true;
  }
  return activity.verificationActive || activity.mergeQueueActive;
}

export type TrayBadge = "green" | "amber" | "neutral";
export type WakeBand = "under_10_min" | "between_10_and_30_min" | "over_30_min";
export type ShutdownMode = "drain_and_exit" | "detach_ui_keep_running";
export type WalCheckpointMode = "PASSIVE" | "TRUNCATE";

export interface WalCheckpointResult {
  readonly busy: number;
  readonly log: number;
  readonly checkpointed: number;
}

export interface QuitPrompt {
  readonly title: "Quit while building?";
  readonly source: QuitSource;
  readonly choices: typeof QUIT_CHOICES;
}

export interface ClosePrompt {
  readonly title: "Minimize to tray";
  readonly body: "A build is still running. Closing the window keeps it building in the tray.";
  readonly confirmLabel: "Minimize to tray";
  readonly rememberLabel: "Don't ask again";
  readonly cancelLabel: "Stay open";
}

export function wakeBand(sleepDurationMs: number): WakeBand {
  if (sleepDurationMs < SHORT_SLEEP_MS) return "under_10_min";
  if (sleepDurationMs <= WELCOME_BACK_SLEEP_MS) return "between_10_and_30_min";
  return "over_30_min";
}

export function formatSleepDuration(sleepDurationMs: number): string {
  const totalMinutes = Math.max(0, Math.round(sleepDurationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes === 0) return `${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function questionStatusLine(count: number): string {
  if (count === 1) return "1 question needs you";
  return `${count} questions need you`;
}

export function buildingStatusLine(projectName: string, workers: number): string {
  const noun = workers === 1 ? "worker" : "workers";
  return `Building ${projectName} · ${workers} ${noun} active`;
}

export function trayStatusLine(activity: BuildActivity): string {
  if (activity.questionsNeedingYou > 0) return questionStatusLine(activity.questionsNeedingYou);
  if (activity.state === "BUILDING" || (hasActiveExecution(activity) && activity.activeWorkers > 0 && activity.state !== "VERIFYING" && activity.state !== "MERGE_QUEUE")) {
    return buildingStatusLine(activity.projectName, activity.activeWorkers);
  }
  if (activity.state === "VERIFYING" || activity.verificationActive) {
    return `Verifying ${activity.projectName}`;
  }
  if (activity.state === "MERGE_QUEUE" || activity.mergeQueueActive) {
    return `Merge queue · ${activity.projectName}`;
  }
  return "Idle";
}

export function trayBadge(activity: BuildActivity): TrayBadge {
  if (activity.questionsNeedingYou > 0) return "amber";
  if (hasActiveExecution(activity)) return "green";
  return "neutral";
}

export function welcomeBackMessage(
  sleepDurationMs: number,
  health: {
    readonly networkOnline: boolean;
    readonly repoChanged: boolean;
    readonly providerReachable: boolean;
    readonly localDbHealthy: boolean;
    readonly testEnvHealthy: boolean;
  },
): string {
  const duration = formatSleepDuration(sleepDurationMs);
  if (!health.networkOnline) {
    return `Paused while laptop slept (${duration}) · Offline — Resume when back online`;
  }
  if (health.repoChanged) {
    return `Paused while laptop slept (${duration}) · Repository changed — Review before resume`;
  }
  if (!health.providerReachable) {
    return `Paused while laptop slept (${duration}) · Provider unreachable — Resume when back online`;
  }
  if (!health.localDbHealthy || !health.testEnvHealthy) {
    return `Paused while laptop slept (${duration}) · Local environment needs a check before resume`;
  }
  return `Paused while laptop slept (${duration}) · Welcome back`;
}

export function assertExactQuitChoices(choices: typeof QUIT_CHOICES): void {
  if (choices.length !== 3) {
    throw new Error("Quit while building must offer exactly 3 choices");
  }
  const [keep, pause, cancel] = choices;
  if (
    keep?.label !== "Keep building in background (Minimize to tray)" ||
    keep.shortLabel !== "Keep building in tray" ||
    pause?.label !== "Pause safely & Quit" ||
    cancel?.shortLabel !== "Cancel" ||
    cancel.label !== "Cancel (Stay open)"
  ) {
    throw new Error("Quit while building choices drifted from the desktop lifecycle contract");
  }
}
