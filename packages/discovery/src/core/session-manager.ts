import { chunkTurnWithOffsets } from "./chunk-turn.js";
import type { DecisionFields, EvidenceSpan } from "./decision-fields.js";
import { valueSatisfiesLimits } from "./decision-fields.js";
import {
  DiscoveryDbRepo,
  type DecisionRecord,
  type ScopeSnapshot,
} from "./discovery-db-repo.js";
import type { DiscoveryDraft, DraftStore } from "./draft-store.js";
import {
  DelegationBoundsError,
  DiscoveryStateError,
  IdempotencyConflictError,
  UnknownQuestionError,
} from "./errors.js";
import type { BatchRow, KnowledgeGraphRepo } from "./knowledge-graph-port.js";
import {
  isOpeningRubricId,
  OPENING_RUBRIC_IDS,
  openingPrompt,
  presentOpening,
  type OpeningPresentation,
  type OpeningPrompt,
  type OpeningRubricId,
  type PresentationMode,
} from "./opening-prompts.js";
import {
  DeterministicOpeningReviewer,
  type OpeningReview,
  type OpeningReviewer,
  type ReviewSpan,
} from "./opening-review.js";
import {
  defaultOpeningCatalog,
  mappedCriterionIds,
  validateOpeningRubricMap,
  type ActiveCatalog,
  type OpeningRubricMap,
  OPENING_RUBRIC_MAP_V1,
} from "./opening-rubric-map.js";
import { classifyReleaseIntent, type ReleaseIntent } from "./release-intent.js";
import { requestHash } from "./canonical-json.js";

export interface DiscoveryModelRequest {
  readonly kind: "opening-review@1" | "clarify@1" | "recommendation" | "batch-answer";
  readonly turnId: string;
  readonly text: string;
  readonly target: string | null;
  readonly questionId: string | null;
  readonly criterionId: string | null;
}

export interface DiscoveryModelPort {
  onExplicitSend(request: DiscoveryModelRequest): void;
}

export interface SendResult {
  readonly workItemId: string;
  readonly turnId: string;
  readonly sequence: number;
  readonly target: string | null;
  readonly opId: string;
  readonly text: string;
  readonly route:
    | "empty"
    | "clarify@1"
    | "anchor-interpretations"
    | "recommendation"
    | "batch-answer"
    | "opening-review@1";
  readonly modelInvoked: boolean;
  readonly credit: number;
  readonly rubricsCovered: OpeningRubricId[];
  readonly evidence: Array<{
    rubricId: OpeningRubricId;
    quote: string;
    start: number;
    end: number;
  }>;
  readonly followUp: { rubricId: OpeningRubricId; prompt: string } | null;
  readonly interpretations: string[];
  readonly recommendations: string[];
  readonly delegation: { scope: string; limits: string[]; turn: string } | null;
  readonly questionId: string | null;
  readonly criterionId: string | null;
  readonly rephrased: string | null;
  readonly chunks: Array<{ start: number; end: number }>;
  readonly batch: { id: string; cursor: number; status: string; questionIds: string[] } | null;
  readonly changeSummary: {
    scopeRev: number | null;
    reason: string | null;
    actions: Array<{ type: "move_to_later"; feature: string }>;
    release: Array<{
      feature: string;
      placement: "current_release" | "future_milestone";
      milestone: string | null;
    }>;
  };
}

export interface QuestionFace {
  readonly decisionId: string;
  readonly questionId: string | null;
  readonly criterionId: string;
  readonly status: string;
  readonly options: readonly string[];
  readonly optionsVersion: number;
}

export interface QuestionCard {
  readonly batchId: string;
  readonly cursor: number;
  readonly status: string;
  readonly questions: readonly QuestionFace[];
}

export interface DelegationSelectionResult {
  readonly workItemId: string;
  readonly criterionId: string;
  readonly value: string;
  readonly basis: "delegated";
  readonly status: "settled";
  readonly credit: 1;
  readonly opId: string;
  readonly turnId: string;
}

export interface BatchQuestionInput {
  readonly decisionId: string;
  readonly questionId: string;
  readonly criterionId: string;
  readonly title: string;
  readonly options: readonly string[];
}

const ANCHOR_INTERPRETATIONS: Readonly<Record<string, readonly string[]>> = {
  "product.purpose": [
    "What is the one job a person finishes in the first version?",
    "What would be on screen when that job is done?",
  ],
  "opening.1": [
    "What is the one job a person finishes in the first version?",
    "What would be on screen when that job is done?",
  ],
  "product.audience": [
    "Who is the first person that will use this?",
    "What is hard for that person today?",
  ],
  "opening.2": [
    "Who is the first person that will use this?",
    "What is hard for that person today?",
  ],
  "workflows.primary": [
    "Who acts, what do they do, and what is true at the end of one successful use?",
  ],
  "opening.3": [
    "Who acts, what do they do, and what is true at the end of one successful use?",
  ],
  "opening.4": ["What is the one result the first demo must show?"],
};

const RECOMMENDATIONS = [
  "Use SQLite, a free local database, for the first demo.",
  "Name one product, platform, or budget decision that is already fixed.",
];

