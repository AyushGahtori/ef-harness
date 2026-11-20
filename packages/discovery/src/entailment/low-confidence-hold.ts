import type { CitedExcerpt, JsonValue, ValueKind } from "./types.js";

const HELD_KINDS = new Set<ValueKind>(["time", "amount", "count", "behavioral_name"]);

export interface ConfidenceAssessment {
  readonly held: boolean;
  readonly summary: string | null;
}

/**
 * A low-confidence dictated time, amount, count, or behavioral name stays open.
 * The post-Send summary echoes the uncertain value in bold.
 */
export class LowConfidenceDictationHold {
  assess(input: { readonly proposedValue: JsonValue; readonly excerpts: readonly CitedExcerpt[] }): ConfidenceAssessment {
    const uncertain = input.excerpts.find((excerpt) => excerpt.lowConfidence && HELD_KINDS.has(excerpt.valueKind));
    if (!uncertain) return { held: false, summary: null };
    const shown =
      typeof input.proposedValue === "string" || typeof input.proposedValue === "number"
        ? String(input.proposedValue)
        : uncertain.quote;
    return {
      held: true,
      summary: `Uncertain dictated value **${shown}** is held open until you confirm it.`,
    };
  }
}
