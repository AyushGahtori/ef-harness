import { TwoOccurrenceCorrectionLearner } from "../vocabulary/correction-learner.js";
import { emptyProjectStateCatalog } from "../vocabulary/memory-store.js";
import { WhisperInitialPromptBuilder } from "../vocabulary/prompt-builder.js";
import { ProjectVerifiedSpokenIdNormalizer } from "../vocabulary/spoken-id-normalizer.js";
import type { DictationClock, ProjectStateIdCatalog, VocabularyStore } from "../vocabulary/types.js";

const systemClock: DictationClock = { now: () => Date.now() };

/** Task 158 services that Task 157 queries while a Whisper session is open. */
export interface DictationVocabularyPipeline {
  readonly projectId: string;
  readonly store: VocabularyStore;
  readonly prompts: WhisperInitialPromptBuilder;
  readonly learner: TwoOccurrenceCorrectionLearner;
  readonly spokenIds: ProjectVerifiedSpokenIdNormalizer;
}

export function createDictationVocabularyPipeline(options: {
  readonly projectId: string;
  readonly store: VocabularyStore;
  readonly catalog?: ProjectStateIdCatalog;
  readonly clock?: DictationClock;
  readonly prompts?: WhisperInitialPromptBuilder;
}): DictationVocabularyPipeline {
  const clock = options.clock ?? systemClock;
  return {
    projectId: options.projectId,
    store: options.store,
    prompts: options.prompts ?? new WhisperInitialPromptBuilder(),
    learner: new TwoOccurrenceCorrectionLearner(options.store, clock),
    spokenIds: new ProjectVerifiedSpokenIdNormalizer(options.catalog ?? emptyProjectStateCatalog),
  };
}
