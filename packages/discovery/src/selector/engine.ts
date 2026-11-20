import { DeterministicClarifyRephraser, type ClarifyPort } from "./anti-nag.js";
import { DiscoveryBatchBuilder } from "./batch-builder.js";
import {
  DeterministicQuestionDrafter,
  ProjectLocalQuestionDrafter,
  type QuestionDrafterPort,
} from "./drafter.js";
import {
  PrereqEligibilityFilter,
  breakNextPrerequisiteCycle,
  hasUncoveredCriteria,
} from "./eligibility.js";
import { CatalogPrereqCycleError } from "./errors.js";
import { applyScopePriority, coalesceBundles, stripSettledFromDrafts, unblockerIds } from "./greedy-selector.js";
import { InMemoryDiscoveryBatchStore, ScopeCriterionAskLedger, type DiscoveryBatchStore } from "./store.js";
import {
  DEFAULT_LOCAL_QUESTION_BUDGET,
  clampBatchTarget,
  type CatalogQuestion,
  type CriterionState,
  type DiscoveryBatchRecord,
} from "./types.js";

export interface SelectorLogger {
  error(error: CatalogPrereqCycleError): void;
}

export interface SelectionRequest {
  readonly workItemId: string;
  readonly scopeRev: number;
  readonly batchId: string;
  readonly catalogVersion: string;
  readonly criteria: readonly CriterionState[];
  readonly catalog: readonly CatalogQuestion[];
  readonly turn: number;
  readonly createdAt: number;
  readonly lastOptionsVersion: number;
  readonly projectLocalCount: number;
  readonly askedQuestionIds?: readonly string[];
  readonly deferredQuestionIds?: readonly string[];
  readonly targetSize?: number;
  readonly localBudget?: number;
  readonly drafter?: QuestionDrafterPort;
  readonly clarifier?: ClarifyPort;
  readonly logger?: SelectorLogger;
  readonly batchStore?: DiscoveryBatchStore;
  readonly askLedger?: ScopeCriterionAskLedger;
}

export interface SelectionResult {
  readonly batch: DiscoveryBatchRecord;
  readonly nextOptionsVersion: number;
  readonly draftedQuestionIds: readonly string[];
  readonly eligibleQuestionIds: readonly string[];
  readonly diagnostics: readonly CatalogPrereqCycleError[];
}

const filter = new PrereqEligibilityFilter();
const drafter = new ProjectLocalQuestionDrafter();
const builder = new DiscoveryBatchBuilder();

export function selectNextBatch(request: SelectionRequest): SelectionResult {
  const asked = request.askedQuestionIds ?? [];
  const deferred = request.deferredQuestionIds ?? [];
  let waived: ReadonlyMap<string, readonly string[]> = new Map();
  let working = stripSettledFromDrafts(request.catalog, request.criteria);
  let eligible = filter.filter({
    questions: working,
    criteria: request.criteria,
    askedQuestionIds: asked,
    deferredQuestionIds: deferred,
    waived,
  });
  const diagnostics: CatalogPrereqCycleError[] = [];
  const limit = working.length + request.criteria.length + 2;
  let guard = 0;
  while (eligible.length === 0 && hasUncoveredCriteria(request.criteria) && guard < limit) {
    const broken = breakNextPrerequisiteCycle({
      questions: working,
      criteria: request.criteria,
      askedQuestionIds: asked,
      deferredQuestionIds: deferred,
      waived,
    });
    if (broken === null) break;
    diagnostics.push(broken.error);
    request.logger?.error(broken.error);
    waived = broken.waived;
    eligible = filter.filter({
      questions: working,
      criteria: request.criteria,
      askedQuestionIds: asked,
      deferredQuestionIds: deferred,
      waived,
    });
    guard += 1;
  }

  const drafted = drafter.draft({
    criteria: request.criteria,
    catalog: working,
    projectLocalCount: request.projectLocalCount,
    budget: request.localBudget ?? DEFAULT_LOCAL_QUESTION_BUDGET,
    drafter: request.drafter ?? new DeterministicQuestionDrafter(),
    waived,
  });
  if (drafted.questions.length > 0) {
    working = [...working, ...drafted.questions];
    eligible = filter.filter({
      questions: working,
      criteria: request.criteria,
      askedQuestionIds: asked,
      deferredQuestionIds: deferred,
      waived,
    });
  }

  const scoped = applyScopePriority(eligible, request.criteria);
  const candidates = coalesceBundles(scoped, request.criteria);
  const built = builder.build({
    candidates,
    downstreamCatalog: working,
    criteria: request.criteria,
    unblockers: unblockerIds(working, request.criteria),
    targetSize: clampBatchTarget(request.targetSize),
    workItemId: request.workItemId,
    scopeRev: request.scopeRev,
    batchId: request.batchId,
    catalogVersion: request.catalogVersion,
    turn: request.turn,
    createdAt: request.createdAt,
    lastOptionsVersion: request.lastOptionsVersion,
    clarifier: request.clarifier ?? new DeterministicClarifyRephraser(),
    splitCard: drafted.splitCard,
    diagnostics,
  });

  request.batchStore?.insert(built.batch);
  request.askLedger?.apply(request.workItemId, request.scopeRev, built.batch.askUpdates);

  return {
    batch: built.batch,
    nextOptionsVersion: built.nextOptionsVersion,
    draftedQuestionIds: drafted.questions.map((question) => question.id),
    eligibleQuestionIds: eligible.map((question) => question.id),
    diagnostics,
  };
}

export function emptyBatchStore(): InMemoryDiscoveryBatchStore {
  return new InMemoryDiscoveryBatchStore();
}
