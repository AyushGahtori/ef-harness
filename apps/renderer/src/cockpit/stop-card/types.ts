export const ADD_BUDGET_PLUS_5_MICRO_USD = 5_000_000;
export const ADD_BUDGET_PLUS_10_MICRO_USD = 10_000_000;

export const RECOVERY_ACTION_IDS = [
  "add_budget",
  "cheaper_models",
  "switch_connection",
  "wait_for_reset",
  "finish_by_hand",
  "keep_parked",
] as const;

export type RecoveryActionId = (typeof RECOVERY_ACTION_IDS)[number];
export type BillingKind = "subscription" | "pay-per-use" | "local";
export type CrewLevel = "junior" | "mid" | "senior" | "principal";
export type StopTrigger = "budget_100" | "window_exhausted" | "user_stop" | "disk_red" | "subscription_wind_down";

export interface RemainingTaskFact {
  readonly taskId: string;
  readonly title: string;
  readonly floor: CrewLevel;
  readonly level: CrewLevel;
}

export interface ConnectionFact {
  readonly id: string;
  readonly label: string;
  readonly billing: BillingKind;
  readonly estimateMicroUsd: number | null;
  readonly remainingTasks: number | null;
}

export interface SubscriptionFact {
  readonly label: string;
  readonly windowKind: "5h" | "weekly";
  readonly resetAtMs: number;
  readonly usedPpm: number;
  readonly limitPpm: number;
}

export interface StopCardFacts {
  readonly trigger: StopTrigger;
  readonly finishedFeatures: readonly string[];
  readonly finishedTasksCount: number;
  readonly inFlightCheckpointedTasks: readonly string[];
  readonly remainingTasks: readonly RemainingTaskFact[];
  readonly spentSummary: string;
  readonly dollarCap: boolean;
  readonly subscription: SubscriptionFact | null;
  readonly connections: readonly ConnectionFact[];
  readonly activeConnectionId: string;
  readonly cheaperProjectedMicroUsd: number;
  readonly vscodeCommand: string | null;
  readonly officeLights: "day" | "evening";
  readonly savedLine: string;
}

export interface StopCardInteraction {
  readonly autoResumeAtReset: boolean;
  readonly switchTargetId: string | null;
  readonly switchConfirmed: boolean;
  readonly cheaperConfirmed: boolean;
  readonly customMicroUsd: number | null;
}

export interface RenderedAction {
  readonly id: RecoveryActionId;
  readonly label: string;
  readonly enabled: boolean;
  readonly highlighted: boolean;
  readonly hidden: boolean;
  readonly detail: string;
}

export interface RenderedStopCard {
  readonly html: string;
  readonly title: string;
  readonly spentSummary: string;
  readonly finishedFeatures: readonly string[];
  readonly finishedTasksCount: number;
  readonly inFlightCheckpointedTasks: readonly string[];
  readonly remainingTasksCount: number;
  readonly actions: readonly RenderedAction[];
  readonly visibleActions: readonly RenderedAction[];
  readonly confirmationText: string | null;
  readonly autoResumeAtReset: boolean;
  readonly vscodeCommand: string | null;
}

export interface AddBudgetIntent {
  readonly action: "add_budget";
  readonly kind: "plus_5" | "plus_10" | "custom";
  readonly deltaMicroUsd: number;
}

export function defaultInteraction(): StopCardInteraction {
  return {
    autoResumeAtReset: false,
    switchTargetId: null,
    switchConfirmed: false,
    cheaperConfirmed: false,
    customMicroUsd: null,
  };
}
