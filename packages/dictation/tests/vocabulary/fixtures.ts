import type { DictationClock, VocabularyEntry, VocabularySource } from "../../src/vocabulary/index.js";

export const fixedClock: DictationClock = { now: () => 1_700_000_000_000 };

export function entry(input: {
  readonly term: string;
  readonly project_id: string;
  readonly weight?: number;
  readonly source?: VocabularySource;
  readonly correction_from?: string | null;
  readonly heard_forms?: readonly string[];
  readonly occurrence_count?: number;
  readonly occurrence_ids?: readonly string[];
  readonly last_used_at?: number;
  readonly suppressed?: boolean;
}): VocabularyEntry {
  const correctionFrom = input.correction_from === undefined ? null : input.correction_from;
  return {
    term: input.term,
    project_id: input.project_id,
    weight: input.weight ?? 100,
    source: input.source ?? "user_manual",
    correction_from: correctionFrom,
    heard_forms: input.heard_forms ?? (correctionFrom ? [correctionFrom] : []),
    occurrence_count: input.occurrence_count ?? 0,
    occurrence_ids: input.occurrence_ids ?? [],
    last_used_at: input.last_used_at ?? fixedClock.now(),
    suppressed: input.suppressed ?? false,
  };
}