export interface DiscoverySessionOptions {
  readonly graph: KnowledgeGraphRepo;
  readonly drafts: DraftStore;
  readonly catalog?: ActiveCatalog;
  readonly rubricMap?: OpeningRubricMap;
  readonly reviewer?: OpeningReviewer;
  readonly model?: DiscoveryModelPort;
  readonly now?: () => number;
}

/**
 * Discovery session core. Draft autosave, silence, and a closed laptop never
 * commit a turn, call a model, or revise scope. Only explicit send does.
 * Talk-it-through and one-question-at-a-time are presentation modes over one pipeline.
 */
export class DiscoverySessionManager {
  readonly repo: DiscoveryDbRepo;
  private readonly drafts: DraftStore;
  private readonly reviewer: OpeningReviewer;
  private readonly model: DiscoveryModelPort | null;
  private readonly now: () => number;
  private readonly frozen = new Map<string, QuestionCard>();
  private readonly pendingOptions = new Map<string, readonly string[]>();

  constructor(options: DiscoverySessionOptions) {
    const catalog = options.catalog ?? defaultOpeningCatalog();
    const rubricMap = options.rubricMap ?? OPENING_RUBRIC_MAP_V1;
    validateOpeningRubricMap(rubricMap, catalog);
    this.repo = new DiscoveryDbRepo(options.graph, options.now);
    this.drafts = options.drafts;
    this.reviewer = options.reviewer ?? new DeterministicOpeningReviewer();
    this.model = options.model ?? null;
    this.now = options.now ?? (() => Date.now());
  }

  close(): void {
    this.repo.close();
  }

  present(
    mode: PresentationMode,
    options: {
      currentPromptId?: OpeningRubricId;
      expandedPromptIds?: readonly OpeningRubricId[];
      expandAllExamples?: boolean;
    } = {},
  ): OpeningPresentation {
    return presentOpening({ mode, ...options });
  }

  prompts(): readonly OpeningPrompt[] {
    return presentOpening({ mode: "talk_it_through" }).prompts.map((prompt) => ({
      id: prompt.id,
      index: prompt.index,
      text: prompt.text,
      example: prompt.example,
    }));
  }

  startProject(input: { workItemId: string; title: string }): ScopeSnapshot {
    return this.repo.transaction(() => {
      if (this.repo.listWorkItems().some((item) => item.kind === "project")) {
        throw new DiscoveryStateError("a project work item already exists");
      }
      this.repo.insertWorkItem({
        id: input.workItemId,
        kind: "project",
        title: input.title,
        status: "discovering",
        createdAt: this.now(),
      });
      return this.seedScope(input.workItemId, "Initial discovery scope.", mappedCriterionIds());
    });
  }

  addBrownfieldWorkItem(input: {
    id: string;
    kind: "change" | "fix" | "feature_request";
    title: string;
  }): void {
    this.repo.transaction(() => {
      this.repo.insertWorkItem({
        id: input.id,
        kind: input.kind,
        title: input.title,
        status: "discovering",
        createdAt: this.now(),
      });
      const change = this.repo.allocateChangeSet({
        origin: "kernel",
        author: "discovery",
        summary: `Brownfield ${input.kind} scope`,
      });
      this.repo.insertScope({
        workItemId: input.id,
        scopeRev: 1,
        createdRev: change.rev,
        reason: "Brownfield discovery scope.",
      });
    });
  }

  reviseScope(input: {
    workItemId: string;
    reason: string;
    added: readonly {
      decisionId: string;
      criterionId: string;
      title: string;
      neededForPlanning?: boolean;
      critical?: boolean;
    }[];
  }): ScopeSnapshot {
    return this.repo.transaction(() => {
      this.requireWorkItem(input.workItemId);
      const change = this.repo.allocateChangeSet({
        origin: "chat",
        author: "developer",
        summary: input.reason,
      });
      for (const added of input.added) {
        if (!this.repo.getDecision(added.decisionId)) {
          this.repo.insertDecision({
            id: added.decisionId,
            title: added.title,
            text: "",
            fields: openFields(added.criterionId, input.workItemId),
            changeSetId: change.id,
            rev: change.rev,
          });
        }
      }
      return this.advanceScope(input.workItemId, change.rev, input.reason, input.added);
    });
  }

  placeBatch(input: {
    workItemId: string;
    id: string;
    questions: readonly BatchQuestionInput[];
  }): BatchRow {
    return this.repo.transaction(() => {
      const scope = this.requireScope(input.workItemId);
      const change = this.repo.allocateChangeSet({
        origin: "kernel",
        author: "discovery",
        summary: `Open batch ${input.id}`,
      });
      for (const question of input.questions) {
        if (this.repo.getDecision(question.decisionId)) continue;
        this.repo.insertDecision({
          id: question.decisionId,
          title: question.title,
          text: "",
          fields: {
            ...openFields(question.criterionId, input.workItemId),
            question_id: question.questionId,
            options: [...question.options],
            options_version: 1,
          },
          changeSetId: change.id,
          rev: change.rev,
        });
      }
      const batch: BatchRow = {
        id: input.id,
        workItemId: input.workItemId,
        scopeRev: scope.scope.scopeRev,
        status: "open",
        questionIds: input.questions.map((question) => question.decisionId),
        cursor: 0,
        createdAt: this.now(),
      };
      this.repo.insertBatch(batch);
      return batch;
    });
  }

  markBatchAnswered(batchId: string): void {
    this.repo.updateBatch(batchId, { status: "answered" });
  }

