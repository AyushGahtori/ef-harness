import { CorpusPinIntegrityError, CorpusShapeError } from "./errors.js";
import { canonicalJson } from "./hash.js";
import type {
  CorpusBundle,
  CorpusProjectStatePort,
  CorpusReconciliationEntry,
  QuestionCatalogEntry,
  ReconciliationResult,
  ScopeCriterionSnapshot,
  SettledDecisionSnapshot,
} from "./types.js";

export const CORPUS_BUNDLE_HASH_META_KEY = "corpus_bundle_hash";
export const CORPUS_QUESTION_CATALOG_META_KEY = "corpus_question_catalog";
export const CORPUS_RECONCILIATION_LOG_META_KEY = "corpus_reconciliation_log";
export const CORPUS_OBSERVED_HASH_META_KEY = "corpus_bundle_hash_observed";

export function questionCatalog(bundle: CorpusBundle): QuestionCatalogEntry[] {
  return bundle.questions
    .map((question) => ({
      id: question.id,
      title: question.title,
      version: question.version,
      criteria: [...question.criteria],
      renamedFrom: question.renamed_from ?? null,
    }))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

export function reconcileCorpusUpgrade(
  store: CorpusProjectStatePort,
  bundle: CorpusBundle,
): ReconciliationResult {
  const beforeDecisions = store.listSettledDecisions();
  const beforeScope = store.listScopeCriteria();
  const incomingHash = bundle.corpusBundleHash;
  const pinned = store.getMeta(CORPUS_BUNDLE_HASH_META_KEY);
  const catalog = questionCatalog(bundle);

  if (pinned === null) {
    store.setMeta(CORPUS_BUNDLE_HASH_META_KEY, incomingHash);
    store.setMeta(CORPUS_QUESTION_CATALOG_META_KEY, canonicalJson(catalog));
    store.setMeta(CORPUS_RECONCILIATION_LOG_META_KEY, "[]");
    store.setMeta(CORPUS_OBSERVED_HASH_META_KEY, incomingHash);
    assertPreserved(store, beforeDecisions, beforeScope);
    return {
      pinnedHash: incomingHash,
      incomingHash,
      initialPin: true,
      upgraded: false,
      addedQuestionIds: [],
      removedQuestionIds: [],
      renamed: [],
      settledDecisions: store.listSettledDecisions(),
      scopeCriteria: store.listScopeCriteria(),
    };
  }

  if (pinned === incomingHash) {
    assertPreserved(store, beforeDecisions, beforeScope);
    return {
      pinnedHash: pinned,
      incomingHash,
      initialPin: false,
      upgraded: false,
      addedQuestionIds: [],
      removedQuestionIds: [],
      renamed: [],
      settledDecisions: store.listSettledDecisions(),
      scopeCriteria: store.listScopeCriteria(),
    };
  }

  const previous = readCatalog(store.getMeta(CORPUS_QUESTION_CATALOG_META_KEY));
  const diff = diffCatalog(previous, catalog);
  const log = readLog(store.getMeta(CORPUS_RECONCILIATION_LOG_META_KEY));
  const entry: CorpusReconciliationEntry = {
    pinnedHash: pinned,
    observedHash: incomingHash,
    addedQuestionIds: diff.addedQuestionIds,
    removedQuestionIds: diff.removedQuestionIds,
    renamed: diff.renamed,
  };
  store.setMeta(CORPUS_QUESTION_CATALOG_META_KEY, canonicalJson(catalog));
  store.setMeta(CORPUS_RECONCILIATION_LOG_META_KEY, canonicalJson([...log, entry]));
  store.setMeta(CORPUS_OBSERVED_HASH_META_KEY, incomingHash);
  if (store.getMeta(CORPUS_BUNDLE_HASH_META_KEY) !== pinned) {
    throw new CorpusPinIntegrityError("corpus_bundle_hash changed during reconciliation", {
      filePath: bundle.corpusRoot,
    });
  }
  assertPreserved(store, beforeDecisions, beforeScope);
  return {
    pinnedHash: pinned,
    incomingHash,
    initialPin: false,
    upgraded: true,
    addedQuestionIds: diff.addedQuestionIds,
    removedQuestionIds: diff.removedQuestionIds,
    renamed: diff.renamed,
    settledDecisions: store.listSettledDecisions(),
    scopeCriteria: store.listScopeCriteria(),
  };
}

function diffCatalog(
  previous: readonly QuestionCatalogEntry[],
  next: readonly QuestionCatalogEntry[],
): Pick<ReconciliationResult, "addedQuestionIds" | "removedQuestionIds" | "renamed"> {
  const previousIds = new Set(previous.map((entry) => entry.id));
  const nextIds = new Set(next.map((entry) => entry.id));
  const renamed = next
    .filter(
      (entry): entry is QuestionCatalogEntry & { readonly renamedFrom: string } =>
        entry.renamedFrom !== null && previousIds.has(entry.renamedFrom) && !nextIds.has(entry.renamedFrom),
    )
    .map((entry) => ({ from: entry.renamedFrom, to: entry.id }))
    .sort((left, right) => (left.from < right.from ? -1 : left.from > right.from ? 1 : 0));
  const renamedFrom = new Set(renamed.map((item) => item.from));
  const renamedTo = new Set(renamed.map((item) => item.to));
  const addedQuestionIds = [...nextIds]
    .filter((id) => !previousIds.has(id) && !renamedTo.has(id))
    .sort();
  const removedQuestionIds = [...previousIds]
    .filter((id) => !nextIds.has(id) && !renamedFrom.has(id))
    .sort();
  return { addedQuestionIds, removedQuestionIds, renamed };
}

function readCatalog(raw: string | null): QuestionCatalogEntry[] {
  if (raw === null || raw === "") return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new CorpusShapeError("corpus_question_catalog metadata is not an array");
  }
  return parsed.map((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.title !== "string") {
      throw new CorpusShapeError("corpus_question_catalog metadata has an invalid entry");
    }
    const criteria = Array.isArray(item.criteria) ? item.criteria.filter((entry): entry is string => typeof entry === "string") : [];
    return {
      id: item.id,
      title: item.title,
      version: typeof item.version === "number" ? item.version : 1,
      criteria,
      renamedFrom: typeof item.renamedFrom === "string" ? item.renamedFrom : null,
    };
  });
}

function readLog(raw: string | null): CorpusReconciliationEntry[] {
  if (raw === null || raw === "") return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed as CorpusReconciliationEntry[];
}

function assertPreserved(
  store: CorpusProjectStatePort,
  decisions: readonly SettledDecisionSnapshot[],
  scope: readonly ScopeCriterionSnapshot[],
): void {
  if (canonicalJson(store.listSettledDecisions()) !== canonicalJson(decisions)) {
    throw new CorpusPinIntegrityError("Reconciliation mutated settled decisions");
  }
  if (canonicalJson(store.listScopeCriteria()) !== canonicalJson(scope)) {
    throw new CorpusPinIntegrityError("Reconciliation mutated scope_criteria");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
