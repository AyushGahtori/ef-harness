import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  CatalogPrereqCycleError,
  InMemoryDiscoveryBatchStore,
  INSERT_DISCOVERY_BATCH_SQL,
  ProjectLocalQuestionDrafter,
  QuestionDrafterV1Schema,
  ScopeCriterionAskLedger,
  discoveryBatchInsertParams,
  selectNextBatch,
  type CatalogQuestion,
  type CriterionState,
  type QuestionDrafterPort,
  type QuestionDrafterRequest,
  type SelectionRequest,
  type SelectionResult,
} from "../../src/selector/index.js";

function criterion(
  overrides: Partial<CriterionState> & Pick<CriterionState, "id">,
): CriterionState {
  return {
    decisionId: `decision-${overrides.id}`,
    label: "a product choice",
    status: "open",
    mustAsk: false,
    scope: "leaf",
    askCount: 0,
    lastAskedTurn: null,
    skipCount: 0,
    ambiguous: false,
    requiresSettled: [],
    ...overrides,
  };
}

function question(
  overrides: Partial<CatalogQuestion> & Pick<CatalogQuestion, "id" | "targetCriteria">,
): CatalogQuestion {
  return {
    text: "Which option should we use?",
    options: [
      { id: "yes", label: "Yes", recommended: true },
      { id: "no", label: "No", recommended: false },
    ],
    requiresSettled: [],
    touches: ["interactive_ui"],
    catalogPriority: 10,
    complex: false,
    conflictResolution: false,
    mustAsk: false,
    bundleGroup: null,
    whyAsking: "Decides the next product choice.",
    projectLocal: false,
    ...overrides,
  };
}

function request(
  criteria: readonly CriterionState[],
  catalog: readonly CatalogQuestion[],
  extra: Partial<SelectionRequest> = {},
): SelectionRequest {
  return {
    workItemId: "work-1",
    scopeRev: 1,
    batchId: "batch-1",
    catalogVersion: "catalog-test",
    criteria,
    catalog,
    turn: 4,
    createdAt: 100,
    lastOptionsVersion: 0,
    projectLocalCount: 0,
    ...extra,
  };
}

function questionIds(result: SelectionResult): string[] {
  return result.batch.snapshot
    .filter((item) => item.questionId !== "split-waves")
    .map((item) => item.questionId);
}

function permute<T>(items: readonly T[], seed: number): T[] {
  const next = [...items];
  let state = seed + 1;
  for (let index = next.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swap = state % (index + 1);
    const left = next[index];
    const right = next[swap];
    if (left === undefined || right === undefined) continue;
    next[index] = right;
    next[swap] = left;
  }
  return next;
}