  beginInput(workItemId: string): QuestionCard {
    const card = this.readCard(workItemId);
    this.frozen.set(workItemId, card);
    return structuredClone(card);
  }

  currentCard(workItemId: string): QuestionCard {
    const frozen = this.frozen.get(workItemId);
    return structuredClone(frozen ?? this.readCard(workItemId));
  }

  stageOptionChange(workItemId: string, decisionId: string, options: readonly string[]): void {
    if (this.frozen.has(workItemId)) {
      this.pendingOptions.set(decisionId, [...options]);
      return;
    }
    this.writeOptions(decisionId, options);
  }

  /**
   * Typing, dictation silence, and closing the laptop save a draft only.
   * They do not insert turns, revise scope, mutate decisions, or call a model.
   */
  saveDraft(input: { workItemId: string; target: string | null; text: string }): DiscoveryDraft {
    const draft: DiscoveryDraft = {
      workItemId: input.workItemId,
      target: input.target,
      text: input.text,
      updatedAt: this.now(),
    };
    this.drafts.save(draft);
    return draft;
  }

  noteDictationSilence(input: { workItemId: string; target: string | null; text: string }): DiscoveryDraft {
    return this.saveDraft(input);
  }

  noteLaptopClosed(input: { workItemId: string; target: string | null; text: string }): DiscoveryDraft {
    return this.saveDraft(input);
  }

  loadDraft(workItemId: string): DiscoveryDraft | null {
    return this.drafts.load(workItemId);
  }

  send(input: { workItemId: string; text: string; target: string | null; opId: string }): SendResult {
    const text = input.text.normalize("NFC");
    const hash = requestHash({
      kind: "discovery.send",
      workItemId: input.workItemId,
      target: input.target,
      text,
    });
    const existing = this.readOperation<SendResult>(input.opId, hash);
    if (existing) return existing;
    this.requireWorkItem(input.workItemId);

    let result: SendResult;
    if (isBlank(text)) {
      result = this.commitEmpty(input.workItemId, input.target, text, input.opId, hash);
    } else if (isConfusion(text)) {
      result = this.commitClarify(input.workItemId, input.target, text, input.opId, hash);
    } else if (isDecideForMe(text) && anchorInterpretations(input.target)) {
      result = this.commitAnchor(input.workItemId, input.target, text, input.opId, hash);
    } else if (isDontKnow(text)) {
      result = this.commitRecommendation(input.workItemId, input.target, text, input.opId, hash);
    } else {
      const review = this.reviewer.review(text, input.target);
      const release = classifyReleaseIntent(text);
      const question = input.target ? this.repo.findDecisionByQuestionId(input.target) : null;
      if (question && review.evidence.length === 0 && release.length === 0 && !review.delegation) {
        result = this.commitBatchAnswer(input.workItemId, question, text, input.opId, hash);
      } else {
        result = this.commitStory(
          input.workItemId,
          input.target,
          text,
          input.opId,
          hash,
          review,
          release,
        );
      }
    }
    this.afterExplicitSend(input.workItemId, result);
    return result;
  }

  selectDelegatedValue(input: {
    workItemId: string;
    criterionId: string;
    value: string;
    opId: string;
  }): DelegationSelectionResult {
    const hash = requestHash({
      kind: "discovery.select_delegated_value",
      workItemId: input.workItemId,
      criterionId: input.criterionId,
      value: input.value,
    });
    const existing = this.readOperation<DelegationSelectionResult>(input.opId, hash);
    if (existing) return existing;
    const current = this.repo.findDecisionByCriterion(input.workItemId, input.criterionId);
    if (!current?.fields.delegation) {
      throw new DelegationBoundsError(`no open delegation for ${input.criterionId}`);
    }
    if (!valueSatisfiesLimits(input.value, current.fields.delegation.limits)) {
      throw new DelegationBoundsError(
        `${input.value} is outside delegation limits ${current.fields.delegation.limits.join(", ")}`,
      );
    }
    const result = this.repo.transaction(() => {
      const change = this.repo.allocateChangeSet({
        origin: "chat",
        author: "developer",
        summary: `Select delegated value for ${input.criterionId}`,
      });
      const fresh = this.repo.getDecision(current.id);
      if (!fresh) throw new DiscoveryStateError(`missing ${current.id}`);
      this.repo.updateDecision({
        id: fresh.id,
        title: fresh.title,
        text: input.value,
        fields: {
          ...fresh.fields,
          status: "settled",
          basis: "delegated",
          value: input.value,
        },
        changeSetId: change.id,
        rev: change.rev,
        expectedVersion: fresh.version,
      });
      const turn = this.insertTurn(input.workItemId, input.criterionId, input.value);
      const stored: DelegationSelectionResult = {
        workItemId: input.workItemId,
        criterionId: input.criterionId,
        value: input.value,
        basis: "delegated",
        status: "settled",
        credit: 1,
        opId: input.opId,
        turnId: turn.id,
      };
      this.remember(input.opId, "discovery.select_delegated_value", hash, stored, change.rev);
      return stored;
    });
    return result;
  }

