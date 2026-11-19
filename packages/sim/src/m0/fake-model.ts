import type { FakeDualClock } from "./clock.js";
import type { DeterministicSeededRng } from "./rng.js";

export const MODEL_OUTCOMES = [
  "text",
  "tool_sequence",
  "rate_limit",
  "stall",
  "malformed_json",
  "paid_timeout",
  "token_overrun",
] as const;

export type ModelOutcomeKind = (typeof MODEL_OUTCOMES)[number];

export interface ModelCompletion {
  kind: ModelOutcomeKind;
  text: string;
  tools: readonly string[];
  retryAfterMs: number;
  stallMs: number;
  raw: string;
  reservedTokens: number;
  actualTokens: number;
  /** Paid timeout whose provider can later name the exact charge. */
  reconcilable: boolean;
}

export interface ModelRequest {
  attempt: string;
  step: number;
}

const TOOLS = ["read_file", "write_file", "search", "run_check"] as const;

/**
 * In-memory model stub. Scripted steps win until they run out; otherwise the seed
 * picks the outcome. No network calls.
 */
export class FakeModelAdapter {
  private scriptIndex = 0;

  constructor(
    private readonly rng: DeterministicSeededRng,
    private readonly clock: FakeDualClock,
    private readonly script: readonly ModelCompletion[] = [],
  ) {}

  complete(request: ModelRequest): ModelCompletion {
    const scripted = this.script[this.scriptIndex];
    if (scripted) {
      this.scriptIndex += 1;
      return scripted;
    }
    const kind = this.rng.pick(MODEL_OUTCOMES);
    const reserved = 100_000;
    const base: ModelCompletion = {
      kind,
      text: "",
      tools: [],
      retryAfterMs: 0,
      stallMs: 0,
      raw: "",
      reservedTokens: reserved,
      actualTokens: reserved,
      reconcilable: false,
    };
    if (kind === "text") {
      return { ...base, text: `answer:${request.attempt}:${request.step}:${this.clock.wallMs()}` };
    }
    if (kind === "tool_sequence") {
      const count = this.rng.nextInt(1, TOOLS.length);
      const tools: string[] = [];
      for (let i = 0; i < count; i += 1) {
        tools.push(this.rng.pick(TOOLS));
      }
      return { ...base, tools, text: tools.join(",") };
    }
    if (kind === "rate_limit") {
      return { ...base, retryAfterMs: this.rng.nextInt(1, 5) * 1000, text: "429" };
    }
    if (kind === "stall") {
      return { ...base, stallMs: this.rng.nextInt(1, 20), text: "stall" };
    }
    if (kind === "malformed_json") {
      return { ...base, raw: "{\"tools\":[", text: "" };
    }
    if (kind === "paid_timeout") {
      return { ...base, reconcilable: this.rng.chance(0.5), text: "timeout" };
    }
    return { ...base, actualTokens: reserved + this.rng.nextInt(1, 50_000), text: "overrun" };
  }
}

export function scriptedCompletion(kind: ModelOutcomeKind, reconcilable = false): ModelCompletion {
  return {
    kind,
    text: kind === "malformed_json" ? "" : kind,
    tools: kind === "tool_sequence" ? ["read_file"] : [],
    retryAfterMs: kind === "rate_limit" ? 1000 : 0,
    stallMs: kind === "stall" ? 5 : 0,
    raw: kind === "malformed_json" ? "{\"broken\":" : "",
    reservedTokens: 100_000,
    actualTokens: kind === "token_overrun" ? 150_000 : 100_000,
    reconcilable: kind === "paid_timeout" ? reconcilable : false,
  };
}
