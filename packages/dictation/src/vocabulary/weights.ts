import type { VocabularyEntry } from "./types.js";

/**
 * Composite priority, highest tier last in the Whisper prompt:
 * focused / recently edited > user-corrected > feature/entity > tech stack > older.
 */
export const PROMPT_TIER = {
  older: 1,
  techStack: 2,
  entity: 3,
  userCorrected: 4,
  focused: 5,
} as const;

export const WEIGHT = {
  older: 100,
  userManual: 180,
  techStack: 300,
  entity: 500,
  userCorrection: 800,
  neighbor: 1_000,
  focused: 1_010,
} as const;

export function weightForSource(source: VocabularyEntry["source"]): number {
  switch (source) {
    case "user_correction":
      return WEIGHT.userCorrection;
    case "entity_auto":
      return WEIGHT.entity;
    case "tech_stack":
      return WEIGHT.techStack;
    case "user_manual":
      return WEIGHT.userManual;
  }
}

export function tierForEntry(
  entry: Pick<VocabularyEntry, "source" | "occurrence_count" | "suppressed">,
  focused: boolean,
): number {
  if (focused) return PROMPT_TIER.focused;
  if (
    entry.source === "user_correction" &&
    entry.occurrence_count >= 2 &&
    !entry.suppressed
  ) {
    return PROMPT_TIER.userCorrected;
  }
  if (entry.source === "entity_auto") return PROMPT_TIER.entity;
  if (entry.source === "tech_stack") return PROMPT_TIER.techStack;
  return PROMPT_TIER.older;
}
