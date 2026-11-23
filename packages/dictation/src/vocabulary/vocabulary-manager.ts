import { canonicalizeTechCasing, preserveDeveloperCasing } from "./casing.js";
import { TwoOccurrenceCorrectionLearner } from "./correction-learner.js";
import { emptyProjectStateCatalog, MemoryVocabularyStore } from "./memory-store.js";
import { WhisperInitialPromptBuilder } from "./prompt-builder.js";
import { ProjectVerifiedSpokenIdNormalizer } from "./spoken-id-normalizer.js";
import { weightForSource } from "./weights.js";
import {
  GLOBAL_PROJECT_ID,
  type BrownfieldSymbolVocabularyPort,
  type CanvasFocusVocabularyPort,
  type DictationCorrectionSpan,
  type DictationClock,
  type HarvestedVocabularyName,
  type KnowledgeGraphVocabularyPort,
  type LiveCanvasFocus,
  type LocalWhisperPromptPort,
  type NameRegistryVocabularyPort,
  type ProjectStateIdCatalog,
  type SpokenIdNormalization,
  type VocabularyEntry,
  type VocabularyListItem,
  type VocabularyStore,
  type WhisperInitialPrompt,
} from "./types.js";

const systemClock: DictationClock = { now: () => Date.now() };

const emptyKnowledge: KnowledgeGraphVocabularyPort = { listCanonicalNames: () => [] };
const emptyNames: NameRegistryVocabularyPort = { listRegisteredNames: () => [] };
const emptySymbols: BrownfieldSymbolVocabularyPort = { listSymbolNames: () => [] };
const emptyCanvas: CanvasFocusVocabularyPort = { describeBox: () => null };

export interface VocabularyManagerOptions {
  readonly store?: VocabularyStore;
  readonly clock?: DictationClock;
  readonly catalog?: ProjectStateIdCatalog;
  readonly knowledge?: KnowledgeGraphVocabularyPort;
  readonly names?: NameRegistryVocabularyPort;
  readonly symbols?: BrownfieldSymbolVocabularyPort;
  readonly canvas?: CanvasFocusVocabularyPort;
  readonly whisper?: LocalWhisperPromptPort;
  readonly prompts?: WhisperInitialPromptBuilder;
}

export interface HarvestReport {
  readonly inserted: readonly string[];
  readonly skipped: readonly string[];
}

export interface ManualTermInput {
  readonly projectId: string;
  readonly term: string;
  readonly weight?: number;
}

export interface TermLocator {
  readonly projectId: string;
  readonly term: string;
}

export interface NormalizedTranscript {
  readonly text: string;
  readonly spoken: SpokenIdNormalization;
  readonly correctionCount: number;
  readonly tooltips: readonly string[];
  readonly spans: readonly DictationCorrectionSpan[];
  undoCorrection(spanId: string): NormalizedTranscript;
}

function toListItem(entry: VocabularyEntry): VocabularyListItem {
  return {
    term: entry.term,
    project_id: entry.project_id,
    weight: entry.weight,
    source: entry.source,
    correction_from: entry.correction_from,
    occurrence_count: entry.occurrence_count,
    last_used_at: entry.last_used_at,
    suppressed: entry.suppressed,
    promoted: entry.source === "user_correction" && entry.occurrence_count >= 2 && !entry.suppressed,
    scope: entry.project_id === GLOBAL_PROJECT_ID ? "global" : "project",
  };
}

function blankEntry(projectId: string, term: string, now: number): VocabularyEntry {
  return {
    term,
    project_id: projectId,
    weight: weightForSource("user_manual"),
    source: "user_manual",
    correction_from: null,
    heard_forms: [],
    occurrence_count: 0,
    occurrence_ids: [],
    last_used_at: now,
    suppressed: false,
  };
}

/**
 * Per-project and global dictation vocabulary: harvest, focus-aware prompting,
 * settings RPCs, two-occurrence corrections, and project-verified spoken IDs.
 */
export class ProjectDictationVocabularyManager {
  readonly store: VocabularyStore;
  readonly learner: TwoOccurrenceCorrectionLearner;
  readonly prompts: WhisperInitialPromptBuilder;
  readonly spokenIds: ProjectVerifiedSpokenIdNormalizer;