  moveFeatureToLater(input: { workItemId: string; feature: string; opId: string }): ScopeSnapshot {
    const hash = requestHash({
      kind: "discovery.move_to_later",
      workItemId: input.workItemId,
      feature: input.feature,
    });
    const existing = this.readOperation<ScopeSnapshot>(input.opId, hash);
    if (existing) return existing;
    return this.repo.transaction(() => {
      const criterionId = `release.${input.feature}`;
      const decision = this.repo.findDecisionByCriterion(input.workItemId, criterionId);
      if (!decision) throw new DiscoveryStateError(`release feature ${input.feature} is not in scope`);
      const change = this.repo.allocateChangeSet({
        origin: "chat",
        author: "developer",
        summary: `Move ${input.feature} to later`,
      });
      const value: Record<string, unknown> =
        decision.fields.value &&
        typeof decision.fields.value === "object" &&
        !Array.isArray(decision.fields.value)
          ? { ...(decision.fields.value as Record<string, unknown>) }
          : { feature: input.feature };
      value.placement = "future_milestone";
      value.milestone = "later";
      value.moveToLater = false;
      this.repo.updateDecision({
        id: decision.id,
        title: decision.title,
        text: decision.text,
        fields: { ...decision.fields, value },
        changeSetId: change.id,
        rev: change.rev,
        expectedVersion: decision.version,
      });
      const reason = `Moved ${input.feature} from the current release to later.`;
      const snapshot = this.advanceScope(input.workItemId, change.rev, reason, [], {
        [decision.id]: false,
      });
      this.insertTurn(input.workItemId, criterionId, `Move ${input.feature} to later`);
      this.remember(input.opId, "discovery.move_to_later", hash, snapshot, change.rev);
      return snapshot;
    });
  }

  rubricCoverage(workItemId: string): Record<OpeningRubricId, "open" | "covered"> {
    const covered = this.coveredRubrics(workItemId);
    return Object.fromEntries(
      OPENING_RUBRIC_IDS.map((id) => [id, covered.has(id) ? "covered" : "open"]),
    ) as Record<OpeningRubricId, "open" | "covered">;
  }

  private commitEmpty(
    workItemId: string,
    target: string | null,
    text: string,
    opId: string,
    hash: string,
  ): SendResult {
    return this.repo.transaction(() => {
      const change = this.chatChange("Empty answer");
      const turn = this.insertTurn(workItemId, target, text);
      const result = this.baseResult({
        workItemId,
        turn,
        target,
        opId,
        text,
        route: "empty",
        credit: 0,
      });
      this.remember(opId, "discovery.send", hash, result, change.rev);
      return result;
    });
  }

  private commitClarify(
    workItemId: string,
    target: string | null,
    text: string,
    opId: string,
    hash: string,
  ): SendResult {
    const decision = this.resolveQuestion(workItemId, target);
    const title = this.requireWorkItem(workItemId).title;
    return this.repo.transaction(() => {
      const before = this.batchSummary(workItemId);
      const change = this.chatChange(`Clarify ${decision.fields.question_id ?? ""}`);
      const turn = this.insertTurn(workItemId, decision.fields.question_id ?? target, text);
      const result = this.baseResult({
        workItemId,
        turn,
        target,
        opId,
        text,
        route: "clarify@1",
        credit: 0,
        questionId: decision.fields.question_id ?? null,
        criterionId: decision.fields.criterion,
        rephrased: `In ${title}, ${decision.fields.question_id ?? ""} still asks about ${decision.fields.criterion}. Using one example from this project, which reading should we keep?`,
        batch: before,
      });
      this.remember(opId, "discovery.send", hash, result, change.rev);
      return result;
    });
  }

  private commitAnchor(
    workItemId: string,
    target: string | null,
    text: string,
    opId: string,
    hash: string,
  ): SendResult {
    const interpretations = anchorInterpretations(target);
    if (!interpretations) throw new DiscoveryStateError("not an anchor");
    return this.repo.transaction(() => {
      const change = this.chatChange("Ask for the smallest anchor");
      const turn = this.insertTurn(workItemId, target, text);
      const result = this.baseResult({
        workItemId,
        turn,
        target,
        opId,
        text,
        route: "anchor-interpretations",
        credit: 0,
        interpretations: [...interpretations],
        criterionId: target,
      });
      this.remember(opId, "discovery.send", hash, result, change.rev);
      return result;
    });
  }

  private commitRecommendation(
    workItemId: string,
    target: string | null,
    text: string,
    opId: string,
    hash: string,
  ): SendResult {
    return this.repo.transaction(() => {
      const change = this.chatChange("Offer a recommendation");
      const turn = this.insertTurn(workItemId, target, text);
      const result = this.baseResult({
        workItemId,
        turn,
        target,
        opId,
        text,
        route: "recommendation",
        credit: 0,
        recommendations: [...RECOMMENDATIONS],
      });
      this.remember(opId, "discovery.send", hash, result, change.rev);
      return result;
    });
  }

