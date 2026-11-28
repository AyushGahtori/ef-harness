export interface WelcomeBackModel {
  readonly showWelcome: boolean;
  readonly projectName: string;
  readonly lastActiveLabel: string;
  readonly whereWeLeftOff: readonly string[];
  readonly whatChanged: readonly string[];
  readonly readyLines: readonly string[];
  readonly folderMissing: boolean;
  readonly blockedUntilResume: boolean;
}

export type WelcomeActionId = "resume_build" | "review_drift_first" | "stay_paused" | "locate_folder";

export interface WelcomeButton {
  readonly id: WelcomeActionId;
  readonly label: "Resume Build" | "Review Drift First" | "Stay Paused" | "Locate folder";
  readonly enabled: boolean;
}

export interface WelcomeChoice {
  readonly action: "Resume Build" | "Review Drift First" | "Stay Paused" | "Locate folder";
  readonly runWorkers: false;
  readonly editFiles: false;
  readonly spendTokens: false;
  readonly mutateGit: false;
}