  private readonly clock: DictationClock;
  private readonly knowledge: KnowledgeGraphVocabularyPort;
  private readonly names: NameRegistryVocabularyPort;
  private readonly symbols: BrownfieldSymbolVocabularyPort;
  private readonly canvas: CanvasFocusVocabularyPort;
  private readonly whisper: LocalWhisperPromptPort | null;
  private readonly focusByProject = new Map<string, LiveCanvasFocus>();
  private readonly recentByProject = new Map<string, readonly string[]>();
  private readonly neighborsByTerm = new Map<string, readonly string[]>();

  constructor(options: VocabularyManagerOptions = {}) {
    this.store = options.store ?? new MemoryVocabularyStore();
    this.clock = options.clock ?? systemClock;
    this.knowledge = options.knowledge ?? emptyKnowledge;
    this.names = options.names ?? emptyNames;
    this.symbols = options.symbols ?? emptySymbols;
    this.canvas = options.canvas ?? emptyCanvas;
    this.whisper = options.whisper ?? null;
    this.learner = new TwoOccurrenceCorrectionLearner(this.store, this.clock);
    this.prompts = options.prompts ?? new WhisperInitialPromptBuilder();
    this.spokenIds = new ProjectVerifiedSpokenIdNormalizer(options.catalog ?? emptyProjectStateCatalog);
  }

  list(projectId: string): VocabularyListItem[] {
    return this.store
      .list()
      .filter((entry) => entry.project_id === projectId || entry.project_id === GLOBAL_PROJECT_ID)
      .map(toListItem)
      .sort((left, right) => {
        if (left.suppressed !== right.suppressed) return left.suppressed ? 1 : -1;
        if (left.scope !== right.scope) return left.scope === "project" ? -1 : 1;
        if (left.term < right.term) return -1;
        if (left.term > right.term) return 1;
        return 0;
      });
  }

  addManualTerm(input: ManualTermInput): VocabularyEntry {
    const term = preserveDeveloperCasing(input.term.trim());
    if (!term) throw new Error("term is required");
    const entry: VocabularyEntry = {
      ...blankEntry(input.projectId, term, this.clock.now()),
      ...(input.weight === undefined ? {} : { weight: input.weight }),
    };
    this.store.upsert(entry);
    this.learner.invalidateActivePhrases(input.projectId);
    return entry;
  }

  /** Marks the row `suppressed` so harvest and the learner cannot revive it. */
  removeTerm(input: TermLocator): VocabularyEntry | null {
    const existing = this.store.get(input.projectId, input.term);
    if (!existing) return null;
    const suppressed: VocabularyEntry = {
      ...existing,
      suppressed: true,
      last_used_at: this.clock.now(),
    };
    this.store.upsert(suppressed);
    this.learner.invalidateActivePhrases(input.projectId);
    return suppressed;
  }

  resetLearnedCorrections(projectId: string): void {
    for (const entry of this.store.list()) {
      if (entry.project_id !== projectId) continue;
      if (entry.source !== "user_correction") continue;
      if (entry.suppressed) continue;
      this.store.delete(projectId, entry.term);
    }
    this.learner.invalidateActivePhrases(projectId);
  }

  promoteToGlobal(input: TermLocator): VocabularyEntry {
    const existing = this.store.get(input.projectId, input.term);
    if (!existing) {
      throw new Error(`unknown vocabulary term ${input.term}`);
    }
    const globalEntry: VocabularyEntry = {
      ...existing,
      project_id: GLOBAL_PROJECT_ID,
      suppressed: false,
      last_used_at: this.clock.now(),
    };
    this.store.upsert(globalEntry);
    this.learner.invalidateActivePhrases();
    return globalEntry;
  }

