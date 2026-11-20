import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  BasisStatusSeparationError,
  DelegationBoundsError,
  DiscoveryDbRepo,
  DiscoverySessionManager,
  FileDraftStore,
  IdempotencyConflictError,
  InvalidRubricMapError,
  LONG_TURN_CHUNK_MAX_CHARS,
  LocalSqliteKnowledgeGraph,
  OPENING_PROMPTS,
  OPENING_RUBRIC_MAP_V1,
  UNIFIED_TURN_PIPELINE,
  absoluteOffsets,
  chunkTurnWithOffsets,
  defaultOpeningCatalog,
  openStateDatabase,
  validateOpeningRubricMap,
  type ActiveCatalog,
  type DiscoveryModelPort,
  type DiscoveryModelRequest,
  type DecisionFields,
  type OpeningRubricMap,
} from "../../src/core/index.js";

class CountingModel implements DiscoveryModelPort {
  calls = 0;
  last: DiscoveryModelRequest | null = null;

  onExplicitSend(request: DiscoveryModelRequest): void {
    this.calls += 1;
    this.last = request;
  }
}

interface Fixture {
  dir: string;
  dbPath: string;
  session: DiscoverySessionManager;
  repo: DiscoveryDbRepo;
  model: CountingModel;
  now: () => number;
  workItemId: string;
  reopen(): DiscoverySessionManager;
  cleanup(): void;
}