describe("selector prerequisite gating and greedy coverage", () => {
  it("asks only the unsettled prerequisite when downstream questions are blocked", () => {
    const criteria = [
      criterion({ id: "auth.mode", label: "how people sign in", scope: "auth" }),
      criterion({
        id: "auth.rbac",
        label: "who can do what",
        scope: "auth",
        requiresSettled: ["auth.mode"],
      }),
      criterion({
        id: "auth.session",
        label: "how long a sign-in lasts",
        scope: "auth",
        requiresSettled: ["auth.mode"],
      }),
    ];
    const catalog = [
      question({ id: "q-auth", targetCriteria: ["auth.mode"], catalogPriority: 1 }),
      question({ id: "q-rbac", targetCriteria: ["auth.rbac"], requiresSettled: ["auth.mode"] }),
      question({ id: "q-session", targetCriteria: ["auth.session"], requiresSettled: ["auth.mode"] }),
    ];
    const result = selectNextBatch(request(criteria, catalog, { targetSize: 3 }));
    expect(questionIds(result)).toEqual(["q-auth"]);
  });

  it("subtracts covered criteria so the next pick is disjoint", () => {
    const criteria = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"].map((id) =>
      criterion({ id, label: `choice ${id}` }),
    );
    const catalog = [
      question({ id: "q1", targetCriteria: ["c1", "c2", "c3"], catalogPriority: 2 }),
      question({ id: "q2", targetCriteria: ["c2", "c3", "c4"], catalogPriority: 2 }),
      question({ id: "q3", targetCriteria: ["c5", "c6", "c7"], catalogPriority: 2 }),
    ];
    const result = selectNextBatch(request(criteria, catalog, { targetSize: 2 }));
    expect(questionIds(result)).toEqual(["q1", "q3"]);
    const primaries = result.batch.snapshot.map((item) => item.primaryCriterionId);
    expect(new Set(primaries).size).toBe(primaries.length);
  });

  it("ranks must-ask above conflict, conflict above unblockers, and unblockers above ordinary open items", () => {
    const standards = Array.from({ length: 8 }, (_, index) =>
      criterion({ id: `std-${index}`, label: `ordinary choice ${index}` }),
    );
    const criteria = [
      ...standards,
      criterion({ id: "conflict-1", label: "the conflicting requirement", status: "conflict" }),
      criterion({ id: "must-1", label: "whether people sign in", mustAsk: true }),
      criterion({ id: "block-1", label: "the shared foundation" }),
      criterion({ id: "down-1", label: "a later feature" }),
    ];
    const catalog = [
      ...standards.map((item, index) =>
        question({ id: `q-std-${index}`, targetCriteria: [item.id], catalogPriority: index }),
      ),
      question({ id: "q-conflict", targetCriteria: ["conflict-1"], conflictResolution: true }),
      question({ id: "q-must", targetCriteria: ["must-1"] }),
      question({ id: "q-block", targetCriteria: ["block-1"] }),
      question({ id: "q-down", targetCriteria: ["down-1"], requiresSettled: ["block-1"] }),
    ];
    const result = selectNextBatch(request(criteria, catalog, { targetSize: 3 }));
    expect(questionIds(result).slice(0, 2)).toEqual(["q-must", "q-conflict"]);
  });

  it("prefers an unblocker over a routine open criterion", () => {
    const criteria = [
      criterion({ id: "block-1", label: "the shared foundation" }),
      criterion({ id: "std-1", label: "a leaf detail" }),
      criterion({ id: "down-1", label: "a later feature" }),
    ];
    const catalog = [
      question({ id: "q-block", targetCriteria: ["block-1"], catalogPriority: 5 }),
      question({ id: "q-std", targetCriteria: ["std-1"], catalogPriority: 1 }),
      question({ id: "q-down", targetCriteria: ["down-1"], requiresSettled: ["block-1"] }),
    ];
    const result = selectNextBatch(request(criteria, catalog, { targetSize: 2 }));
    expect(questionIds(result)[0]).toBe("q-block");
    expect(questionIds(result)).not.toContain("q-down");
  });

  it("breaks equal scores by conflict, must-ask, downstream unblock count, priority, then id", () => {
    const shared = [criterion({ id: "shared", label: "the shared choice" })];
    const conflictWinner = selectNextBatch(
      request(shared, [
        question({ id: "q-plain", targetCriteria: ["shared"], catalogPriority: 1 }),
        question({
          id: "q-conflict",
          targetCriteria: ["shared"],
          conflictResolution: true,
          catalogPriority: 9,
        }),
      ]),
    );
    expect(questionIds(conflictWinner)).toEqual(["q-conflict"]);

    const mustWinner = selectNextBatch(
      request(shared, [
        question({ id: "q-plain", targetCriteria: ["shared"], catalogPriority: 1 }),
        question({ id: "q-must", targetCriteria: ["shared"], mustAsk: true, catalogPriority: 9 }),
      ]),
    );
    expect(questionIds(mustWinner)).toEqual(["q-must"]);

    const downstream = selectNextBatch(
      request(
        [
          ...shared,
          criterion({ id: "later", label: "a later feature" }),
        ],
        [
          question({ id: "q-low", targetCriteria: ["shared"], catalogPriority: 1 }),
          question({ id: "q-high", targetCriteria: ["shared"], catalogPriority: 9 }),
          question({ id: "d1", targetCriteria: ["later"], requiresSettled: ["q-high", "missing-prereq"] }),
          question({ id: "d2", targetCriteria: ["later"], requiresSettled: ["q-high", "missing-prereq"] }),
          question({ id: "d3", targetCriteria: ["later"], requiresSettled: ["q-high", "missing-prereq"] }),
          question({ id: "d4", targetCriteria: ["later"], requiresSettled: ["q-high", "missing-prereq"] }),
        ],
      ),
    );
    expect(questionIds(downstream)[0]).toBe("q-high");

    const priority = selectNextBatch(
      request(shared, [
        question({ id: "q-b", targetCriteria: ["shared"], catalogPriority: 8 }),
        question({ id: "q-a", targetCriteria: ["shared"], catalogPriority: 2 }),
      ]),
    );
    expect(questionIds(priority)).toEqual(["q-a"]);

    const byId = selectNextBatch(
      request(shared, [
        question({ id: "q-b", targetCriteria: ["shared"], catalogPriority: 4 }),
        question({ id: "q-a", targetCriteria: ["shared"], catalogPriority: 4 }),
      ]),
    );
    expect(questionIds(byId)).toEqual(["q-a"]);
  });

  it("repeats the same ordered batch across 100 replays and input permutations", () => {
    const criteria = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"].map((id) =>
      criterion({ id, label: `choice ${id}` }),
    );
    const catalog = [
      question({ id: "q-b", targetCriteria: ["c1", "c2", "c3"], catalogPriority: 4 }),
      question({ id: "q-a", targetCriteria: ["c1", "c2", "c3"], catalogPriority: 4 }),
      question({ id: "q-overlap", targetCriteria: ["c2", "c3", "c4"], catalogPriority: 1 }),
      question({ id: "q-disjoint", targetCriteria: ["c5", "c6", "c7"], catalogPriority: 3 }),
    ];
    const expected = questionIds(selectNextBatch(request(criteria, catalog, { targetSize: 2 })));
    for (let replay = 0; replay < 100; replay += 1) {
      const shuffled = permute(catalog, replay);
      const result = selectNextBatch(request(criteria, shuffled, { targetSize: 2 }));
      expect(questionIds(result)).toEqual(expected);
    }
    expect(expected).toEqual(["q-overlap", "q-disjoint"]);
  });

  it("asks foundational scopes before leaf features", () => {
    const criteria = [
      criterion({ id: "auth.mode", label: "how people sign in", scope: "auth" }),
      criterion({ id: "leaf.color", label: "the accent color", scope: "leaf" }),
      criterion({ id: "leaf.type", label: "the button type", scope: "leaf" }),
      criterion({ id: "leaf.motion", label: "the motion style", scope: "leaf" }),
      criterion({ id: "leaf.density", label: "the layout density", scope: "leaf" }),
    ];
    const catalog = [
      question({ id: "q-auth", targetCriteria: ["auth.mode"] }),
      question({
        id: "q-leaf",
        targetCriteria: ["leaf.color", "leaf.type", "leaf.motion", "leaf.density"],
      }),
    ];
    const result = selectNextBatch(request(criteria, catalog, { targetSize: 3 }));
    expect(questionIds(result)).toEqual(["q-auth"]);
  });

  it("opens a prerequisite cycle on the lowest id and records the diagnostic", () => {
    const seen: CatalogPrereqCycleError[] = [];
    const criteria = [
      criterion({ id: "c1", label: "the first choice" }),
      criterion({ id: "c2", label: "the second choice" }),
    ];
    const catalog = [
      question({ id: "q1", targetCriteria: ["c1"], requiresSettled: ["q2"] }),
      question({ id: "q2", targetCriteria: ["c2"], requiresSettled: ["q1"] }),
    ];
    const result = selectNextBatch(
      request(criteria, catalog, {
        logger: {
          error(error) {
            seen.push(error);
          },
        },
      }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(CatalogPrereqCycleError);
    expect(seen[0]?.brokenOnId).toBe("q1");
    expect(result.diagnostics[0]?.warning).toBe(
      "A catalog prerequisite loop was opened so the next question can be asked.",
    );
    expect(questionIds(result)).toEqual(["q1"]);
    expect(result.batch.diagnostics[0]?.name).toBe("CatalogPrereqCycleError");
  });

  it("strips a criterion settled during the previous batch before the next selection", () => {
    const criteria = [
      criterion({ id: "c2", label: "the channel", status: "settled" }),
      criterion({ id: "c3", label: "the recipient", status: "open" }),
    ];
    const catalog = [
      question({ id: "q-both", targetCriteria: ["c2", "c3"] }),
      question({ id: "q-settled", targetCriteria: ["c2"] }),
    ];
    const result = selectNextBatch(request(criteria, catalog));
    expect(questionIds(result)).toEqual(["q-both"]);
    expect(result.batch.snapshot[0]?.targetCriteria).toEqual(["c3"]);
  });
});

