import { CodexRuntimeError } from "./errors.js";
import type { BurnRateWindowTrackerPort, ModelAllowanceWeightLearnerPort } from "./ports.js";
import { asNumber, asRecord, asString } from "./jsonrpc.js";
import { WIND_DOWN_PPM, percentToPpm, type CodexRateLimitSnapshot, type CodexWindowLimit } from "./types.js";

export interface RateLimitFeed {
  readonly snapshot: CodexRateLimitSnapshot;
  readonly deltaPrimaryPpm: number;
  readonly windDown: boolean;
  readonly pacingState: "normal" | "wind_down" | "window_exhausted";
  readonly kPer1kTokens: number | null;
}

export class CodexRateLimitBridge {
  private readonly previousPpm = new Map<string, number>();

  constructor(
    private readonly burn: BurnRateWindowTrackerPort,
    private readonly weights: ModelAllowanceWeightLearnerPort,
  ) {}

  ingest(input: {
    readonly connectionId: string;
    readonly modelId: string;
    readonly payload: unknown;
    readonly effectiveTokens: number;
    readonly phase: "session_start" | "turn_completed";
  }): RateLimitFeed {
    const snapshot = parseCodexRateLimits(input.payload);
    const key = `${input.connectionId}\u0000${input.modelId}`;
    const previous = this.previousPpm.get(key);
    const deltaPrimaryPpm = previous === undefined ? snapshot.primary.usedPpm : snapshot.primary.usedPpm - previous;
    this.previousPpm.set(key, snapshot.primary.usedPpm);
    const paced = this.burn.observe({
      connectionId: input.connectionId,
      modelId: input.modelId,
      primaryPpm: snapshot.primary.usedPpm,
      secondaryPpm: snapshot.secondary.usedPpm,
      primaryResetAt: snapshot.primary.resetAt,
      secondaryResetAt: snapshot.secondary.resetAt,
      deltaPrimaryPpm,
      phase: input.phase,
    });
    const learned = this.weights.observe({
      connectionId: input.connectionId,
      modelId: input.modelId,
      deltaPpm: deltaPrimaryPpm,
      effectiveTokens: input.effectiveTokens,
    });
    const windDown = paced.windDown || snapshot.primary.usedPpm >= WIND_DOWN_PPM;
    return {
      snapshot,
      deltaPrimaryPpm,
      windDown,
      pacingState: windDown ? paced.pacingState === "window_exhausted" ? "window_exhausted" : "wind_down" : paced.pacingState,
      kPer1kTokens: learned.kPer1kTokens,
    };
  }
}

export function parseCodexRateLimits(payload: unknown): CodexRateLimitSnapshot {
  const root = asRecord(payload);
  const body = asRecord(root?.rateLimits) ?? root;
  if (!body) {
    throw new CodexRuntimeError("bad_rate_limit", "account/rateLimits/read payload is missing");
  }
  return {
    primary: parseWindow(body.primary, "5h"),
    secondary: parseWindow(body.secondary, "7d"),
  };
}

function parseWindow(value: unknown, fallback: "5h" | "7d"): CodexWindowLimit {
  const record = asRecord(value);
  if (!record) {
    throw new CodexRuntimeError("bad_rate_limit", "rate limit window is missing");
  }
  const usedPercent = asNumber(record.usedPercent);
  if (usedPercent === null) {
    throw new CodexRuntimeError("bad_rate_limit", "rate limit usedPercent is missing");
  }
  const resetRaw = record.resetAt ?? record.resetsAt;
  const windowLabel = asString(record.window);
  const windowSeconds = asNumber(record.windowSeconds);
  const window = windowLabel === "5h" || windowLabel === "7d"
    ? windowLabel
    : windowSeconds !== null && windowSeconds >= 86_400
      ? "7d"
      : fallback;
  return {
    usedPercent,
    usedPpm: percentToPpm(usedPercent),
    resetAt: normalizeReset(resetRaw),
    window,
  };
}

function normalizeReset(value: unknown): string {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  throw new CodexRuntimeError("bad_rate_limit", "rate limit reset timestamp is missing");
}