  private commitBatchAnswer(
    workItemId: string,
    decision: DecisionRecord,
    text: string,
    opId: string,
    hash: string,
  ): SendResult {
    return this.repo.transaction(() => {
      const change = this.chatChange(`Answer ${decision.fields.question_id ?? decision.id}`);
      this.applyPending(change.id, change.rev);
      const fresh = this.repo.getDecision(decision.id) ?? decision;
      const updated = this.repo.updateDecision({
        id: fresh.id,
        title: fresh.title,
        text,
        fields: {
          ...stripBasis(fresh.fields),
          status: "settled",
          basis: "explicit",
          value: text,
        },
        changeSetId: change.id,
        rev: change.rev,
        expectedVersion: fresh.version,
      });
      const batch = this.repo.getOpenBatch(workItemId);
      let batchSummary = this.batchSummary(workItemId);
      if (batch && batch.questionIds[batch.cursor] === updated.id) {
        this.repo.updateBatch(batch.id, { cursor: batch.cursor + 1 });
        batchSummary = this.batchSummary(workItemId);
      }
      const turn = this.insertTurn(workItemId, fresh.fields.question_id ?? null, text);
      const result = this.baseResult({
        workItemId,
        turn,
        target: fresh.fields.question_id ?? null,
        opId,
        text,
        route: "batch-answer",
        credit: updated.credit,
        questionId: fresh.fields.question_id ?? null,
        criterionId: fresh.fields.criterion,
        batch: batchSummary,
      });
      this.remember(opId, "discovery.send", hash, result, change.rev);
      return result;
    });
  }

  private commitStory(
    workItemId: string,
    target: string | null,
    text: string,
    opId: string,
    hash: string,
    review: OpeningReview,
    release: readonly ReleaseIntent[],
  ): SendResult {
    return this.repo.transaction(() => {
      const change = this.chatChange("Commit discovery turn");
      this.applyPending(change.id, change.rev);
      const turn = this.insertTurn(workItemId, target, text);
      let credit = this.applyReview(workItemId, turn.id, text, review, change.id, change.rev);
      const releaseWrite = this.applyRelease(workItemId, release, change.rev, change.id);
      credit += releaseWrite.credit;
      const result = this.baseResult({
        workItemId,
        turn,
        target,
        opId,
        text,
        route: "opening-review@1",
        credit,
        rubricsCovered: [...review.rubricsCovered],
        evidence: review.evidence.map((span) => ({
          rubricId: span.rubricId,
          quote: span.quote,
          start: span.start,
          end: span.end,
        })),
        followUp: this.followUp(workItemId),
        delegation: review.delegation
          ? { scope: review.delegation.scope, limits: [...review.delegation.limits], turn: turn.id }
          : null,
        batch: this.batchSummary(workItemId),
        changeSummary: {
          scopeRev: releaseWrite.scopeRev,
          reason: releaseWrite.reason,
          actions: release
            .filter((item) => item.moveToLater)
            .map((item) => ({ type: "move_to_later" as const, feature: item.feature })),
          release: release.map((item) => ({
            feature: item.feature,
            placement: item.placement,
            milestone: item.milestone,
          })),
        },
      });
      this.remember(opId, "discovery.send", hash, result, change.rev);
      return result;
    });
  }

  private applyReview(
    workItemId: string,
    turnId: string,
    text: string,
    review: OpeningReview,
    changeSetId: string,
    rev: number,
  ): number {
    const cache = new Map<string, DecisionRecord>();
    const load = (criterionId: string): DecisionRecord | null => {
      const cached = cache.get(criterionId);
      if (cached) return cached;
      const found = this.repo.findDecisionByCriterion(workItemId, criterionId);
      if (found) cache.set(criterionId, found);
      return found;
    };
    const save = (current: DecisionRecord, fields: DecisionFields): DecisionRecord => {
      const updated = this.repo.updateDecision({
        id: current.id,
        title: current.title,
        text: current.text,
        fields,
        changeSetId,
        rev,
        expectedVersion: current.version,
      });
      cache.set(fields.criterion, updated);
      return updated;
    };
    let granted = 0;
    const bump = (before: DecisionRecord, after: DecisionRecord) => {
      if (before.credit === 0 && after.credit === 1) granted += 1;
    };
    for (const explicit of review.explicitValues) {
      const current = load(explicit.criterionId);
      if (!current || current.fields.status === "settled") continue;
      assertExactQuote(text, explicit);
      const after = save(current, {
        ...stripBasis(current.fields),
        status: "settled",
        basis: "explicit",
        value: explicit.value,
        evidence: appendEvidence(current.fields.evidence, evidenceFrom(explicit, turnId)),
      });
      bump(current, after);
    }
    for (const criterionId of review.partialCriteria) {
      const current = load(criterionId);
      if (!current || current.fields.status === "settled" || current.fields.status === "partial") {
        continue;
      }
      const span = review.evidence.find((item) => item.rubricId === "opening.3");
      save(
        current,
        withEvidence(
          {
            ...stripBasis(current.fields),
            status: "partial",
            value: null,
          },
          span ? appendEvidence(current.fields.evidence, evidenceFrom(span, turnId)) : current.fields.evidence,
        ),
      );
    }
    for (const example of review.acceptanceExamples) {
      const current = load("workflows.primary");
      if (!current) continue;
      assertExactQuote(text, example);
      const examples = [...(current.fields.acceptance_examples ?? []), example.quote];
      const next: DecisionFields = {
        ...current.fields,
        acceptance_examples: examples,
        evidence: appendEvidence(current.fields.evidence, evidenceFrom(example, turnId)),
      };
      if (current.fields.status === "open") {
        save(current, { ...stripBasis(next), status: "partial", value: next.value ?? null });
      } else {
        save(current, next);
      }
    }
    for (const criterionId of review.needsConfirmation) {
      const current = load(criterionId);
      if (!current || current.fields.status === "settled" || current.fields.needs_confirmation) continue;
      const span = review.acceptanceExamples[0];
      save(
        current,
        withEvidence(
          {
            ...stripBasis(current.fields),
            status: "open",
            value: null,
            needs_confirmation: true,
          },
          span ? appendEvidence(current.fields.evidence, evidenceFrom(span, turnId)) : current.fields.evidence,
        ),
      );
    }
    if (review.delegation) {
      const current = load("constraints.stack_preferences");
      if (current && current.fields.status !== "settled" && !current.fields.delegation) {
        const span = review.evidence.find((item) => item.quote.toLowerCase().includes("database"));
        save(
          current,
          withEvidence(
            {
              ...stripBasis(current.fields),
              status: "open",
              value: null,
              delegation: {
                scope: review.delegation.scope,
                limits: [...review.delegation.limits],
                turn: turnId,
              },
            },
            span ? appendEvidence(current.fields.evidence, evidenceFrom(span, turnId)) : current.fields.evidence,
          ),
        );
      }
    }
    return granted;
  }

