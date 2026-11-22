import { assertDiscoveryUrl } from "./loopback-url.js";
import type { LocalProbeResult } from "./ports.js";
import { SENIOR_CONTEXT_RECOMMENDED } from "./constants.js";

export const OFFLINE_PHASES = ["discover", "plan", "build", "verify", "run"] as const;
export type OfflinePhase = (typeof OFFLINE_PHASES)[number];

export interface OfflineRunPlan {
  readonly cloudCalls: 0;
  readonly phases: readonly OfflinePhase[];
  readonly workerModelId: string | null;
  readonly plannerModelId: string | null;
  readonly blockedReason: string | null;
}

export function planLocalOfflineRun(probes: readonly LocalProbeResult[]): OfflineRunPlan {
  const workers = probes.filter((probe) => probe.role === "coding_worker");
  const first = workers[0];
  if (first === undefined) {
    const warning = probes.find((probe) => probe.contextWarning !== null)?.contextWarning;
    return {
      cloudCalls: 0,
      phases: ["discover"],
      workerModelId: null,
      plannerModelId: null,
      blockedReason: warning ?? "no local model meets the coding capability floor",
    };
  }
  const planner = workers.find((probe) => (probe.contextTokens ?? 0) >= SENIOR_CONTEXT_RECOMMENDED) ?? first;
  return {
    cloudCalls: 0,
    phases: [...OFFLINE_PHASES],
    workerModelId: first.modelId,
    plannerModelId: planner.modelId,
    blockedReason: null,
  };
}

/** Local-only mode refuses any non-loopback URL before a socket is opened. */
export class LocalOnlyOfflineMode {
  readonly cloudCalls = 0 as const;

  guard(url: string): void {
    assertDiscoveryUrl(url, false);
  }

  plan(probes: readonly LocalProbeResult[]): OfflineRunPlan {
    return planLocalOfflineRun(probes);
  }
}