  /**
   * Pull canonical names from state.db (Task 017 / 019) and brownfield L0/L1
   * symbols (Task 167). Project brand terms stay on `projectId`.
   */
  harvest(projectId: string): HarvestReport {
    const names: HarvestedVocabularyName[] = [
      ...this.knowledge.listCanonicalNames(projectId),
      ...this.names.listRegisteredNames(projectId),
      ...this.symbols.listSymbolNames(projectId),
    ];
    const inserted: string[] = [];
    const skipped: string[] = [];
    const owned = this.store.list().filter((entry) => entry.project_id === projectId);
    for (const name of names) {
      const term = canonicalizeTechCasing(name.term);
      if (!term) continue;
      if (name.neighborTerms && name.neighborTerms.length > 0) {
        this.neighborsByTerm.set(
          `${projectId}\u0000${term}`,
          name.neighborTerms.map((neighbor) => canonicalizeTechCasing(neighbor)),
        );
      }
      const existing = owned.find((entry) => entry.term.toLowerCase() === term.toLowerCase());
      if (existing) {
        skipped.push(term);
        continue;
      }
      const source = name.kind === "library" ? "tech_stack" : "entity_auto";
      const entry: VocabularyEntry = {
        term,
        project_id: projectId,
        weight: weightForSource(source),
        source,
        correction_from: null,
        heard_forms: [],
        occurrence_count: 0,
        occurrence_ids: [],
        last_used_at: this.clock.now(),
        suppressed: false,
      };
      this.store.upsert(entry);
      owned.push(entry);
      inserted.push(term);
    }
    return { inserted, skipped };
  }

  /**
   * Boost the selected Canvas box and its neighboring names to the tail of
   * the next 224-token prompt before the microphone starts.
   */
  focusCanvasBox(projectId: string, boxId: string): LiveCanvasFocus {
    const described = this.canvas.describeBox(projectId, boxId);
    const suffix = boxId.includes(":") ? boxId.slice(boxId.indexOf(":") + 1) : boxId;
    const describedTerms = described?.terms ?? [];
    const terms = (describedTerms.length > 0 ? describedTerms : suffix ? [suffix] : []).map((term) =>
      preserveDeveloperCasing(term.trim()),
    );
    const describedNeighbors = described?.neighborTerms ?? [];
    const remembered = terms[0] ? (this.neighborsByTerm.get(`${projectId}\u0000${terms[0]}`) ?? []) : [];
    const neighborTerms = (describedNeighbors.length > 0 ? describedNeighbors : remembered).map((term) =>
      preserveDeveloperCasing(term.trim()),
    );
    const focus: LiveCanvasFocus = { projectId, boxId, terms, neighborTerms };
    this.focusByProject.set(projectId, focus);
    return focus;
  }

  clearFocus(projectId: string): void {
    this.focusByProject.delete(projectId);
  }

  noteRecentlyEdited(projectId: string, terms: readonly string[]): void {
    this.recentByProject.set(
      projectId,
      terms.map((term) => preserveDeveloperCasing(term.trim())).filter((term) => term.length > 0),
    );
  }

  buildPrompt(projectId: string): WhisperInitialPrompt {
    const focus = this.focusByProject.get(projectId);
    const prompt = this.prompts.build({
      projectId,
      entries: this.store.list(),
      focusTerms: focus?.projectId === projectId ? focus.terms : [],
      neighborTerms: focus?.projectId === projectId ? focus.neighborTerms : [],
      recentlyEditedTerms: this.recentByProject.get(projectId) ?? [],
    });
    this.whisper?.applyCarryInitialPrompt(prompt);
    return prompt;
  }

  normalizeTranscript(projectId: string, text: string): NormalizedTranscript {
    return this.finishTranscript(projectId, this.learner.apply(projectId, text));
  }

  private finishTranscript(
    projectId: string,
    draft: ReturnType<TwoOccurrenceCorrectionLearner["apply"]>,
  ): NormalizedTranscript {
    const spoken = this.spokenIds.normalize(projectId, draft.text);
    return {
      text: spoken.text,
      spoken,
      correctionCount: draft.spans.length,
      tooltips: draft.spans.map((span) => span.tooltip),
      spans: draft.spans,
      undoCorrection: (spanId: string) => this.finishTranscript(projectId, draft.undo(spanId)),
    };
  }
}

export function createProjectDictationVocabularyManager(
  options: VocabularyManagerOptions = {},
): ProjectDictationVocabularyManager {
  return new ProjectDictationVocabularyManager(options);
}
