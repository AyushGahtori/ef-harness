import type { AdapterBehavior, NormalizedUsageReceipt } from "./types.js";

const TOKEN_USAGE: NormalizedUsageReceipt = {
  inputTokens: 12,
  outputTokens: 4,
  cachedInputTokens: 0,
  reasoningTokens: 0,
};

export interface ForeignAdapterProfile {
  readonly adapterId: string;
  readonly displayName: string;
  readonly cliVersion: string;
  readonly sourceTask: number;
}

export const FOREIGN_ADAPTERS: readonly ForeignAdapterProfile[] = [
  { adapterId: "acp", displayName: "Generic ACP", cliVersion: "1.2.0", sourceTask: 143 },
  { adapterId: "codex", displayName: "Codex", cliVersion: "1.4.2", sourceTask: 144 },
  { adapterId: "copilot", displayName: "Copilot", cliVersion: "1.1.0", sourceTask: 145 },
  { adapterId: "cursor", displayName: "Cursor", cliVersion: "1.5.0", sourceTask: 146 },
  { adapterId: "claude-code", displayName: "Claude Code", cliVersion: "1.6.1", sourceTask: 147 },
  { adapterId: "gemini-cli", displayName: "Gemini CLI", cliVersion: "1.0.3", sourceTask: 148 },
  { adapterId: "opencode", displayName: "OpenCode", cliVersion: "1.2.4", sourceTask: 149 },
];

export function compliantBehavior(profile: ForeignAdapterProfile): AdapterBehavior {
  return {
    adapterId: profile.adapterId,
    displayName: profile.displayName,
    cliVersion: profile.cliVersion,
    violation: "none",
    escapesStrippedSandbox: false,
    nativeResumeWorks: true,
    resumeFallbackFails: false,
    readOnlyInspectionOnly: false,
    usage: TOKEN_USAGE,
    sourceTask: profile.sourceTask,
  };
}

export interface RogueProfile {
  readonly adapterId: string;
  readonly displayName: string;
  readonly cliVersion: string;
  readonly violation: "P02" | "P05" | "P06" | "P07";
  readonly escapesStrippedSandbox: boolean;
  readonly readOnlyInspectionOnly: boolean;
}

export function rogueBehavior(profile: RogueProfile): AdapterBehavior {
  return {
    adapterId: profile.adapterId,
    displayName: profile.displayName,
    cliVersion: profile.cliVersion,
    violation: profile.violation,
    escapesStrippedSandbox: profile.escapesStrippedSandbox,
    nativeResumeWorks: true,
    resumeFallbackFails: false,
    readOnlyInspectionOnly: profile.readOnlyInspectionOnly,
    usage: TOKEN_USAGE,
  };
}

export const STRIPPED_ROGUES: readonly RogueProfile[] = [
  {
    adapterId: "rogue-p02",
    displayName: "Codex",
    cliVersion: "2.3.0",
    violation: "P02",
    escapesStrippedSandbox: false,
    readOnlyInspectionOnly: false,
  },
  {
    adapterId: "rogue-p05",
    displayName: "Claude Code",
    cliVersion: "2.4.0",
    violation: "P05",
    escapesStrippedSandbox: false,
    readOnlyInspectionOnly: false,
  },
  {
    adapterId: "rogue-p06",
    displayName: "Copilot",
    cliVersion: "2.5.0",
    violation: "P06",
    escapesStrippedSandbox: false,
    readOnlyInspectionOnly: false,
  },
  {
    adapterId: "rogue-p07",
    displayName: "Cursor",
    cliVersion: "2.6.0",
    violation: "P07",
    escapesStrippedSandbox: false,
    readOnlyInspectionOnly: false,
  },
];

export const DISABLED_ROGUES: readonly RogueProfile[] = [
  {
    adapterId: "rogue-p02-disabled",
    displayName: "Codex",
    cliVersion: "3.0.0",
    violation: "P02",
    escapesStrippedSandbox: true,
    readOnlyInspectionOnly: false,
  },
  {
    adapterId: "rogue-p05-disabled",
    displayName: "Claude Code",
    cliVersion: "3.1.0",
    violation: "P05",
    escapesStrippedSandbox: true,
    readOnlyInspectionOnly: false,
  },
  {
    adapterId: "rogue-p06-disabled",
    displayName: "Copilot",
    cliVersion: "3.2.0",
    violation: "P06",
    escapesStrippedSandbox: true,
    readOnlyInspectionOnly: false,
  },
  {
    adapterId: "rogue-p07-disabled",
    displayName: "Cursor",
    cliVersion: "3.3.0",
    violation: "P07",
    escapesStrippedSandbox: true,
    readOnlyInspectionOnly: false,
  },
];
