import { welcomeLastActiveLabel } from "./cold-open-reconciler.js";
import type { ColdOpenInput, ColdOpenReport, GatePhase } from "./types.js";

export interface WelcomeBackModel {
  readonly showWelcome: boolean;
  readonly projectName: string;
  readonly lastActiveLabel: string;
  readonly whereWeLeftOff: readonly string[];
  readonly whatChanged: readonly string[];
  readonly readyLines: readonly string[];
  readonly folderMissing: boolean;
  readonly blockedUntilResume: boolean;
  readonly gatePhase: GatePhase;
}

export function toWelcomeBackModel(report: ColdOpenReport, input: ColdOpenInput): WelcomeBackModel {
  const blockedUntilResume = report.gate.phase !== "OPEN" && report.gate.phase !== "RESUMED";
  return {
    showWelcome: report.showWelcome,
    projectName: input.snapshot.projectName,
    lastActiveLabel: welcomeLastActiveLabel(input),
    whereWeLeftOff: report.whereWeLeftOff,
    whatChanged: report.whatChanged,
    readyLines: report.readyLines,
    folderMissing: report.folderMissing,
    blockedUntilResume,
    gatePhase: report.gate.phase,
  };
}