function createFixture(options?: {
  catalog?: ActiveCatalog;
  rubricMap?: OpeningRubricMap;
  start?: boolean;
}): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-d069-"));
  const dbPath = path.join(dir, "state.db");
  const draftDir = path.join(dir, "drafts");
  let clock = 1_700_000_000_000;
  const now = () => {
    clock += 1;
    return clock;
  };
  const model = new CountingModel();
  const openSession = () => {
    const graph = new LocalSqliteKnowledgeGraph(dbPath);
    return new DiscoverySessionManager({
      graph,
      drafts: new FileDraftStore(draftDir),
      catalog: options?.catalog,
      rubricMap: options?.rubricMap,
      model,
      now,
    });
  };
  const session = openSession();
  const workItemId = "WI-PROJECT";
  if (options?.start !== false) {
    session.startProject({ workItemId, title: "Lunch orders" });
  }
  return {
    dir,
    dbPath,
    session,
    repo: session.repo,
    model,
    now,
    workItemId,
    reopen() {
      session.close();
      const reopened = openSession();
      this.session = reopened;
      this.repo = reopened.repo;
      return reopened;
    },
    cleanup() {
      this.session.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("opening rubric map and prompts", () => {
  it("defines the five opening prompts and one pipeline for both presentation modes", () => {
    expect(OPENING_PROMPTS.map((prompt) => prompt.text)).toEqual([
      "What would you like to build?",
      "Who will use it first, and what is hard for them today?",
      "Walk through one successful use. Who acts, what do they do and what happens at the end?",
      "What should the first demo prove? What can wait?",
      "Which product, platform or technology decisions are fixed, and where would you like a recommendation?",
    ]);
    const session = new DiscoverySessionManager({
      graph: new LocalSqliteKnowledgeGraph(":memory:"),
      drafts: new FileDraftStore(fs.mkdtempSync(path.join(os.tmpdir(), "ef-d069-draft-"))),
    });
    const together = session.present("talk_it_through", { expandAllExamples: true });
    const collapsed = session.present("talk_it_through");
    const one = session.present("one_question_at_a_time", { currentPromptId: "opening.3" });
    expect(together.pipeline).toBe(UNIFIED_TURN_PIPELINE);
    expect(one.pipeline).toBe(together.pipeline);
    expect(together.prompts.every((prompt) => prompt.visible)).toBe(true);
    expect(together.prompts.every((prompt) => prompt.exampleExpansion === "expanded")).toBe(true);
    expect(collapsed.prompts.every((prompt) => prompt.exampleExpansion === "collapsed")).toBe(true);
    const individual = session.present("talk_it_through", { expandedPromptIds: ["opening.2"] });
    expect(individual.prompts.filter((prompt) => prompt.exampleExpansion === "expanded").map((prompt) => prompt.id)).toEqual([
      "opening.2",
    ]);
    expect(one.prompts.filter((prompt) => prompt.visible).map((prompt) => prompt.id)).toEqual(["opening.3"]);
    expect(one.prompts.find((prompt) => prompt.id === "opening.3")?.exampleExpansion).toBe("expanded");
    session.close();
  });

  it("maps every opening rubric onto active catalog criteria", () => {
    expect(OPENING_RUBRIC_MAP_V1.version).toBe("opening-rubric-map@1");
    expect(OPENING_RUBRIC_MAP_V1.rubrics["opening.1"].targets.map((target) => target.criterionId)).toEqual([
      "product.purpose",
      "delivery.platform",
    ]);
    expect(OPENING_RUBRIC_MAP_V1.rubrics["opening.2"].targets.map((target) => target.criterionId)).toEqual([
      "product.audience",
      "actors.roles",
    ]);
    expect(OPENING_RUBRIC_MAP_V1.rubrics["opening.3"].targets).toEqual([
      { criterionId: "workflows.primary", coverage: "full" },
      { criterionId: "data.entities", coverage: "partial" },
    ]);
    expect(OPENING_RUBRIC_MAP_V1.rubrics["opening.4"].targets).toEqual([
      { criterionId: "workflows.primary", coverage: "acceptance_examples" },
      { criterionId: "product.stage", coverage: "inferred_confirmed" },
    ]);
    expect(OPENING_RUBRIC_MAP_V1.rubrics["opening.5"].recordsDelegations).toBe(true);
    expect(OPENING_RUBRIC_MAP_V1.rubrics["opening.5"].targets.map((target) => target.criterionId)).toEqual([
      "constraints.stack_preferences",
      "deploy.target",
      "constraints.deadline_budget",
    ]);
    expect(() => validateOpeningRubricMap(OPENING_RUBRIC_MAP_V1, defaultOpeningCatalog())).not.toThrow();
  });

  it("throws InvalidRubricMapError at startup when a mapped criterion is missing or misspelled", () => {
    const graph = new LocalSqliteKnowledgeGraph(":memory:");
    const drafts = new FileDraftStore(fs.mkdtempSync(path.join(os.tmpdir(), "ef-d069-draft-")));
    const retired: ActiveCatalog = {
      criteria: defaultOpeningCatalog().criteria.map((criterion) =>
        criterion.id === "deploy.target" ? { ...criterion, active: false } : criterion,
      ),
    };
    expect(
      () => new DiscoverySessionManager({ graph, drafts, catalog: retired }),
    ).toThrow(InvalidRubricMapError);
    const misspelled: OpeningRubricMap = {
      version: "opening-rubric-map@1",
      rubrics: {
        ...OPENING_RUBRIC_MAP_V1.rubrics,
        "opening.5": {
          recordsDelegations: true,
          targets: [
            ...OPENING_RUBRIC_MAP_V1.rubrics["opening.5"].targets,
            { criterionId: "billing.crypto", coverage: "full" },
          ],
        },
      },
    };
    try {
      new DiscoverySessionManager({
        graph,
        drafts,
        rubricMap: misspelled,
      });
      throw new Error("startup should have failed");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidRubricMapError);
      expect((error as InvalidRubricMapError).missingCriterionIds).toContain("billing.crypto");
    }
    expect(new DiscoveryDbRepo(graph).counts("work_items")).toBe(0);
    graph.close();
  });
});

describe("chunkTurnWithOffsets", () => {
  it("splits a 25000-character story into bounded overlapping chunks with exact turn offsets", () => {
    const marker = "MARKER-SOUP-x-2";
    const story = `${"A".repeat(12_000)}${marker}${"B".repeat(25_000 - 12_000 - marker.length)}`;
    expect(story).toHaveLength(25_000);
    const chunks = chunkTurnWithOffsets(story);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.start).toBe(0);
    expect(chunks[chunks.length - 1]?.end).toBe(25_000);
    expect(chunks[1]?.start).toBe(LONG_TURN_CHUNK_MAX_CHARS - 400);
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      if (!chunk) throw new Error("missing chunk");
      expect(chunk.end - chunk.start).toBeLessThanOrEqual(LONG_TURN_CHUNK_MAX_CHARS);
      expect(chunk.text).toBe(story.slice(chunk.start, chunk.end));
      if (index > 0) {
        const previous = chunks[index - 1];
        if (!previous) throw new Error("missing previous chunk");
        expect(chunk.start).toBeLessThan(previous.end);
        expect(chunk.start).toBeGreaterThan(previous.start);
      }
    }
    const owner = chunks.find((chunk) => chunk.text.includes(marker));
    if (!owner) throw new Error("marker was not covered");
    const local = owner.text.indexOf(marker);
    const absolute = absoluteOffsets(owner, local, local + marker.length);
    expect(story.slice(absolute.start, absolute.end)).toBe(marker);
  });
});

