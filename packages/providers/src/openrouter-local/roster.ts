import { JUNIOR_CONTEXT_FLOOR, SENIOR_CONTEXT_RECOMMENDED } from "./constants.js";
import type { LocalProbeResult } from "./ports.js";

export interface PassPriorsDraft {
  readonly trivial: number;
  readonly standard: number;
  readonly complex: number;
  readonly critical: number;
}

export interface LocalRosterModelDraft {
  readonly modelId: string;
  readonly family: string;
  readonly provider: string;
  readonly connectionId: string;
  readonly tier: "junior" | "mid" | "senior" | "principal";
  readonly contextWindow: number;
  readonly supportsTools: boolean;
  readonly supportsStructuredJson: boolean;
  readonly supportsVision: false;
  readonly spendKind: "local";
  readonly inputMicroUsdPer1M: 0n;
  readonly outputMicroUsdPer1M: 0n;
  readonly cachedInputMicroUsdPer1M: 0n;
  readonly allowancePpmPer1M: 0n;
  readonly defaultPassPriors: PassPriorsDraft;
  readonly deprecatedAfter: null;
  readonly pinned: false;
}

/** Shape consumed by Task 106 `VersionedModelRoster.applyLocalCapabilities`. */
export interface LocalModelCapabilitiesUpdate {
  readonly source: "ollama" | "lm-studio";
  readonly models: readonly LocalRosterModelDraft[];
}

const JUNIOR_PRIORS: PassPriorsDraft = {
  trivial: 0.9,
  standard: 0.62,
  complex: 0.28,
  critical: 0.12,
};

const SENIOR_PRIORS: PassPriorsDraft = {
  trivial: 0.98,
  standard: 0.94,
  complex: 0.9,
  critical: 0.78,
};

export function toLocalModelCapabilities(input: {
  readonly source: "ollama" | "lm-studio";
  readonly connectionId: string;
  readonly familyByModel: Readonly<Record<string, string>>;
  readonly probes: readonly LocalProbeResult[];
}): LocalModelCapabilitiesUpdate {
  return {
    source: input.source,
    models: input.probes
      .filter((probe) => probe.server === input.source)
      .map((probe) => draftFor(probe, input.connectionId, input.familyByModel[probe.modelId] ?? probe.modelId)),
  };
}

function draftFor(probe: LocalProbeResult, connectionId: string, family: string): LocalRosterModelDraft {
  const coding = probe.role === "coding_worker";
  const contextWindow = probe.contextTokens ?? 2_048;
  const senior = coding && contextWindow >= SENIOR_CONTEXT_RECOMMENDED;
  const tools = coding && probe.supportsTools && contextWindow >= JUNIOR_CONTEXT_FLOOR;
  const json = coding && probe.supportsStructuredJson && contextWindow >= JUNIOR_CONTEXT_FLOOR;
  return {
    modelId: probe.modelId,
    family,
    provider: probe.server,
    connectionId,
    tier: senior ? "senior" : "junior",
    contextWindow,
    supportsTools: tools,
    supportsStructuredJson: json,
    supportsVision: false,
    spendKind: "local",
    inputMicroUsdPer1M: 0n,
    outputMicroUsdPer1M: 0n,
    cachedInputMicroUsdPer1M: 0n,
    allowancePpmPer1M: 0n,
    defaultPassPriors: senior ? SENIOR_PRIORS : JUNIOR_PRIORS,
    deprecatedAfter: null,
    pinned: false,
  };
}