  private applyRelease(
    workItemId: string,
    release: readonly ReleaseIntent[],
    rev: number,
    changeSetId: string,
  ): { credit: number; scopeRev: number | null; reason: string | null } {
    if (release.length === 0) return { credit: 0, scopeRev: null, reason: null };
    const added: Array<{ decisionId: string; neededForPlanning: boolean }> = [];
    let credit = 0;
    for (const intent of release) {
      const criterionId = `release.${intent.feature}`;
      const decisionId = `D-release-${intent.feature}`;
      if (this.repo.getDecision(decisionId) || this.repo.findDecisionByCriterion(workItemId, criterionId)) {
        continue;
      }
      this.repo.insertDecision({
        id: decisionId,
        title: intent.feature,
        text: intent.feature,
        fields: {
          criterion: criterionId,
          status: "settled",
          basis: "explicit",
          value: {
            placement: intent.placement,
            feature: intent.feature,
            milestone: intent.milestone,
            moveToLater: intent.moveToLater,
          },
          work_item: workItemId,
        },
        changeSetId,
        rev,
      });
      credit += 1;
      added.push({
        decisionId,
        neededForPlanning: intent.placement === "current_release",
      });
    }
    if (added.length === 0) return { credit, scopeRev: null, reason: null };
    const reason = releaseReason(release);
    const snapshot = this.advanceScope(
      workItemId,
      rev,
      reason,
      added.map((item) => ({
        decisionId: item.decisionId,
        criterionId: "",
        title: "",
        neededForPlanning: item.neededForPlanning,
        critical: false,
      })),
    );
    return { credit, scopeRev: snapshot.scope.scopeRev, reason };
  }

  private seedScope(workItemId: string, reason: string, criterionIds: readonly string[]): ScopeSnapshot {
    const change = this.repo.allocateChangeSet({
      origin: "kernel",
      author: "discovery",
      summary: reason,
    });
    const mustAsk = new Set(["product.purpose", "product.audience", "workflows.primary"]);
    for (const criterionId of criterionIds) {
      this.repo.insertDecision({
        id: `D-${criterionId.replaceAll(".", "-")}`,
        title: criterionId,
        text: "",
        fields: openFields(criterionId, workItemId),
        changeSetId: change.id,
        rev: change.rev,
      });
    }
    this.repo.insertScope({
      workItemId,
      scopeRev: 1,
      createdRev: change.rev,
      reason,
    });
    for (const criterionId of criterionIds) {
      this.repo.insertScopeCriterion({
        workItemId,
        scopeRev: 1,
        decisionId: `D-${criterionId.replaceAll(".", "-")}`,
        neededForPlanning: true,
        critical: mustAsk.has(criterionId),
      });
    }
    const snapshot = this.repo.latestScope(workItemId);
    if (!snapshot) throw new DiscoveryStateError("scope seed failed");
    return snapshot;
  }

  private advanceScope(
    workItemId: string,
    createdRev: number,
    reason: string,
    added: readonly {
      decisionId: string;
      criterionId: string;
      title: string;
      neededForPlanning?: boolean;
      critical?: boolean;
    }[],
    neededOverride: Readonly<Record<string, boolean>> = {},
  ): ScopeSnapshot {
    const latest = this.requireScope(workItemId);
    const scopeRev = latest.scope.scopeRev + 1;
    this.repo.insertScope({ workItemId, scopeRev, createdRev, reason });
    for (const criterion of latest.criteria) {
      const override = neededOverride[criterion.decisionId];
      this.repo.insertScopeCriterion({
        workItemId,
        scopeRev,
        decisionId: criterion.decisionId,
        neededForPlanning: override ?? criterion.neededForPlanning,
        critical: criterion.critical,
      });
    }
    for (const criterion of added) {
      this.repo.insertScopeCriterion({
        workItemId,
        scopeRev,
        decisionId: criterion.decisionId,
        neededForPlanning: criterion.neededForPlanning ?? true,
        critical: criterion.critical ?? false,
      });
    }
    const snapshot = this.repo.latestScope(workItemId);
    if (!snapshot || snapshot.scope.scopeRev !== scopeRev) {
      throw new DiscoveryStateError("scope revision was not stored");
    }
    return snapshot;
  }