describe("selector batch budget, versions, and anti-nag", () => {
  it("caps a batch at 4 and defaults to 3 crisp questions", () => {
    const criteria = Array.from({ length: 6 }, (_, index) =>
      criterion({ id: `c${index}`, label: `choice ${index}` }),
    );
    const catalog = criteria.map((item, index) =>
      question({ id: `q${index}`, targetCriteria: [item.id], catalogPriority: index }),
    );
    expect(questionIds(selectNextBatch(request(criteria, catalog))).length).toBe(3);
    expect(questionIds(selectNextBatch(request(criteria, catalog, { targetSize: 9 }))).length).toBe(4);
  });

  it("keeps at most one complex question while a conflict card is active", () => {
    const criteria = [
      criterion({ id: "conflict-1", label: "the conflicting requirement", status: "conflict" }),
      criterion({ id: "c2", label: "the second detail" }),
      criterion({ id: "c3", label: "the third detail" }),
      criterion({ id: "s1", label: "the first simple detail" }),
      criterion({ id: "s2", label: "the second simple detail" }),
    ];
    const catalog = [
      question({
        id: "q-conflict",
        targetCriteria: ["conflict-1"],
        complex: true,
        conflictResolution: true,
      }),
      question({ id: "q-complex-b", targetCriteria: ["c2"], complex: true }),
      question({ id: "q-complex-c", targetCriteria: ["c3"], complex: true }),
      question({ id: "q-simple-a", targetCriteria: ["s1"], complex: false }),
      question({ id: "q-simple-b", targetCriteria: ["s2"], complex: false }),
    ];
    const result = selectNextBatch(request(criteria, catalog, { targetSize: 4 }));
    const complex = result.batch.snapshot.filter((item) => item.complex);
    expect(complex).toHaveLength(1);
    expect(complex[0]?.questionId).toBe("q-conflict");
    expect(questionIds(result)).toEqual(expect.arrayContaining(["q-simple-a", "q-simple-b"]));
    expect(questionIds(result)).not.toContain("q-complex-b");
  });

  it("bundles related micro-questions into one cohesive question", () => {
    const criteria = ["time", "zone", "grace", "notice"].map((id) =>
      criterion({ id, label: `the cutoff ${id}` }),
    );
    const catalog = criteria.map((item) =>
      question({
        id: `micro-${item.id}`,
        targetCriteria: [item.id],
        bundleGroup: "cutoff",
      }),
    );
    const result = selectNextBatch(request(criteria, catalog, { targetSize: 4 }));
    expect(result.batch.snapshot).toHaveLength(1);
    expect(result.batch.snapshot[0]?.complex).toBe(true);
    expect(result.batch.snapshot[0]?.targetCriteria).toEqual(["grace", "notice", "time", "zone"]);
    expect(result.batch.snapshot[0]?.text.startsWith("These choices belong together:")).toBe(true);
  });

  it("stamps a strictly increasing options version and stores an immutable snapshot", () => {
    const criteria = ["c1", "c2", "c3", "c4", "c5", "c6"].map((id) =>
      criterion({ id, label: `choice ${id}` }),
    );
    const catalog = criteria.map((item) => question({ id: `q-${item.id}`, targetCriteria: [item.id] }));
    const store = new InMemoryDiscoveryBatchStore();
    const ledger = new ScopeCriterionAskLedger();
    const first = selectNextBatch(
      request(criteria, catalog, { batchStore: store, askLedger: ledger, targetSize: 3 }),
    );
    const versions = first.batch.snapshot.map((item) => item.optionsVersion);
    expect(versions).toEqual([1, 2, 3]);
    expect(ledger.read("work-1", 1, "decision-c1")).toEqual({ askCount: 1, lastAskedTurn: 4 });
    const stored = store.get("batch-1");
    expect(stored?.snapshot[0]?.whyAsking).toBe(first.batch.snapshot[0]?.whyAsking);
    const mutable = store.get("batch-1");
    const snapshot = mutable?.snapshot[0];
    if (snapshot) {
      (snapshot as { text: string }).text = "changed after persist";
    }
    expect(store.get("batch-1")?.snapshot[0]?.text).toBe(first.batch.snapshot[0]?.text);

    const asked = first.batch.snapshot.map((item) => item.questionId);
    const second = selectNextBatch(
      request(criteria, catalog, {
        batchId: "batch-2",
        askedQuestionIds: asked,
        lastOptionsVersion: first.nextOptionsVersion,
        targetSize: 2,
      }),
    );
    expect(second.batch.snapshot.map((item) => item.optionsVersion)).toEqual([4, 5]);
    expect(questionIds(second).some((id) => asked.includes(id))).toBe(false);
  });

  it("persists the snapshot in discovery_batches as valid json", () => {
    const criteria = [criterion({ id: "c1", label: "how people sign in" })];
    const catalog = [question({ id: "q1", targetCriteria: ["c1"] })];
    const result = selectNextBatch(request(criteria, catalog));
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE work_items (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('project','change','fix','feature_request')),
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('discovering','ready','planned','done','abandoned')),
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE discovery_batches (
        id TEXT PRIMARY KEY,
        work_item TEXT NOT NULL REFERENCES work_items(id),
        scope_rev INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open','answered','superseded')),
        questions TEXT NOT NULL CHECK (json_valid(questions)),
        cursor INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      ) STRICT;
    `);
    db.prepare(
      "INSERT INTO work_items (id, kind, title, status, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("work-1", "project", "Kitchen", "discovering", 100);
    const params = discoveryBatchInsertParams(result.batch);
    db.prepare(INSERT_DISCOVERY_BATCH_SQL).run(...params);
    const row = db.prepare("SELECT questions FROM discovery_batches WHERE id = ?").get("batch-1") as {
      questions: string;
    };
    const parsed = JSON.parse(row.questions) as { question_ids: string[]; snapshot: { whyAsking: string }[] };
    expect(parsed.question_ids).toEqual(["decision-c1"]);
    expect(parsed.snapshot[0]?.whyAsking).toBe("Decides the next product choice.");
    db.close();
  });

  it("rephrases after one skip and offers a default or deferral after two skips", () => {
    const original = "Which option should we use?";
    const once = selectNextBatch(
      request(
        [criterion({ id: "tone", label: "the visual tone", skipCount: 1 })],
        [question({ id: "q-tone", targetCriteria: ["tone"], text: original })],
      ),
    );
    expect(once.batch.snapshot[0]?.rephrased).toBe(true);
    expect(once.batch.snapshot[0]?.text).not.toBe(original);
    expect(once.batch.snapshot[0]?.offerDefaultOrDefer).toBe(false);

    const twice = selectNextBatch(
      request(
        [criterion({ id: "tone", label: "the visual tone", skipCount: 2 })],
        [question({ id: "q-tone", targetCriteria: ["tone"], text: original })],
      ),
    );
    expect(twice.batch.snapshot[0]?.offerDefaultOrDefer).toBe(true);
    expect(twice.batch.snapshot[0]?.options.map((option) => option.label)).toEqual([
      "Use recommended default",
      "Defer for later",
    ]);

    const must = selectNextBatch(
      request(
        [criterion({ id: "pay", label: "how payments work", mustAsk: true, skipCount: 2 })],
        [question({ id: "q-pay", targetCriteria: ["pay"], text: original, mustAsk: true })],
      ),
    );
    expect(must.batch.snapshot[0]?.offerDefaultOrDefer).toBe(false);
    expect(must.batch.snapshot[0]?.text).not.toBe(original);
    expect(must.batch.snapshot[0]?.options.map((option) => option.label)).not.toContain("Defer for later");
  });

  it("keeps why-asking and options in plain English", () => {
    const clean = selectNextBatch(
      request(
        [criterion({ id: "auth.mode", label: "whether orders need a login screen and password reset flow" })],
        [
          question({
            id: "q-auth",
            targetCriteria: ["auth.mode"],
            whyAsking: "Decides whether orders need a login screen and password reset flow",
          }),
        ],
      ),
    );
    expect(clean.batch.snapshot[0]?.whyAsking).toBe(
      "Decides whether orders need a login screen and password reset flow",
    );

    const dirty = selectNextBatch(
      request(
        [criterion({ id: "auth.mode", label: "whether orders need a login screen and password reset flow" })],
        [
          question({
            id: "q-auth",
            targetCriteria: ["auth.mode"],
            whyAsking: "See scope_criteria auth.mode /[a-z]+/ before asking",
            options: [
              { id: "yes", label: "scope_criteria row", recommended: true },
              { id: "no", label: "No login", recommended: false },
            ],
          }),
        ],
      ),
    );
    const why = dirty.batch.snapshot[0]?.whyAsking ?? "";
    const labels = dirty.batch.snapshot[0]?.options.map((option) => option.label).join(" ") ?? "";
    expect(why).not.toContain("scope_criteria");
    expect(why).not.toContain("auth.mode");
    expect(why).not.toContain("/[a-z]+/");
    expect(labels).not.toContain("scope_criteria");
    expect(why.startsWith("Decides ")).toBe(true);
  });
});

describe("selector project-local question drafter", () => {
  it("drafts a question for an uncovered custom criterion", () => {
    const criteria = [criterion({ id: "kitchen.cutoff", label: "the kitchen order cutoff", scope: "leaf" })];
    const result = selectNextBatch(request(criteria, []));
    expect(result.draftedQuestionIds).toHaveLength(1);
    expect(result.batch.snapshot[0]?.projectLocal).toBe(true);
    expect(result.batch.snapshot[0]?.text).toBe("What should we do about the kitchen order cutoff?");
    expect(result.batch.snapshot[0]?.targetCriteria).toEqual(["kitchen.cutoff"]);
    expect(result.batch.snapshot[0]?.touches).toEqual(["interactive_ui"]);
    expect(result.batch.splitCard).toBeNull();
  });

  it("retries a malformed draft once and then uses the deterministic fallback", () => {
    const bad = {
      question_id: "bad",
      text: "What should we do about the kitchen order cutoff?",
      options: [
        { id: "a", label: "Morning", recommended: true },
        { id: "b", label: "Evening", recommended: false },
      ],
      touches: ["graphql_magic"],
      target_criteria: ["missing.criterion"],
      why_asking: "Decides the kitchen order cutoff.",
    };
    let calls = 0;
    const drafter: QuestionDrafterPort = {
      draft(draftRequest: QuestionDrafterRequest) {
        calls += 1;
        if (!draftRequest.retry) return bad;
        expect(draftRequest.previousErrors.length).toBeGreaterThan(0);
        expect(draftRequest.knownCriterionIds).toContain("kitchen.cutoff");
        expect(draftRequest.validTouches).toContain("scheduling");
        return bad;
      },
    };
    const drafterEngine = new ProjectLocalQuestionDrafter();
    const output = drafterEngine.draft({
      criteria: [criterion({ id: "kitchen.cutoff", label: "the kitchen order cutoff" })],
      catalog: [],
      projectLocalCount: 0,
      budget: 25,
      drafter,
      waived: new Map(),
    });
    expect(calls).toBe(2);
    expect(output.questions[0]?.id.startsWith("fallback-")).toBe(true);
    expect(output.questions[0]?.targetCriteria).toEqual(["kitchen.cutoff"]);
    expect(output.questions[0]?.touches).toEqual(["interactive_ui"]);

    calls = 0;
    const repaired: QuestionDrafterPort = {
      draft(draftRequest) {
        calls += 1;
        if (!draftRequest.retry) return bad;
        return {
          question_id: "local-kitchen",
          text: "When should the kitchen stop taking changes?",
          options: [
            { id: "morning", label: "Morning cutoff", recommended: true },
            { id: "evening", label: "Evening cutoff", recommended: false },
          ],
          touches: ["scheduling"],
          target_criteria: ["kitchen.cutoff"],
          why_asking: "Decides when the kitchen stops taking changes.",
        };
      },
    };
    const second = drafterEngine.draft({
      criteria: [criterion({ id: "kitchen.cutoff", label: "the kitchen order cutoff" })],
      catalog: [],
      projectLocalCount: 0,
      budget: 25,
      drafter: repaired,
      waived: new Map(),
    });
    expect(calls).toBe(2);
    expect(second.questions[0]?.id).toBe("local-kitchen");
  });

  it("rejects a draft that fails validation and accepts a concrete one", () => {
    const rejected = QuestionDrafterV1Schema.parse(
      {
        question_id: "",
        text: "See scope_criteria",
        options: [],
        touches: ["not-a-tag"],
        target_criteria: ["missing.criterion"],
        why_asking: "auth.mode",
      },
      { knownCriterionIds: new Set(["kitchen.cutoff"]), requestedCriterionId: "kitchen.cutoff" },
    );
    expect(rejected.ok).toBe(false);
  });

  it("stops at 25 drafted questions and lists the rest instead of dropping them", () => {
    const criteria = Array.from({ length: 26 }, (_, index) =>
      criterion({
        id: `custom-${String(index).padStart(2, "0")}`,
        label: `custom rule ${index}`,
      }),
    );
    const capped = selectNextBatch(request(criteria, [], { localBudget: 25, targetSize: 2 }));
    expect(capped.draftedQuestionIds).toHaveLength(25);
    expect(capped.batch.splitCard?.text).toBe("Split into smaller waves or confirm remaining items");
    expect(capped.batch.splitCard?.remainingLabels).toEqual(["custom rule 25"]);
    expect(capped.batch.splitCard?.remainingCriterionIds).toEqual(["custom-25"]);
    expect(capped.batch.snapshot.some((item) => item.questionId === "split-waves")).toBe(true);

    const exhausted = selectNextBatch(
      request(criteria, [], { projectLocalCount: 25, localBudget: 25, targetSize: 2 }),
    );
    expect(exhausted.draftedQuestionIds).toHaveLength(0);
    expect(exhausted.batch.splitCard?.remainingCriterionIds).toHaveLength(26);

    const expanded = selectNextBatch(request(criteria, [], { localBudget: 30, targetSize: 1 }));
    expect(expanded.draftedQuestionIds).toHaveLength(26);
    expect(expanded.batch.splitCard).toBeNull();
  });
});
