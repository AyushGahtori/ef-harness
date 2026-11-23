import { heardKey, preserveDeveloperCasing } from "./casing.js";
import { WEIGHT } from "./weights.js";
import {
  GLOBAL_PROJECT_ID,
  PROMOTION_OCCURRENCE_FLOOR,
  correctionTooltip,
  type CorrectionObservation,
  type CorrectedDictationDraft,
  type DictationClock,
  type DictationCorrectionSpan,
  type VocabularyEntry,
  type VocabularyStore,
} from "./types.js";

export interface CorrectionObservationInput {
  readonly projectId: string;
  readonly heard: string;
  readonly corrected: string;
  /** Distinct turn or edit id. Repeating it does not increment the occurrence floor. */
  readonly occurrenceId: string;
}

interface ActivePhrase {
  readonly heard: string;
  readonly corrected: string;
  readonly priority: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const heardPatternCache = new Map<string, RegExp>();

function heardPattern(heard: string): RegExp {
  const cached = heardPatternCache.get(heard);
  if (cached) return cached;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(heard)}(?![\\p{L}\\p{N}])`, "giu");
  heardPatternCache.set(heard, pattern);
  return pattern;
}

function createDraft(text: string, spans: readonly DictationCorrectionSpan[]): CorrectedDictationDraft {
  return {
    text,
    spans,
    undo(spanId: string): CorrectedDictationDraft {
      const span = spans.find((item) => item.id === spanId);
      if (!span) return createDraft(text, spans);
      const nextText = `${text.slice(0, span.start)}${span.original}${text.slice(span.end)}`;
      const delta = span.original.length - (span.end - span.start);
      const nextSpans = spans
        .filter((item) => item.id !== spanId)
        .map((item) => {
          if (item.start >= span.end) {
            return { ...item, start: item.start + delta, end: item.end + delta };
          }
          return item;
        });
      return createDraft(nextText, nextSpans);
    },
  };
}

function mergeHeard(existing: readonly string[], heard: string): readonly string[] {
  const key = heardKey(heard);
  if (existing.some((item) => heardKey(item) === key)) return existing;
  return [...existing, heard];
}

/**
 * Records misheard → corrected pairs and activates a reversible post-ASR
 * replacement only after two distinct occurrences. One-off typos stay silent.
 * A suppressed row is a permanent opt-out for that corrected term.
 */
export class TwoOccurrenceCorrectionLearner {
  private readonly activeByProject = new Map<string, readonly ActivePhrase[]>();

  constructor(
    private readonly store: VocabularyStore,
    private readonly clock: DictationClock,
  ) {}

  observeCorrection(input: CorrectionObservationInput): CorrectionObservation {
    const corrected = preserveDeveloperCasing(input.corrected.trim());
    const heard = preserveDeveloperCasing(input.heard.trim().replace(/\s+/g, " "));
    if (!corrected || !heard || !input.occurrenceId) {
      throw new Error("heard, corrected, and occurrenceId are required");
    }
    const existing = this.store.get(input.projectId, corrected);
    if (existing?.suppressed) {
      return {
        heard,
        corrected,
        occurrence_count: existing.occurrence_count,
        promoted: false,
        suppressed: true,
        ignoredBecauseSuppressed: true,
      };
    }
    const alreadyCounted = existing?.occurrence_ids.includes(input.occurrenceId) ?? false;
    const occurrenceCount = alreadyCounted
      ? (existing?.occurrence_count ?? 0)
      : (existing?.occurrence_count ?? 0) + 1;
    const promoted = occurrenceCount >= PROMOTION_OCCURRENCE_FLOOR;
    const occurrenceIds = alreadyCounted
      ? (existing?.occurrence_ids ?? [])
      : [...(existing?.occurrence_ids ?? []), input.occurrenceId];
    const heardForms = mergeHeard(existing?.heard_forms ?? [], heard);
    const keepExistingIdentity = !promoted && existing !== null && existing.source !== "user_correction";
    const entry: VocabularyEntry = {
      term: corrected,
      project_id: input.projectId,
      weight: promoted
        ? Math.max(existing?.weight ?? 0, WEIGHT.userCorrection)
        : (existing?.weight ?? WEIGHT.older),
      source: promoted ? "user_correction" : (existing?.source ?? "user_correction"),
      correction_from: existing?.correction_from ?? heard,
      heard_forms: heardForms,
      occurrence_count: occurrenceCount,
      occurrence_ids: occurrenceIds,
      last_used_at: this.clock.now(),
      suppressed: false,
    };
    if (keepExistingIdentity && existing) {
      this.store.upsert({
        ...entry,
        weight: existing.weight,
        source: existing.source,
      });
    } else {
      this.store.upsert(entry);
    }
    if (input.projectId === GLOBAL_PROJECT_ID) {
      this.activeByProject.clear();
    } else {
      this.activeByProject.delete(input.projectId);
    }
    return {
      heard,
      corrected,
      occurrence_count: occurrenceCount,
      promoted,
      suppressed: false,
      ignoredBecauseSuppressed: false,
    };
  }

  /** Drop cached replacement phrases after vocabulary store mutations. */
  invalidateActivePhrases(projectId?: string): void {
    if (projectId === undefined) {
      this.activeByProject.clear();
      return;
    }
    this.activeByProject.delete(projectId);
  }

  private activePhrases(projectId: string): readonly ActivePhrase[] {
    const cached = this.activeByProject.get(projectId);
    if (cached) return cached;
    const phrases: ActivePhrase[] = [];
    for (const entry of this.store.list()) {
      if (entry.suppressed || entry.occurrence_count < PROMOTION_OCCURRENCE_FLOOR) continue;
      if (entry.project_id !== projectId && entry.project_id !== GLOBAL_PROJECT_ID) continue;
      if (entry.heard_forms.length === 0) continue;
      const priority = entry.project_id === projectId ? 2 : 1;
      for (const heard of entry.heard_forms) {
        phrases.push({ heard, corrected: entry.term, priority });
      }
    }
    phrases.sort((left, right) => right.heard.length - left.heard.length || right.priority - left.priority);
    this.activeByProject.set(projectId, phrases);
    return phrases;
  }

  apply(projectId: string, text: string): CorrectedDictationDraft {
    const phrases = this.activePhrases(projectId);
    const hits: Array<{ start: number; end: number; phrase: ActivePhrase; original: string }> = [];
    for (const phrase of phrases) {
      const pattern = heardPattern(phrase.heard);
      for (const match of text.matchAll(pattern)) {
        const original = match[0];
        const start = match.index;
        if (start === undefined || !original) continue;
        hits.push({ start, end: start + original.length, phrase, original });
      }
    }
    hits.sort((left, right) => left.start - right.start || right.end - left.end || right.phrase.priority - left.phrase.priority);
    const taken: typeof hits = [];
    let cursor = -1;
    for (const hit of hits) {
      if (hit.start < cursor) continue;
      taken.push(hit);
      cursor = hit.end;
    }
    let built = "";
    let consumed = 0;
    const spans: DictationCorrectionSpan[] = [];
    for (const hit of taken) {
      built += text.slice(consumed, hit.start);
      const start = built.length;
      built += hit.phrase.corrected;
      const end = built.length;
      spans.push({
        id: `ac-${start}-${end}`,
        heard: hit.phrase.heard,
        original: hit.original,
        corrected: hit.phrase.corrected,
        start,
        end,
        tooltip: correctionTooltip(hit.phrase.heard),
      });
      consumed = hit.end;
    }
    built += text.slice(consumed);
    return createDraft(built, spans);
  }
}
