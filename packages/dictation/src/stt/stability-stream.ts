import { normalizeHypothesis, tokenKey } from "./text.js";
import type { HypothesisToken, StabilityFrame, StableToken, TokenStability } from "./types.js";

/**
 * LocalAgreement-2 over a sliding decode window.
 * A token becomes confirmed (black) only when it occupies the same index in two
 * consecutive hypotheses. The latest frame's unmatched suffix stays tentative (grey).
 * Confirmed tokens are monotonic: a later frame cannot revoke them.
 */
export class DictationStabilityStream {
  private previous: HypothesisToken[] | null = null;
  private confirmed: HypothesisToken[] = [];

  reset(): void {
    this.previous = null;
    this.confirmed = [];
  }

  ingest(frame: readonly HypothesisToken[]): StabilityFrame {
    const tokens = frame
      .map((token, index) => normalizeHypothesis(token, index))
      .filter((token) => token.text.length > 0);
    if (this.previous === null) {
      this.previous = tokens;
      return this.view([], tokens);
    }
    const agreed = commonPrefixLength(this.previous, tokens);
    if (agreed > this.confirmed.length && prefixMatches(this.confirmed, tokens, this.confirmed.length)) {
      for (let index = this.confirmed.length; index < agreed; index += 1) {
        const token = tokens[index];
        if (token) this.confirmed.push(token);
      }
    }
    const refreshUntil = Math.min(agreed, this.confirmed.length);
    for (let index = 0; index < refreshUntil; index += 1) {
      const next = tokens[index];
      const prior = this.confirmed[index];
      if (!next || !prior) continue;
      if (tokenKey(next.text) !== tokenKey(prior.text)) continue;
      const refreshed: HypothesisToken = {
        text: prior.text,
        probability: next.probability,
        startMs: next.startMs ?? prior.startMs ?? 0,
        endMs: next.endMs ?? prior.endMs ?? 0,
      };
      const semanticClass = next.semanticClass ?? prior.semanticClass;
      this.confirmed[index] =
        semanticClass === undefined ? refreshed : { ...refreshed, semanticClass };
    }
    this.previous = tokens;
    const tentative = prefixMatches(this.confirmed, tokens, this.confirmed.length)
      ? tokens.slice(this.confirmed.length)
      : [];
    return this.view(this.confirmed, tentative);
  }

  private view(confirmed: readonly HypothesisToken[], tentative: readonly HypothesisToken[]): StabilityFrame {
    return {
      confirmed: confirmed.map((token, index) => toStable(token, `c${index}`, "confirmed")),
      tentative: tentative.map((token, index) => toStable(token, `t${index}`, "tentative")),
    };
  }
}

function commonPrefixLength(left: readonly HypothesisToken[], right: readonly HypothesisToken[]): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit) {
    const a = left[index];
    const b = right[index];
    if (!a || !b || tokenKey(a.text) !== tokenKey(b.text)) break;
    index += 1;
  }
  return index;
}

function prefixMatches(
  confirmed: readonly HypothesisToken[],
  candidate: readonly HypothesisToken[],
  count: number,
): boolean {
  if (candidate.length < count) return false;
  for (let index = 0; index < count; index += 1) {
    const left = confirmed[index];
    const right = candidate[index];
    if (!left || !right || tokenKey(left.text) !== tokenKey(right.text)) return false;
  }
  return true;
}

function toStable(token: HypothesisToken, id: string, stability: TokenStability): StableToken {
  const stable: StableToken = {
    id,
    text: token.text,
    probability: token.probability,
    stability,
    startMs: token.startMs ?? 0,
    endMs: token.endMs ?? 0,
  };
  if (token.semanticClass === undefined) return stable;
  return { ...stable, semanticClass: token.semanticClass };
}