  private applyPending(changeSetId: string, rev: number): void {
    for (const [decisionId, options] of this.pendingOptions) {
      this.writeOptions(decisionId, options, changeSetId, rev);
    }
    this.pendingOptions.clear();
  }

  private writeOptions(
    decisionId: string,
    options: readonly string[],
    changeSetId?: string,
    rev?: number,
  ): void {
    const write = () => {
      const decision = this.repo.getDecision(decisionId);
      if (!decision) throw new DiscoveryStateError(`decision ${decisionId} does not exist`);
      const change =
        changeSetId && rev
          ? { id: changeSetId, rev }
          : this.repo.allocateChangeSet({
              origin: "kernel",
              author: "discovery",
              summary: `Options for ${decisionId}`,
            });
      this.repo.updateDecision({
        id: decision.id,
        title: decision.title,
        text: decision.text,
        fields: {
          ...decision.fields,
          options: [...options],
          options_version: (decision.fields.options_version ?? 1) + 1,
        },
        changeSetId: change.id,
        rev: change.rev,
        expectedVersion: decision.version,
      });
    };
    if (changeSetId && rev) write();
    else this.repo.transaction(write);
  }

  private insertTurn(workItemId: string, target: string | null, text: string): { id: string; sequence: number } {
    void workItemId;
    const sequence = this.repo.countTurns() + 1;
    const id = `turn-${String(sequence).padStart(4, "0")}`;
    this.repo.insertTurn({
      id,
      author: "developer",
      target,
      text,
      createdAt: this.now(),
    });
    return { id, sequence };
  }

  private remember(
    opId: string,
    kind: string,
    hash: string,
    result: unknown,
    committedRev: number,
  ): void {
    this.repo.insertOperation({
      opId,
      kind,
      requestHash: hash,
      resultJson: JSON.stringify(result),
      committedRev,
      createdAt: this.now(),
    });
  }

  private readOperation<T>(opId: string, hash: string): T | null {
    const existing = this.repo.getOperation(opId);
    if (!existing) return null;
    if (existing.requestHash !== hash) throw new IdempotencyConflictError(opId);
    return JSON.parse(existing.resultJson) as T;
  }

  private afterExplicitSend(workItemId: string, result: SendResult): void {
    this.frozen.delete(workItemId);
    this.drafts.clear(workItemId);
    if (!result.modelInvoked || !this.model) return;
    const kind =
      result.route === "clarify@1"
        ? "clarify@1"
        : result.route === "recommendation"
          ? "recommendation"
          : result.route === "batch-answer"
            ? "batch-answer"
            : "opening-review@1";
    this.model.onExplicitSend({
      kind,
      turnId: result.turnId,
      text: result.text,
      target: result.target,
      questionId: result.questionId,
      criterionId: result.criterionId,
    });
  }

  private baseResult(input: {
    workItemId: string;
    turn: { id: string; sequence: number };
    target: string | null;
    opId: string;
    text: string;
    route: SendResult["route"];
    credit: number;
    rubricsCovered?: OpeningRubricId[];
    evidence?: SendResult["evidence"];
    followUp?: SendResult["followUp"];
    interpretations?: string[];
    recommendations?: string[];
    delegation?: SendResult["delegation"];
    questionId?: string | null;
    criterionId?: string | null;
    rephrased?: string | null;
    batch?: SendResult["batch"];
    changeSummary?: SendResult["changeSummary"];
  }): SendResult {
    const chunks = chunkTurnWithOffsets(input.text).map((chunk) => ({
      start: chunk.start,
      end: chunk.end,
    }));
    const invokeModel = this.model !== null && input.route !== "empty";
    return {
      workItemId: input.workItemId,
      turnId: input.turn.id,
      sequence: input.turn.sequence,
      target: input.target,
      opId: input.opId,
      text: input.text,
      route: input.route,
      modelInvoked: invokeModel,
      credit: input.credit,
      rubricsCovered: input.rubricsCovered ?? [],
      evidence: input.evidence ?? [],
      followUp: input.followUp ?? null,
      interpretations: input.interpretations ?? [],
      recommendations: input.recommendations ?? [],
      delegation: input.delegation ?? null,
      questionId: input.questionId ?? null,
      criterionId: input.criterionId ?? null,
      rephrased: input.rephrased ?? null,
      chunks,
      batch: input.batch ?? this.batchSummary(input.workItemId),
      changeSummary: input.changeSummary ?? {
        scopeRev: null,
        reason: null,
        actions: [],
        release: [],
      },
    };
  }

  private chatChange(summary: string): { id: string; rev: number } {
    return this.repo.allocateChangeSet({ origin: "chat", author: "developer", summary });
  }

  private followUp(workItemId: string): { rubricId: OpeningRubricId; prompt: string } | null {
    const covered = this.coveredRubrics(workItemId);
    for (const rubricId of OPENING_RUBRIC_IDS) {
      if (!covered.has(rubricId)) {
        return { rubricId, prompt: openingPrompt(rubricId).text };
      }
    }
    return null;
  }

  private coveredRubrics(workItemId: string): Set<OpeningRubricId> {
    const covered = new Set<OpeningRubricId>();
    const snapshot = this.repo.latestScope(workItemId);
    if (!snapshot) return covered;
    for (const criterion of snapshot.criteria) {
      const decision = this.repo.getDecision(criterion.decisionId);
      for (const span of decision?.fields.evidence ?? []) {
        if (isOpeningRubricId(span.rubricId)) covered.add(span.rubricId);
      }
    }
    return covered;
  }

