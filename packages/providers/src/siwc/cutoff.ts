import { CHARS_PER_TOKEN, DEGENERATE_RUN_CHARS, OUTPUT_TOKEN_CEILING, STREAM_WALL_CLOCK_MS } from "./constants.js";

export interface StreamCutoffOptions {
  readonly outputTokenCeiling?: number;
  readonly degenerateRunChars?: number;
  readonly wallClockMs?: number;
  readonly charsPerToken?: number;
  readonly now?: () => number;
}

export interface CutoffSnapshot {
  readonly finishReason: "client_stream_cutoff";
  readonly text: string;
  readonly outputTokens: number;
  readonly outputChars: number;
}

export function estimateOutputTokens(chars: number, charsPerToken = CHARS_PER_TOKEN): number {
  if (chars <= 0) return 0;
  return Math.ceil(chars / charsPerToken);
}

export function trailingRepeatLength(text: string, maxPattern = 64): number {
  const tail = text.length > 8_192 ? text.slice(-8_192) : text;
  const limit = Math.min(maxPattern, Math.floor(tail.length / 3));
  let best = 0;
  for (let size = 1; size <= limit; size += 1) {
    const pattern = tail.slice(tail.length - size);
    let length = 0;
    let offset = tail.length;
    while (offset >= size && tail.slice(offset - size, offset) === pattern) {
      length += size;
      offset -= size;
    }
    if (length >= size * 3 && length > best) best = length;
  }
  return best;
}

/**
 * Client-side output ceiling for the ChatGPT direct route, which rejects max_output_tokens.
 * A trip aborts the supplied AbortController.
 */
export class SiwcStreamCutoffGuard {
  private readonly controller: AbortController;
  private readonly ceiling: number;
  private readonly degenerateRunChars: number;
  private readonly wallClockMs: number;
  private readonly charsPerToken: number;
  private readonly now: () => number;
  private readonly startedAt: number;
  private text = "";
  private chars = 0;
  private tokens = 0;
  private cut: CutoffSnapshot | null = null;

  constructor(controller: AbortController, options: StreamCutoffOptions = {}) {
    this.controller = controller;
    this.ceiling = options.outputTokenCeiling ?? OUTPUT_TOKEN_CEILING;
    this.degenerateRunChars = options.degenerateRunChars ?? DEGENERATE_RUN_CHARS;
    this.wallClockMs = options.wallClockMs ?? STREAM_WALL_CLOCK_MS;
    this.charsPerToken = options.charsPerToken ?? CHARS_PER_TOKEN;
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
  }

  didCutoff(): boolean {
    return this.cut !== null;
  }

  output(): { readonly text: string; readonly outputTokens: number; readonly outputChars: number } {
    return { text: this.text, outputTokens: this.tokens, outputChars: this.chars };
  }

  snapshot(): CutoffSnapshot | null {
    return this.cut;
  }

  pushText(delta: string): CutoffSnapshot | null {
    if (this.cut) return this.cut;
    this.text += delta;
    this.chars += delta.length;
    this.tokens = Math.max(this.tokens, estimateOutputTokens(this.chars, this.charsPerToken));
    if (this.text.length > 64_000) this.text = this.text.slice(-16_384);
    if (this.tokens > this.ceiling) return this.trip();
    if (trailingRepeatLength(this.text) > this.degenerateRunChars) return this.trip();
    if (this.overClock()) return this.trip();
    return null;
  }

  noteUsage(outputTokens: number): CutoffSnapshot | null {
    if (this.cut) return this.cut;
    if (Number.isFinite(outputTokens) && outputTokens >= 0) this.tokens = outputTokens;
    if (this.tokens > this.ceiling) return this.trip();
    return null;
  }

  checkClock(): CutoffSnapshot | null {
    if (this.cut) return this.cut;
    if (this.overClock()) return this.trip();
    return null;
  }

  private overClock(): boolean {
    return this.now() - this.startedAt > this.wallClockMs;
  }

  private trip(): CutoffSnapshot {
    if (!this.cut) {
      this.cut = {
        finishReason: "client_stream_cutoff",
        text: this.text,
        outputTokens: this.tokens,
        outputChars: this.chars,
      };
      this.controller.abort();
    }
    return this.cut;
  }
}
