export {
  CANONICAL_TECH_TERMS,
  canonicalizeTechCasing,
  heardKey,
  preserveDeveloperCasing,
} from "./casing.js";
export { TwoOccurrenceCorrectionLearner } from "./correction-learner.js";
export type { CorrectionObservationInput } from "./correction-learner.js";
export {
  FrozenGlobalVocabularyStore,
  MemoryGlobalDbVocabularyDriver,
  VOCABULARY_SIDECAR_SETTING_KEY,
  entryFromFrozenRow,
  frozenSourceFor,
  logicalSourceFor,
  sidecarFor,
  toFrozenVocabularyRow,
} from "./frozen-schema-adapter.js";
export type {
  FrozenVocabularyRow,
  GlobalDbVocabularyDriver,
  VocabularySidecarRow,
} from "./frozen-schema-adapter.js";
export { MemoryProjectStateCatalog, MemoryVocabularyStore, emptyProjectStateCatalog } from "./memory-store.js";
export { parseSpokenAgentNumber, parseSpokenNumber } from "./number-words.js";
export { WhisperInitialPromptBuilder } from "./prompt-builder.js";
export type { PromptCandidateInput } from "./prompt-builder.js";
export { ProjectVerifiedSpokenIdNormalizer } from "./spoken-id-normalizer.js";
export {
  CARRY_INITIAL_PROMPT_FLAG,
  FROZEN_VOCABULARY_SOURCES,
  GLOBAL_PROJECT_ID,
  PROMOTION_OCCURRENCE_FLOOR,
  VOCABULARY_PIPELINE_BUDGET_MS,
  VOCABULARY_SOURCES,
  WHISPER_PROMPT_TOKEN_LIMIT,
  correctionTooltip,
  isPromotedCorrection,
  isVocabularySource,
} from "./types.js";
export type {
  BrownfieldSymbolVocabularyPort,
  CanvasBoxVocabulary,
  CanvasFocusVocabularyPort,
  CorrectionObservation,
  CorrectedDictationDraft,
  DictationClock,
  DictationCorrectionSpan,
  FrozenVocabularySource,
  HarvestedVocabularyName,
  KnowledgeGraphVocabularyPort,
  LiveCanvasFocus,
  LocalWhisperPromptPort,
  NameRegistryVocabularyPort,
  ProjectStateIdCatalog,
  RankedPromptTerm,
  SpokenIdNormalization,
  SpokenIdReplacement,
  VocabularyEntry,
  VocabularyListItem,
  VocabularySource,
  VocabularyStore,
  WhisperInitialPrompt,
} from "./types.js";
export {
  ProjectDictationVocabularyManager,
  createProjectDictationVocabularyManager,
} from "./vocabulary-manager.js";
export type {
  HarvestReport,
  ManualTermInput,
  NormalizedTranscript,
  TermLocator,
  VocabularyManagerOptions,
} from "./vocabulary-manager.js";
export { PROMPT_TIER, WEIGHT, tierForEntry, weightForSource } from "./weights.js";
export { countWhisperBpeTokens, encodeWhisperBpe, warmWhisperBpe } from "./whisper-bpe.js";
