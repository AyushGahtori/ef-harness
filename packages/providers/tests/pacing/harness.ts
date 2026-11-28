import { DISK_HEADROOM_MIN_BYTES } from "../../src/pacing/index.js";
import {
  AllowancePacingController,
  InMemoryGlobalConnectionWindowRepo,
  RecordingAllowanceWeightSink,
  RecordingBoardHealth,
  RecordingBudgetLedger,
  RecordingWindDown,
} from "../../src/pacing/index.js";
import type {
  ConnectionRegistration,
  ProviderLimitSignal,
  ResumePreflightPort,
  SignedPolicyPriorPort,
} from "../../src/pacing/index.js";

export interface Clock {
  now: () => number;
  set: (value: number) => void;
  advance: (deltaMs: number) => void;
}

export function manualClock(start: number): Clock {
  let current = start;
  return {
    now: () => current,
    set: (value: number) => {
      current = value;
    },
    advance: (deltaMs: number) => {
      current += deltaMs;
    },
  };
}

export interface PacingHarness {
  readonly clock: Clock;
  readonly repo: InMemoryGlobalConnectionWindowRepo;
  readonly windDown: RecordingWindDown;
  readonly board: RecordingBoardHealth;
  readonly ledger: RecordingBudgetLedger;
  readonly weights: RecordingAllowanceWeightSink;
  readonly preflight: MutablePreflight;
  readonly controller: AllowancePacingController;
  readonly projectId: string;
}

export interface MutablePreflight extends ResumePreflightPort {
  healthy: boolean;
  conflicts: number;
  holds: number;
  freeBytes: number;
}

export function createHarness(
  projectId: string,
  startMs: number,
  policyPriors?: SignedPolicyPriorPort,
): PacingHarness {
  const clock = manualClock(startMs);
  const repo = new InMemoryGlobalConnectionWindowRepo();
  const windDown = new RecordingWindDown();
  const board = new RecordingBoardHealth();
  const ledger = new RecordingBudgetLedger();
  const weights = new RecordingAllowanceWeightSink();
  const preflight: MutablePreflight = {
    healthy: true,
    conflicts: 0,
    holds: 0,
    freeBytes: DISK_HEADROOM_MIN_BYTES + 1024,
    connectionHealthy: () => preflight.healthy,
    pendingConflicts: () => preflight.conflicts,
    pendingHolds: () => preflight.holds,
    diskFreeBytes: () => preflight.freeBytes,
  };
  const controller = new AllowancePacingController({
    projectId,
    repo,
    windDown,
    board,
    ledger,
    weightSink: weights,
    preflight,
    policyPriors,
    now: () => clock.now(),
    random: () => 0,
  });
  return { clock, repo, windDown, board, ledger, weights, preflight, controller, projectId };
}

export function chatGptRegistration(
  startMs: number,
  reserveFraction = 0.2,
  caps: { connectionMaxCap: number; hardwareCap: number } = {
    connectionMaxCap: 8,
    hardwareCap: 8,
  },
): ConnectionRegistration {
  return {
    connectionId: "chatgpt-plus",
    provider: "chatgpt",
    reserveFraction,
    connectionMaxCap: caps.connectionMaxCap,
    hardwareCap: caps.hardwareCap,
    windows: [
      {
        kind: "5h",
        windowStartMs: startMs,
        windowEndMs: startMs + 5 * 60 * 60 * 1000,
      },
    ],
    priors: [{ modelId: "gpt-5.x-mini", ppmPer1k: 1_000 }],
  };
}

export function signal(partial: {
  readonly nowMs: number;
  readonly httpStatus?: number | null;
  readonly bodyText?: string;
  readonly retryAfterSeconds?: number | null;
  readonly remainingPercent?: number | null;
  readonly copilotRemaining?: number | null;
  readonly openRouterCredit?: number | null;
  readonly resetAtMs?: number | null;
}): ProviderLimitSignal {
  return {
    httpStatus: partial.httpStatus ?? null,
    bodyText: partial.bodyText ?? "",
    retryAfterSeconds: partial.retryAfterSeconds ?? null,
    remainingPercent: partial.remainingPercent ?? null,
    copilotRemaining: partial.copilotRemaining ?? null,
    openRouterCredit: partial.openRouterCredit ?? null,
    nowMs: partial.nowMs,
    resetAtMs: partial.resetAtMs ?? null,
  };
}
