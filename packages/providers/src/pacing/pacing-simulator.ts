import { AllowancePacingController } from "./allowance-pacing-controller.js";
import { FIVE_HOUR_MS } from "./constants.js";
import { InMemoryGlobalConnectionWindowRepo } from "./global-connection-window-repo.js";
import {
  RecordingAllowanceWeightSink,
  RecordingBoardHealth,
  RecordingBudgetLedger,
  RecordingWindDown,
} from "./local-ports.js";
import type { FiveHourSimulationReport, ProviderLimitSignal } from "./types.js";

export interface FiveHourSimulationOptions {
  readonly windowStartMs?: number;
  readonly truePpmPer1k?: number;
  readonly priorPpmPer1k?: number;
  readonly taskCount?: number;
  readonly reserveFraction?: number;
}

const TURN_MS = 30_000;
const MODEL_ID = "gpt-5.x-mini";

/**
 * Discrete-event 5-hour ChatGPT Plus window.
 * Thirty tasks, token spikes, one transient 429, k[model] calibration, and a 20% personal reserve.
 */
export async function simulateFiveHourChatGptPlusWindow(
  options: FiveHourSimulationOptions = {},
): Promise<FiveHourSimulationReport> {
  const windowStartMs = options.windowStartMs ?? Date.UTC(2026, 10, 22, 12, 0, 0);
  const truePpmPer1k = options.truePpmPer1k ?? 2_500;
  const priorPpmPer1k = options.priorPpmPer1k ?? 4_000;
  const taskCount = options.taskCount ?? 30;
  const reserveFraction = options.reserveFraction ?? 0.2;
  const windowEndMs = windowStartMs + FIVE_HOUR_MS;
  const clock = { t: windowStartMs };
  const repo = new InMemoryGlobalConnectionWindowRepo();
  const controller = new AllowancePacingController({
    projectId: "sim-project",
    repo,
    windDown: new RecordingWindDown(),
    board: new RecordingBoardHealth(),
    ledger: new RecordingBudgetLedger(),
    weightSink: new RecordingAllowanceWeightSink(),
    preflight: {
      connectionHealthy: () => true,
      pendingConflicts: () => 0,
      pendingHolds: () => 0,
      diskFreeBytes: () => 20 * 1024 * 1024 * 1024,
    },
    now: () => clock.t,
    random: () => 0,
  });
  const connectionId = "chatgpt-plus";
  await controller.registerConnection({
    connectionId,
    provider: "chatgpt",
    reserveFraction,
    connectionMaxCap: 8,
    hardwareCap: 8,
    windows: [
      { kind: "5h", windowStartMs, windowEndMs },
      { kind: "weekly", windowStartMs, windowEndMs: windowStartMs + 7 * 24 * 60 * 60 * 1000 },
    ],
    priors: [{ modelId: MODEL_ID, ppmPer1k: priorPpmPer1k }],
  });

  const started = await controller.telemetry(connectionId);
  const queue = buildTasks(taskCount);
  const inFlight: InFlight[] = [];
  let providerCalls = 0;
  const providerCallsAfterCwndZero = 0;
  let tasksCompleted = 0;
  let saw429Halving = false;
  let injected429 = false;
  let peakCwnd = started.cwnd;
  let minCwndAfter429 = started.cwnd;
  let guard = 0;

  while (clock.t < windowEndMs && guard < 20_000) {
    guard += 1;
    const due = inFlight.filter((item) => item.doneAt <= clock.t);
    for (const item of due) {
      const index = inFlight.indexOf(item);
      if (index >= 0) inFlight.splice(index, 1);
      if (!injected429 && tasksCompleted >= 8) {
        injected429 = true;
        const before = (await controller.telemetry(connectionId)).cwnd;
        await controller.observeProviderSignal({
          connectionId,
          grantId: item.grantId,
          signal: rateLimitSignal(clock.t),
        });
        const after = (await controller.telemetry(connectionId)).cwnd;
        saw429Halving = after === Math.max(1, Math.floor(before / 2)) && after < before;
        minCwndAfter429 = after;
        queue.unshift({ id: item.taskId, tokens: item.tokens });
      } else {
        const actualPpm = Math.round((item.tokens / 1_000) * truePpmPer1k);
        await controller.completeTurn({
          connectionId,
          grantId: item.grantId,
          actualPpm,
          effectiveTokens: item.tokens,
          modelId: MODEL_ID,
          deltaPpm: actualPpm,
          quotaSource: "rateLimits/read",
        });
        tasksCompleted += 1;
      }
    }

    const telemetry = await controller.telemetry(connectionId);
    if (telemetry.cwnd > peakCwnd) peakCwnd = telemetry.cwnd;
    if (injected429 && telemetry.cwnd > 0 && telemetry.cwnd < minCwndAfter429) {
      minCwndAfter429 = telemetry.cwnd;
    }

    let blockedRetryAt: number | null = null;
    let dispatched = false;
    while (queue.length > 0) {
      const next = queue[0];
      if (!next) break;
      const decision = await controller.requestSlot({
        connectionId,
        taskId: next.id,
        modelId: MODEL_ID,
        effectiveTokens: next.tokens,
        role: "senior-coding",
        priority: "background",
      });
      if (!decision.ok) {
        if (decision.retryAtMs !== null && decision.retryAtMs > clock.t) {
          blockedRetryAt = decision.retryAtMs;
        }
        break;
      }
      queue.shift();
      providerCalls += 1;
      dispatched = true;
      inFlight.push({
        grantId: decision.grantId,
        taskId: next.id,
        tokens: next.tokens,
        doneAt: clock.t + TURN_MS,
      });
    }

    if (inFlight.length > 0) {
      const nextDone = Math.min(...inFlight.map((item) => item.doneAt));
      if (nextDone > clock.t) clock.t = Math.min(windowEndMs, nextDone);
      else if (!dispatched) break;
      continue;
    }
    if (blockedRetryAt !== null) {
      clock.t = Math.min(windowEndMs, blockedRetryAt);
      continue;
    }
    break;
  }

  const finalTelemetry = await controller.telemetry(connectionId);
  const learned = await controller.weight(connectionId, MODEL_ID);
  return {
    startedCwnd: started.cwnd,
    peakCwnd,
    minCwndAfter429,
    saw429Halving,
    finalUsedPpm: finalTelemetry.windowUsedPpm,
    ceilingPpm: finalTelemetry.reserveCeilingPpm,
    tasksDispatched: providerCalls,
    tasksCompleted,
    tasksRemaining: queue.length + inFlight.length,
    learnedPpmPer1k: learned.ppmPer1k,
    truePpmPer1k,
    priorPpmPer1k,
    providerCalls,
    providerCallsAfterCwndZero,
    crossedReserve: finalTelemetry.windowUsedPpm > finalTelemetry.reserveCeilingPpm,
    windowMs: FIVE_HOUR_MS,
  };
}

interface SimTask {
  readonly id: string;
  readonly tokens: number;
}

interface InFlight {
  readonly grantId: string;
  readonly taskId: string;
  readonly tokens: number;
  readonly doneAt: number;
}

function buildTasks(count: number): SimTask[] {
  const tasks: SimTask[] = [];
  for (let index = 0; index < count; index += 1) {
    const spike = index % 5 === 0;
    tasks.push({ id: `wave-${index}`, tokens: spike ? 40_000 : 8_000 });
  }
  return tasks;
}

function rateLimitSignal(nowMs: number): ProviderLimitSignal {
  return {
    httpStatus: 429,
    bodyText: "rate_limit_exceeded: try again in 15s",
    retryAfterSeconds: null,
    remainingPercent: null,
    copilotRemaining: null,
    openRouterCredit: null,
    nowMs,
    resetAtMs: null,
  };
}