describe("discovery session core", () => {
  let ctx: Fixture;

  beforeEach(() => {
    ctx = createFixture();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("persists work items, scopes, criteria, and the open batch cursor across reopen", () => {
    ctx.session.placeBatch({
      workItemId: ctx.workItemId,
      id: "batch-1",
      questions: [
        {
          decisionId: "D-b1",
          questionId: "Q-b1",
          criterionId: "batch.warmup",
          title: "Warmup",
          options: ["a"],
        },
      ],
    });
    ctx.session.markBatchAnswered("batch-1");
    ctx.session.placeBatch({
      workItemId: ctx.workItemId,
      id: "batch-2",
      questions: [
        {
          decisionId: "D-b2",
          questionId: "Q-b2",
          criterionId: "batch.second",
          title: "Second",
          options: ["a"],
        },
      ],
    });
    ctx.session.markBatchAnswered("batch-2");
    const questions = [1, 2, 3, 4, 5].map((index) => ({
      decisionId: `D-b3-${index}`,
      questionId: `Q${index}`,
      criterionId: `batch.q${index}`,
      title: `Question ${index}`,
      options: ["keep", "change"],
    }));
    ctx.session.placeBatch({ workItemId: ctx.workItemId, id: "batch-3", questions });
    ctx.session.send({
      workItemId: ctx.workItemId,
      target: "Q1",
      text: "Settled answer one",
      opId: "ans-1",
    });
    ctx.session.send({
      workItemId: ctx.workItemId,
      target: "Q2",
      text: "Settled answer two",
      opId: "ans-2",
    });
    expect(ctx.repo.counts("work_items")).toBe(1);
    expect(ctx.repo.counts("discovery_scopes")).toBe(1);
    expect(ctx.repo.counts("scope_criteria")).toBeGreaterThan(0);
    expect(ctx.repo.counts("discovery_batches")).toBe(3);

    const reopened = ctx.reopen();
    const batch = reopened.repo.getOpenBatch(ctx.workItemId);
    expect(batch?.id).toBe("batch-3");
    expect(batch?.cursor).toBe(2);
    expect(batch?.questionIds).toEqual(["D-b3-1", "D-b3-2", "D-b3-3", "D-b3-4", "D-b3-5"]);
    expect(reopened.repo.getDecision("D-b3-1")?.fields.status).toBe("settled");
    expect(reopened.repo.getDecision("D-b3-2")?.fields.status).toBe("settled");
    for (const id of ["D-b3-3", "D-b3-4", "D-b3-5"]) {
      expect(reopened.repo.getDecision(id)?.fields.status).toBe("open");
    }
  });

  it("keeps drafts, silence, and a closed laptop from committing turns, scope, or model calls", () => {
    const versions = ctx.repo.listDecisions().map((decision) => [decision.id, decision.version]);
    const scopes = ctx.repo.listScopes(ctx.workItemId);
    ctx.session.saveDraft({ workItemId: ctx.workItemId, target: "opening.1", text: "lun" });
    ctx.session.noteDictationSilence({
      workItemId: ctx.workItemId,
      target: "opening.1",
      text: "lunch page",
    });
    ctx.session.noteLaptopClosed({
      workItemId: ctx.workItemId,
      target: "opening.1",
      text: "lunch page so far",
    });
    expect(ctx.repo.countTurns()).toBe(0);
    expect(ctx.repo.counts("operations")).toBe(0);
    expect(ctx.repo.listScopes(ctx.workItemId)).toEqual(scopes);
    expect(ctx.repo.listDecisions().map((decision) => [decision.id, decision.version])).toEqual(versions);
    expect(ctx.model.calls).toBe(0);
    ctx.session.close();
    const graph = new LocalSqliteKnowledgeGraph(ctx.dbPath);
    const resumed = new DiscoverySessionManager({
      graph,
      drafts: new FileDraftStore(path.join(ctx.dir, "drafts")),
      model: ctx.model,
      now: ctx.now,
    });
    expect(resumed.loadDraft(ctx.workItemId)?.text).toBe("lunch page so far");
    expect(resumed.repo.countTurns()).toBe(0);
    expect(ctx.model.calls).toBe(0);
    resumed.close();
  });

  it("gives empty answers and unbounded anchor requests zero credit", () => {
    const empty = ctx.session.send({
      workItemId: ctx.workItemId,
      target: "opening.5",
      text: "",
      opId: "empty-5",
    });
    expect(empty.route).toBe("empty");
    expect(empty.credit).toBe(0);
    expect(empty.evidence).toEqual([]);
    expect(empty.delegation).toBeNull();
    expect(empty.modelInvoked).toBe(false);
    expect(ctx.model.calls).toBe(0);
    expect(ctx.session.rubricCoverage(ctx.workItemId)["opening.5"]).toBe("open");
    const stack = ctx.repo.findDecisionByCriterion(ctx.workItemId, "constraints.stack_preferences");
    expect(stack?.fields.status).toBe("open");
    expect(stack?.fields.value).toBeNull();
    expect(stack?.fields.delegation).toBeUndefined();
    expect(stack?.credit).toBe(0);
    expect(JSON.stringify(stack?.fields)).not.toContain("no constraints");

    for (const criterionId of ["product.purpose", "product.audience"] as const) {
      const result = ctx.session.send({
        workItemId: ctx.workItemId,
        target: criterionId,
        text: "Decide for me",
        opId: `anchor-${criterionId}`,
      });
      expect(result.route).toBe("anchor-interpretations");
      expect(result.interpretations.length).toBeGreaterThanOrEqual(1);
      expect(result.interpretations.length).toBeLessThanOrEqual(2);
      expect(result.credit).toBe(0);
      const decision = ctx.repo.findDecisionByCriterion(ctx.workItemId, criterionId);
      expect(decision?.fields.status).toBe("open");
      expect(decision?.fields.value).toBeNull();
      expect(decision?.fields.basis).toBeUndefined();
      expect(decision?.credit).toBe(0);
      for (const line of result.interpretations) {
        expect(decision?.fields.value).not.toBe(line);
      }
    }

    const unknown = ctx.session.send({
      workItemId: ctx.workItemId,
      target: "opening.5",
      text: "I don't know",
      opId: "dont-know",
    });
    expect(unknown.route).toBe("recommendation");
    expect(unknown.recommendations.length).toBeGreaterThanOrEqual(1);
    expect(unknown.credit).toBe(0);
    expect(unknown.delegation).toBeNull();
    expect(stack?.fields.delegation).toBeUndefined();
  });

  it("records a bounded delegation with zero credit until a value inside the limits is chosen", () => {
    const recorded = ctx.session.send({
      workItemId: ctx.workItemId,
      target: "opening.5",
      text: "Choose a free local database for the demo",
      opId: "delegate-db",
    });
    const decision = ctx.repo.findDecisionByCriterion(ctx.workItemId, "constraints.stack_preferences");
    expect(decision?.fields.status).toBe("open");
    expect(decision?.fields.basis).toBeUndefined();
    expect(decision?.fields.value).toBeNull();
    expect(decision?.credit).toBe(0);
    expect(decision?.fields.delegation).toEqual({
      scope: "Choose a free local database for the demo",
      limits: ["free", "local"],
      turn: recorded.turnId,
    });
    expect(recorded.rubricsCovered).toContain("opening.5");
    expect(() =>
      ctx.session.selectDelegatedValue({
        workItemId: ctx.workItemId,
        criterionId: "constraints.stack_preferences",
        value: "paid-hosted-oracle",
        opId: "delegate-bad",
      }),
    ).toThrow(DelegationBoundsError);
    expect(ctx.repo.findDecisionByCriterion(ctx.workItemId, "constraints.stack_preferences")?.credit).toBe(0);
    const chosen = ctx.session.selectDelegatedValue({
      workItemId: ctx.workItemId,
      criterionId: "constraints.stack_preferences",
      value: "sqlite",
      opId: "delegate-sqlite",
    });
    expect(chosen.basis).toBe("delegated");
    expect(chosen.credit).toBe(1);
    const settled = ctx.repo.findDecisionByCriterion(ctx.workItemId, "constraints.stack_preferences");
    expect(settled?.fields.status).toBe("settled");
    expect(settled?.fields.basis).toBe("delegated");
    expect(settled?.fields.value).toBe("sqlite");
    expect(settled?.credit).toBe(1);
  });

  it("maps one rambling turn across all five rubrics and credits opening.4 from inside prompt 3", () => {
    const ramble = [
      "I would like to build a lunch-ordering page that collects Friday orders.",
      "Our office manager counts lunches by hand and that is hard for them today.",
      "Staff submit lunch choices and the kitchen sees totals grouped by dish.",
      "Submit two soup orders and the kitchen list should show Soup \u00d7 2.",
      "Use our existing web repo. Choose a free local database for the demo.",
    ].join(" ");
    const focused = ctx.session.present("one_question_at_a_time", { currentPromptId: "opening.3" });
    const soup = "two soup orders show Soup \u00d7 2";
    const fromPrompt3 = ctx.session.send({
      workItemId: ctx.workItemId,
      target: "opening.3",
      text: soup,
      opId: "soup",
    });
    expect(focused.pipeline).toBe(UNIFIED_TURN_PIPELINE);
    expect(fromPrompt3.rubricsCovered).toContain("opening.4");
    expect(fromPrompt3.followUp?.rubricId).not.toBe("opening.4");
    const demo = fromPrompt3.evidence.find((span) => span.rubricId === "opening.4");
    expect(demo).toBeTruthy();
    expect(soup.slice(demo?.start ?? 0, demo?.end ?? 0)).toBe(demo?.quote);

    const together = ctx.session.present("talk_it_through");
    const reviewed = ctx.session.send({
      workItemId: ctx.workItemId,
      target: null,
      text: ramble,
      opId: "ramble",
    });
    expect(together.pipeline).toBe(focused.pipeline);
    expect(reviewed.rubricsCovered).toEqual([
      "opening.1",
      "opening.2",
      "opening.3",
      "opening.4",
      "opening.5",
    ]);
    expect(reviewed.followUp).toBeNull();
    for (const span of reviewed.evidence) {
      expect(ramble.slice(span.start, span.end)).toBe(span.quote);
    }
    const stack = ctx.repo.findDecisionByCriterion(ctx.workItemId, "constraints.stack_preferences");
    expect(stack?.credit).toBe(0);
    expect(stack?.fields.delegation?.limits).toEqual(["free", "local"]);
    const entities = ctx.repo.findDecisionByCriterion(ctx.workItemId, "data.entities");
    expect(entities?.fields.status).toBe("partial");
    expect(entities?.credit).toBe(0);
    const stage = ctx.repo.findDecisionByCriterion(ctx.workItemId, "product.stage");
    expect(stage?.fields.status).toBe("open");
    expect(stage?.fields.needs_confirmation).toBe(true);
    expect(stage?.fields.value).toBeNull();
    expect(stage?.credit).toBe(0);

  });

  it("keeps Q17 and the open batch when the developer does not understand", () => {
    ctx.session.placeBatch({
      workItemId: ctx.workItemId,
      id: "batch-q17",
      questions: [
        {
          decisionId: "D-q17",
          questionId: "Q17",
          criterionId: "orders.late_edits",
          title: "Late edits",
          options: ["staff", "manager", "final"],
        },
      ],
    });
    const before = ctx.session.currentCard(ctx.workItemId);
    const result = ctx.session.send({
      workItemId: ctx.workItemId,
      target: "Q17",
      text: "I don't understand",
      opId: "clarify-q17",
    });
    const after = ctx.repo.getOpenBatch(ctx.workItemId);
    expect(result.route).toBe("clarify@1");
    expect(result.questionId).toBe("Q17");
    expect(result.criterionId).toBe("orders.late_edits");
    expect(result.rephrased).toContain("Q17");
    expect(result.rephrased).toContain("orders.late_edits");
    expect(after?.id).toBe(before.batchId);
    expect(after?.cursor).toBe(before.cursor);
    expect(after?.questionIds).toEqual(before.questions.map((question) => question.decisionId));
    expect(ctx.repo.listDecisions().filter((decision) => decision.fields.question_id === "Q17")).toHaveLength(1);
    expect(ctx.repo.getDecision("D-q17")?.fields.status).toBe("open");
    expect(ctx.model.last?.kind).toBe("clarify@1");
    expect(ctx.model.last?.questionId).toBe("Q17");
    expect(ctx.model.last?.criterionId).toBe("orders.late_edits");
  });

  it("returns the same turn for a duplicate op_id and does not call the model twice", () => {
    const text = "I would like to build a lunch-ordering page.";
    const first = ctx.session.send({
      workItemId: ctx.workItemId,
      target: "opening.1",
      text,
      opId: "same-op",
    });
    const second = ctx.session.send({
      workItemId: ctx.workItemId,
      target: "opening.1",
      text,
      opId: "same-op",
    });
    expect(second).toEqual(first);
    expect(ctx.model.calls).toBe(1);
    expect(ctx.repo.listTurns()).toHaveLength(1);
    expect(ctx.repo.getTurn(first.turnId)?.target).toBe("opening.1");
    expect(first.sequence).toBe(1);
    expect(() =>
      ctx.session.send({
        workItemId: ctx.workItemId,
        target: "opening.1",
        text: "a different request",
        opId: "same-op",
      }),
    ).toThrow(IdempotencyConflictError);
    expect(ctx.model.calls).toBe(1);
    expect(ctx.repo.listTurns()).toHaveLength(1);
  });

  it("freezes the question card from input start until submit", () => {
    ctx.session.placeBatch({
      workItemId: ctx.workItemId,
      id: "batch-card",
      questions: [
        {
          decisionId: "D-card",
          questionId: "Q-card",
          criterionId: "batch.card",
          title: "Card",
          options: ["one", "two"],
        },
      ],
    });
    const card = ctx.session.beginInput(ctx.workItemId);
    ctx.session.stageOptionChange(ctx.workItemId, "D-card", ["three", "four"]);
    ctx.session.saveDraft({ workItemId: ctx.workItemId, target: "Q-card", text: "still typing" });
    expect(ctx.session.currentCard(ctx.workItemId)).toEqual(card);
    expect(ctx.repo.getDecision("D-card")?.fields.options).toEqual(["one", "two"]);
    expect(ctx.repo.countTurns()).toBe(0);
    ctx.session.send({
      workItemId: ctx.workItemId,
      target: "Q-card",
      text: "one",
      opId: "card-send",
    });
    expect(ctx.repo.getDecision("D-card")?.fields.options).toEqual(["three", "four"]);
    expect(ctx.repo.getDecision("D-card")?.fields.options_version).toBe(2);
  });

  it("stores one turn for a long story and slices chunks from that text", () => {
    const story = `I would like to build a lunch-ordering page. ${"word ".repeat(6_000)}`;
    expect(story.length).toBeGreaterThan(25_000);
    const result = ctx.session.send({
      workItemId: ctx.workItemId,
      target: null,
      text: story,
      opId: "long-story",
    });
    expect(ctx.repo.listTurns()).toHaveLength(1);
    const turn = ctx.repo.getTurn(result.turnId);
    expect(turn?.text).toBe(story);
    expect(result.chunks.length).toBeGreaterThan(1);
    for (const chunk of result.chunks) {
      expect(chunk.end - chunk.start).toBeLessThanOrEqual(LONG_TURN_CHUNK_MAX_CHARS);
      expect(turn?.text.slice(chunk.start, chunk.end).length).toBe(chunk.end - chunk.start);
    }
    expect(result.rubricsCovered).toContain("opening.1");
  });

  it("classifies release intent and freezes a new scope revision with the previous snapshot", () => {
    const scrapped = ctx.session.send({
      workItemId: ctx.workItemId,
      target: null,
      text: "Maybe add printing ... actually, scrap printing",
      opId: "scrap-print",
    });
    expect(scrapped.changeSummary.release).toEqual([]);
    expect(ctx.repo.findDecisionByCriterion(ctx.workItemId, "release.printing")).toBeNull();
    expect(ctx.repo.listScopes(ctx.workItemId)).toHaveLength(1);

    const current = ctx.session.send({
      workItemId: ctx.workItemId,
      target: null,
      text: "Maybe add printing",
      opId: "add-print",
    });
    expect(current.changeSummary.release).toEqual([
      { feature: "printing", placement: "current_release", milestone: null },
    ]);
    expect(current.changeSummary.actions).toEqual([{ type: "move_to_later", feature: "printing" }]);
    expect(current.changeSummary.reason).toBe("+1 since your last message: you added printing");
    const printing = ctx.repo.findDecisionByCriterion(ctx.workItemId, "release.printing");
    expect(printing?.fields.basis).toBe("explicit");
    expect(printing?.credit).toBe(1);

    const later = ctx.session.send({
      workItemId: "WI-PROJECT",
      target: null,
      text: "Add export after launch",
      opId: "add-export",
    });
    expect(later.changeSummary.release).toEqual([
      { feature: "export", placement: "future_milestone", milestone: "after launch" },
    ]);
    expect(later.changeSummary.actions).toEqual([]);
    const before = ctx.repo.listScopeSnapshots(ctx.workItemId);
    const revision = ctx.session.reviseScope({
      workItemId: ctx.workItemId,
      reason: "+4 since your last message: you added email delivery",
      added: [1, 2, 3, 4].map((index) => ({
        decisionId: `D-email-${index}`,
        criterionId: `delivery.item_${index}`,
        title: `Email ${index}`,
      })),
    });
    const after = ctx.repo.listScopeSnapshots(ctx.workItemId);
    expect(revision.scope.reason).toBe("+4 since your last message: you added email delivery");
    expect(revision.scope.scopeRev).toBe((before[before.length - 1]?.scope.scopeRev ?? 0) + 1);
    expect(after[0]?.criteria.map((criterion) => criterion.decisionId)).toEqual(
      before[0]?.criteria.map((criterion) => criterion.decisionId),
    );
    expect(after[after.length - 1]?.criteria.length).toBe(
      (before[before.length - 1]?.criteria.length ?? 0) + 4,
    );
  });

  it("stores one project row and one row per brownfield kind", () => {
    ctx.session.addBrownfieldWorkItem({ id: "WI-CHANGE", kind: "change", title: "Change totals" });
    ctx.session.addBrownfieldWorkItem({ id: "WI-FIX", kind: "fix", title: "Fix cutoff" });
    ctx.session.addBrownfieldWorkItem({
      id: "WI-FR",
      kind: "feature_request",
      title: "Request export",
    });
    expect(ctx.repo.listWorkItems().map((item) => item.kind).sort()).toEqual([
      "change",
      "feature_request",
      "fix",
      "project",
    ]);
  });

  it("rolls back a scope snapshot when a criterion points at a missing decision", () => {
    const before = ctx.repo.counts("discovery_scopes");
    expect(() =>
      ctx.repo.transaction(() => {
        const change = ctx.repo.allocateChangeSet({
          origin: "kernel",
          author: "discovery",
          summary: "broken scope",
        });
        ctx.repo.insertScope({
          workItemId: ctx.workItemId,
          scopeRev: 99,
          createdRev: change.rev,
          reason: "should roll back",
        });
        ctx.repo.insertScopeCriterion({
          workItemId: ctx.workItemId,
          scopeRev: 99,
          decisionId: "missing-decision",
          neededForPlanning: true,
          critical: false,
        });
      }),
    ).toThrow();
    expect(ctx.repo.counts("discovery_scopes")).toBe(before);
    expect(ctx.repo.listScopes(ctx.workItemId).some((scope) => scope.scopeRev === 99)).toBe(false);
  });

  it("rejects a basis that is not a settled basis and a status used as a basis", () => {
    expect(() =>
      ctx.repo.transaction(() => {
        const change = ctx.repo.allocateChangeSet({
          origin: "kernel",
          author: "discovery",
          summary: "bad basis",
        });
        ctx.repo.insertDecision({
          id: "D-bad-basis",
          title: "bad",
          text: "",
          fields: {
            criterion: "product.purpose",
            status: "open",
            value: null,
            basis: "open",
          } as DecisionFields,
          changeSetId: change.id,
          rev: change.rev,
        });
      }),
    ).toThrow(BasisStatusSeparationError);

    const db: DatabaseSync = openStateDatabase(":memory:");
    db.prepare(
      "INSERT INTO change_sets(id, rev, origin, author, created_at, summary) VALUES ('cs-bad', 1, 'kernel', 'test', 0, 'bad')",
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
           VALUES ('D-sql', 'decision', 1, 'hash', 'bad', '', ?, 'cs-bad', 1, 1)`,
        )
        .run(JSON.stringify({ criterion: "product.purpose", status: "open", value: null, basis: "asked" })),
    ).toThrow(/CHECK/);
    db.close();
  });
});