  private batchSummary(workItemId: string): SendResult["batch"] {
    const batch = this.repo.getOpenBatch(workItemId);
    if (!batch) return null;
    return {
      id: batch.id,
      cursor: batch.cursor,
      status: batch.status,
      questionIds: [...batch.questionIds],
    };
  }

  private readCard(workItemId: string): QuestionCard {
    const batch = this.repo.getOpenBatch(workItemId);
    if (!batch) throw new DiscoveryStateError(`no open batch for ${workItemId}`);
    return {
      batchId: batch.id,
      cursor: batch.cursor,
      status: batch.status,
      questions: batch.questionIds.map((decisionId) => {
        const decision = this.repo.getDecision(decisionId);
        if (!decision) throw new DiscoveryStateError(`batch question ${decisionId} is missing`);
        return {
          decisionId,
          questionId: decision.fields.question_id ?? null,
          criterionId: decision.fields.criterion,
          status: decision.fields.status,
          options: [...(decision.fields.options ?? [])],
          optionsVersion: decision.fields.options_version ?? 1,
        };
      }),
    };
  }

  private resolveQuestion(workItemId: string, target: string | null): DecisionRecord {
    if (target) {
      const byQuestion = this.repo.findDecisionByQuestionId(target);
      if (byQuestion) return byQuestion;
    }
    const batch = this.repo.getOpenBatch(workItemId);
    if (batch) {
      const decisionId = batch.questionIds[batch.cursor];
      if (decisionId) {
        const decision = this.repo.getDecision(decisionId);
        if (decision && (target === null || target === decision.fields.question_id)) return decision;
      }
    }
    throw new UnknownQuestionError(target ?? "(current)");
  }

  private requireWorkItem(workItemId: string) {
    const item = this.repo.getWorkItem(workItemId);
    if (!item) throw new DiscoveryStateError(`work item ${workItemId} does not exist`);
    return item;
  }

  private requireScope(workItemId: string): ScopeSnapshot {
    const snapshot = this.repo.latestScope(workItemId);
    if (!snapshot) throw new DiscoveryStateError(`work item ${workItemId} has no scope`);
    return snapshot;
  }
}

function openFields(criterionId: string, workItemId: string): DecisionFields {
  return { criterion: criterionId, status: "open", value: null, work_item: workItemId };
}

function stripBasis(fields: DecisionFields): DecisionFields {
  let next: DecisionFields = {
    criterion: fields.criterion,
    status: fields.status,
    value: fields.value ?? null,
  };
  if (fields.delegation) next = { ...next, delegation: fields.delegation };
  if (fields.question_id !== undefined) next = { ...next, question_id: fields.question_id };
  if (fields.options) next = { ...next, options: fields.options };
  if (fields.options_version !== undefined) {
    next = { ...next, options_version: fields.options_version };
  }
  if (fields.acceptance_examples) {
    next = { ...next, acceptance_examples: fields.acceptance_examples };
  }
  if (fields.evidence) next = { ...next, evidence: fields.evidence };
  if (fields.needs_confirmation === true) next = { ...next, needs_confirmation: true };
  if (fields.work_item !== undefined) next = { ...next, work_item: fields.work_item };
  return next;
}

function withEvidence(
  fields: DecisionFields,
  evidence: readonly EvidenceSpan[] | undefined,
): DecisionFields {
  if (!evidence) return fields;
  return { ...fields, evidence };
}

function appendEvidence(
  existing: readonly EvidenceSpan[] | undefined,
  span: EvidenceSpan,
): EvidenceSpan[] {
  const evidence = [...(existing ?? [])];
  if (evidence.some((item) => item.rubricId === span.rubricId && item.quote === span.quote)) {
    return evidence;
  }
  evidence.push(span);
  return evidence;
}

function evidenceFrom(
  span: { rubricId: string; quote: string; start: number; end: number },
  turnId: string,
): EvidenceSpan {
  return {
    rubricId: span.rubricId,
    turnId,
    quote: span.quote,
    start: span.start,
    end: span.end,
  };
}

function assertExactQuote(text: string, span: ReviewSpan | { quote: string; start: number; end: number }): void {
  if (text.slice(span.start, span.end) !== span.quote) {
    throw new DiscoveryStateError("evidence quote is not an exact substring of the turn");
  }
}

function anchorInterpretations(target: string | null): readonly string[] | null {
  if (!target) return null;
  return ANCHOR_INTERPRETATIONS[target] ?? null;
}

function releaseReason(release: readonly ReleaseIntent[]): string {
  const names = release.map((item) =>
    item.placement === "future_milestone" ? `${item.feature} after launch` : item.feature,
  );
  return `+${release.length} since your last message: you added ${names.join(", ")}`;
}

function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

function isConfusion(text: string): boolean {
  return /^\s*i don't understand[.!?]?\s*$/i.test(text);
}

function isDecideForMe(text: string): boolean {
  return /^\s*decide for me[.!?]?\s*$/i.test(text);
}

function isDontKnow(text: string): boolean {
  return /^\s*i don't know[.!?]?\s*$/i.test(text);
}
