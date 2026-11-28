/** Logical `global.db.vocabulary` row used by Task 158. */
export const VOCABULARY_SOURCES = [
  "entity_auto",
  "user_correction",
  "user_manual",
  "tech_stack",
] as const;

export type VocabularySource = (typeof VOCABULARY_SOURCES)[number];

/** Frozen `schema/global.sql` `vocabulary.source` CHECK values. */
export const FROZEN_VOCABULARY_SOURCES = [
  "correction",
  "glossary",
  "dependency",
  "pattern",
  "global",
] as const;

export type FrozenVocabularySource = (typeof FROZEN_VOCABULARY_SOURCES)[number];

/**
 * `schema/global.sql` uses `project ''` for the developer's global list.
 * Task 158 calls that same scope `project_id`.
 */
export const GLOBAL_PROJECT_ID = "";

export const WHISPER_PROMPT_TOKEN_LIMIT = 224;

export const CARRY_INITIAL_PROMPT_FLAG = "--carry-initial-prompt" as const;

export const PROMOTION_OCCURRENCE_FLOOR = 2;

/** Hot-path budget for prompt build, learning, and spoken-ID normalization. */
export const VOCABULARY_PIPELINE_BUDGET_MS = 5;

export interface VocabularyEntry {
  readonly term: string;
  readonly project_id: string;
  readonly weight: number;
  readonly source: VocabularySource;
  readonly correction_from: string | null;
  readonly heard_forms: readonly string[];
  readonly occurrence_count: number;
  readonly occurrence_ids: readonly string[];
  readonly last_used_at: number;
  readonly suppressed: boolean;
}

export interface VocabularyListItem {
  readonly term: string;
  readonly project_id: string;
  readonly weight: number;
  readonly source: VocabularySource;
  readonly correction_from: string | null;
  readonly occurrence_count: number;
  readonly last_used_at: number;
  readonly suppressed: boolean;
  readonly promoted: boolean;
  readonly scope: "project" | "global";
}

export interface VocabularyStore {
  get(projectId: string, term: string): VocabularyEntry | null;
  list(): readonly VocabularyEntry[];
  upsert(entry: VocabularyEntry): void;
  delete(projectId: string, term: string): void;
}

export interface DictationClock {
  now(): number;
}

export interface HarvestedVocabularyName {
  readonly term: string;
  readonly kind: "entity" | "feature" | "module" | "symbol" | "library" | "acronym" | "proper_noun";
  readonly neighborTerms?: readonly string[];
}

/** Local stand-in for `KnowledgeGraphRepo` (`Task 017`) until that branch is wired. */
export interface KnowledgeGraphVocabularyPort {
  listCanonicalNames(projectId: string): readonly HarvestedVocabularyName[];
}

/** Local stand-in for `NameRegistryRepo` (`Task 019`). */
export interface NameRegistryVocabularyPort {
  listRegisteredNames(projectId: string): readonly HarvestedVocabularyName[];
}

/** Local stand-in for brownfield L0/L1 symbols (`Task 167`). */
export interface BrownfieldSymbolVocabularyPort {
  listSymbolNames(projectId: string): readonly HarvestedVocabularyName[];
}

export interface CanvasBoxVocabulary {
  readonly terms: readonly string[];
  readonly neighborTerms: readonly string[];
}

/** Local stand-in for Canvas box selection (`Task 154`). */
export interface CanvasFocusVocabularyPort {
  describeBox(projectId: string, boxId: string): CanvasBoxVocabulary | null;
}

/**
 * Active project IDs that actually exist in `state.db`.
 * Local stand-in for `KnowledgeGraphRepo` / `NameRegistryRepo` reads.
 */
export interface ProjectStateIdCatalog {
  hasActiveRule(projectId: string, ruleId: string): boolean;
  hasTask(projectId: string, taskId: string): boolean;
  hasActiveWorker(projectId: string, workerId: string): boolean;
  hasRequirement(projectId: string, requirementId: string): boolean;
}

export interface WhisperInitialPrompt {
  readonly flag: typeof CARRY_INITIAL_PROMPT_FLAG;
  readonly carryInitialPrompt: true;
  readonly args: readonly ["--prompt", string, typeof CARRY_INITIAL_PROMPT_FLAG];
  readonly text: string;
  readonly tokenCount: number;
  readonly terms: readonly string[];
  readonly tokenIds: readonly number[];
}

/** Local stand-in for `LocalWhisperSttEngine` (`Task 157`) prompt injection. */
export interface LocalWhisperPromptPort {
  applyCarryInitialPrompt(prompt: WhisperInitialPrompt): void;
}

export interface DictationCorrectionSpan {
  readonly id: string;
  readonly heard: string;
  readonly original: string;
  readonly corrected: string;
  readonly start: number;
  readonly end: number;
  readonly tooltip: string;
}

export interface CorrectedDictationDraft {
  readonly text: string;
  readonly spans: readonly DictationCorrectionSpan[];
  undo(spanId: string): CorrectedDictationDraft;
}

export interface CorrectionObservation {
  readonly heard: string;
  readonly corrected: string;
  readonly occurrence_count: number;
  readonly promoted: boolean;
  readonly suppressed: boolean;
  readonly ignoredBecauseSuppressed: boolean;
}

export interface SpokenIdReplacement {
  readonly start: number;
  readonly end: number;
  readonly spoken: string;
  readonly canonicalId: string;
  readonly kind: "rule" | "task" | "worker" | "requirement";
}

export interface SpokenIdNormalization {
  readonly text: string;
  readonly replacements: readonly SpokenIdReplacement[];
}

export interface LiveCanvasFocus {
  readonly projectId: string;
  readonly boxId: string;
  readonly terms: readonly string[];
  readonly neighborTerms: readonly string[];
}

export interface RankedPromptTerm {
  readonly term: string;
  readonly weight: number;
  readonly tier: number;
  readonly lastUsedAt: number;
  /** Tokens used when this term is not the first piece of the prompt. */
  readonly spacedTokens: number;
  readonly firstPieceIds: readonly number[];
  readonly spacedPieceIds: readonly number[];
}

export function isVocabularySource(value: string): value is VocabularySource {
  return (VOCABULARY_SOURCES as readonly string[]).includes(value);
}

export function entryKey(projectId: string, term: string): string {
  return `${projectId}\u0000${term}`;
}

export function isPromotedCorrection(entry: VocabularyEntry): boolean {
  return (
    entry.source === "user_correction" &&
    entry.occurrence_count >= PROMOTION_OCCURRENCE_FLOOR &&
    !entry.suppressed &&
    entry.correction_from !== null
  );
}

export function correctionTooltip(heard: string): string {
  return `Auto-corrected from '${heard}' · Undo`;
}
