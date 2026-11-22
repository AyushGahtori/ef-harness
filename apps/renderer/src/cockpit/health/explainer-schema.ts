import type { ExplanationBullets } from "./types.js";

export type ExplainerRejectReason = "essay" | "unknown_event_id" | "malformed" | "blocked";

export type ParsedExplainer =
  | {
      readonly ok: true;
      readonly shape: "three_bullet" | "two_sentence";
      readonly bullets: ExplanationBullets;
      readonly citedEventIds: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: ExplainerRejectReason;
    };

/**
 * Local port of Task 009 `CockpitExplainerV1Schema`.
 * Task 009 bounds model prose to two sentences. Task 125 also requires a
 * three-bullet answer. A two-sentence payload is accepted and the caller
 * supplies the third bullet from the deterministic next click.
 */
export class CockpitExplainerV1Schema {
  readonly contractId = "cockpit-explainer@1" as const;
  readonly maxSentences = 2 as const;

  parse(
    payload: unknown,
    knownEventIds: ReadonlySet<string>,
    recommendedNextClick: string,
  ): ParsedExplainer {
    if (!payload || typeof payload !== "object") {
      return { ok: false, reason: "malformed" };
    }
    const record = payload as Record<string, unknown>;
    if (record.blocked === true) {
      return { ok: false, reason: "blocked" };
    }
    if (typeof record.prose === "string" && countSentences(record.prose) > this.maxSentences) {
      return { ok: false, reason: "essay" };
    }

    const three = readThreeBullets(record);
    if (three === "essay") return { ok: false, reason: "essay" };
    const sentences = readSentences(record.sentences);
    if (sentences === "essay") return { ok: false, reason: "essay" };

    const cited = readCitations(record.citedEventIds);
    if (!cited) return { ok: false, reason: "malformed" };
    if (cited.length === 0 || cited.some((id) => !knownEventIds.has(id))) {
      return { ok: false, reason: "unknown_event_id" };
    }

    if (three) {
      return { ok: true, shape: "three_bullet", bullets: three, citedEventIds: cited };
    }
    if (sentences) {
      const first = sentences[0];
      const second = sentences[1] ?? first;
      if (!first || !second) return { ok: false, reason: "malformed" };
      return {
        ok: true,
        shape: "two_sentence",
        citedEventIds: cited,
        bullets: {
          whatItWasTryingToDo: first,
          whyItStalledOrFailed: second,
          recommendedNextClick: ensureSentence(`Recommended next click: ${recommendedNextClick}`),
        },
      };
    }

    return { ok: false, reason: "malformed" };
  }
}

function readCitations(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    return null;
  }
  return value as string[];
}

function readThreeBullets(record: Record<string, unknown>): ExplanationBullets | "essay" | null {
  const trying = record.whatItWasTryingToDo;
  const why = record.whyItStalledOrFailed;
  const next = record.recommendedNextClick;
  if (typeof trying !== "string" && typeof why !== "string" && typeof next !== "string") {
    return null;
  }
  if (typeof trying !== "string" || typeof why !== "string" || typeof next !== "string") {
    return "essay";
  }
  if (!isOneSentence(trying) || !isOneSentence(why) || !isOneSentence(next)) {
    return "essay";
  }
  return {
    whatItWasTryingToDo: trying.trim(),
    whyItStalledOrFailed: why.trim(),
    recommendedNextClick: next.trim(),
  };
}

function readSentences(value: unknown): string[] | "essay" | null {
  if (!Array.isArray(value)) return null;
  if (value.length < 1 || value.length > 2) return "essay";
  if (value.some((item) => typeof item !== "string" || !isOneSentence(item))) return "essay";
  return (value as string[]).map((item) => item.trim());
}

export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0).length;
}

export function isOneSentence(text: string): boolean {
  const trimmed = text.trim();
  return countSentences(trimmed) === 1 && /[.!?]$/.test(trimmed);
}

export function ensureSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "Nothing further was recorded.";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
