import { describe, expect, it } from "vitest";
import {
  CROSS_CUTTING_RULES,
  EarsOracleValidator,
  FakeModelAdapter,
  MemoryMatrixCellStore,
  OPTION_ELABORATIONS,
  OrderedCellFillerPipeline,
  RecordingContradictionRecheck,
  ReviewValidationError,
  UNIVERSAL_POLICIES,
  applyRiskFloor,
  concreteProposal,
  openFillerStateDb,
  parseExpanderPrompt,
} from "../../src/filler/index.js";
import type { ModelCompletion, OpenCell } from "../../src/filler/types.js";
import {
  KITCHEN_DECISIONS,
  KITCHEN_FEATURE,
  KITCHEN_OPEN_PASS3,
  kitchenCells,
} from "./kitchen-fixture.js";

const validator = new EarsOracleValidator();

function completion(body: unknown, actualTokens = 30): ModelCompletion {
  return { text: JSON.stringify(body), actualTokens };
}

function openCell(id: string, matrixId = "M05", touches: readonly string[] = []): OpenCell {
  return {
    id,
    featureId: "F01",
    matrixId,
    subject: `open.domain.${id}`,
    title: id,
    touches,
  };
}

function scriptedModel(
  respond: (cellIds: readonly string[], callIndex: number, repair: boolean) => unknown,
): FakeModelAdapter {
  return new FakeModelAdapter((request) => {
    const prompt = parseExpanderPrompt(request.prompt);
    return completion(respond(prompt.cells.map((cell) => cell.cell_id), request.step, prompt.repair));
  });
}

function kitchenModel(): FakeModelAdapter {
  return new FakeModelAdapter((request) => {
    const prompt = parseExpanderPrompt(request.prompt);
    const cells = prompt.cells.map((cell) => {
      if (cell.cell_id.endsWith("refund")) {
        return {
          ...concreteProposal(cell.cell_id, "low"),
          ears_text:
            'When a manager refunds a paid order, the system shall return status 200 and show the banner "Refund submitted".',
          oracle_sketch: 'Input: refund order 17. Observe status 200 and the banner "Refund submitted".',
        };
      }
      if (cell.cell_id.endsWith("grace")) {
        return {
          ...concreteProposal(cell.cell_id, "medium"),
          ears_text:
            'When staff submit an order 5 minutes after cutoff, the system shall reject it with status 422 and show the banner "Grace period ended".',
          oracle_sketch:
            'Input: submit an order 5 minutes after cutoff. Observe status 422 and the banner "Grace period ended".',
        };
      }
      if (cell.cell_id.endsWith("page-size")) {
        return {
          ...concreteProposal(cell.cell_id, "medium"),
          ears_text:
            "When the order history exceeds one page, the system shall show 50 orders per page and a control for the next page.",
          oracle_sketch: "Input: open order history with 51 orders. Observe 50 rows and a control for the next page.",
        };
      }
      return {
        ...concreteProposal(cell.cell_id, "low"),
        ears_text:
          'When a cook enters an order note, the system shall trim leading and trailing whitespace and show the saved note "soup".',
        oracle_sketch: 'Input: submit the note "  soup  ". Observe the stored note is "soup".',
      };
    });
    cells.push({
      ...concreteProposal("cell:kitchen:submit-staff", "low", ["D-0001"]),
      ears_text: 'When staff submit an order, the system shall show the banner "Overwritten by the model".',
      oracle_sketch: 'Input: submit an order. Observe the banner "Overwritten by the model".',
    });
    return completion({ cells }, 48);
  });
}

describe("ordered cell filler", () => {
  it("validates builtin policies and cross-cutting rules as concrete EARS", () => {
    const failures: string[] = [];
    for (const rule of CROSS_CUTTING_RULES) {
      const verdict = validator.validate({ earsText: rule.earsText, oracleSketch: rule.oracleSketch });
      if (!verdict.ok) failures.push(`${rule.id}: ${verdict.problems.join(" | ")}`);
    }
    for (const policy of UNIVERSAL_POLICIES) {
      const verdict = validator.validate({ earsText: policy.earsText, oracleSketch: policy.oracleSketch });
      if (!verdict.ok) failures.push(`${policy.id}:${policy.source}: ${verdict.problems.join(" | ")}`);
    }
    for (const elaboration of OPTION_ELABORATIONS) {
      const verdict = validator.validate({ earsText: elaboration.earsText, oracleSketch: elaboration.oracleSketch });
      if (!verdict.ok) failures.push(`${elaboration.id}: ${verdict.problems.join(" | ")}`);
    }
    expect(failures).toEqual([]);
  });

  it("fills the kitchen app in pass order with at least 70 percent deterministic coverage and zero tokens on those cells", () => {
    const graph = openFillerStateDb();
    const model = kitchenModel();
    const contradiction = new RecordingContradictionRecheck();
    const store = new MemoryMatrixCellStore();
    const pipeline = new OrderedCellFillerPipeline();
    const result = pipeline.run({
      cells: kitchenCells(),
      decisions: KITCHEN_DECISIONS,
      graph,
      model,
      store,
      contradiction,
      chosenOptions: [{ questionId: "data.concurrent_edits", optionId: "optimistic_version" }],
      featureTitles: { F01: "Kitchen" },
      forbiddenScopePhrases: ["billing marketplace"],
    });

    expect(result.metrics.deterministicShare).toBeGreaterThanOrEqual(70);
    expect(result.metrics.deterministicTokens).toBe(0);
    expect(result.metrics.lines[0]).toMatch(/^Pass 1 Decisions\/Rules: \d+%$/);
    expect(result.metrics.lines[1]).toMatch(/^Pass 2 Elaborations\/UP: \d+%$/);
    expect(result.metrics.lines[2]).toMatch(/^Pass 3 LLM: \d+%$/);
    expect(result.llmCalls).toBeGreaterThan(0);
    expect(result.tokensSpent).toBeGreaterThan(0);
    expect(model.calls.length).toBe(result.llmCalls);

    for (const request of model.calls) {
      const prompt = parseExpanderPrompt(request.prompt);
      const ids = prompt.cells.map((cell) => cell.cell_id);
      expect(ids.every((id) => (KITCHEN_OPEN_PASS3 as readonly string[]).includes(id))).toBe(true);
      expect(ids).not.toContain("cell:kitchen:submit-staff");
      expect(ids).not.toContain("cell:kitchen:anonymous-profile");
      expect(prompt.cells.length).toBeLessThanOrEqual(25);
    }

    const submit = result.outcomes.find((outcome) => outcome.cellId === "cell:kitchen:submit-staff");
    expect(submit?.pass).toBe(1);
    expect(submit?.basis).toBe("explicit");
    expect(submit?.unchanged).toBe(false);
    const submitNode = graph.requirements().find((node) => node.fields.cell_id === "cell:kitchen:submit-staff");
    expect(submitNode?.text).toContain("Order saved");
    expect(submitNode?.text).not.toContain("Overwritten");
    expect(contradiction.calls.some((call) => call.reason === "pass3_conflict")).toBe(true);

    const money = result.outcomes.find((outcome) => outcome.cellId === "cell:kitchen:money");
    expect(money?.basis).toBe("delegated");
    expect(money?.pass).toBe(1);
    const loading = result.outcomes.find((outcome) => outcome.cellId === "cell:kitchen:loading");
    expect(loading?.pass).toBe(2);
    expect(loading?.basis).toBe("defaulted");
    const concurrency = result.outcomes.find((outcome) => outcome.cellId === "cell:kitchen:concurrency");
    expect(concurrency?.pass).toBe(2);
    expect(concurrency?.sourceIds).toContain("ELAB-concurrent-optimistic");

    expect(result.mustAsk.map((ask) => ask.cellId)).toEqual(["cell:kitchen:refund"]);
    expect(result.mustAsk[0]?.forcedHigh).toBe(true);
    expect(result.mustAsk[0]?.blocking).toBe(true);
    expect(graph.requirements().some((node) => node.fields.cell_id === "cell:kitchen:refund")).toBe(false);
    const ask = graph.getNode(result.mustAsk[0]?.nodeId ?? "");
    expect(ask?.kind).toBe("decision");
    expect(ask?.fields.must_ask).toBe(true);
    expect(ask?.fields.blocking).toBe(true);
    expect(ask?.basis).toBeNull();

    const reviewIds = result.review.groups().flatMap((group) => group.proposals.map((proposal) => proposal.cellId));
    expect(reviewIds.sort()).toEqual(["cell:kitchen:grace", "cell:kitchen:page-size"]);
    expect(result.review.groups()[0]?.actions).toEqual(["Approve all", "Edit", "Reject"]);
    expect(result.chosenForYou.list().map((entry) => entry.cellId)).toContain("cell:kitchen:whitespace");

    for (const outcome of result.outcomes) {
      if (outcome.cellId === "cell:kitchen:anonymous-profile") {
        expect(outcome.disposition).toBe("not_applicable");
        continue;
      }
      expect(["filled", "escalated", "needs_review"]).toContain(outcome.disposition);
    }

    for (const node of graph.requirements()) {
      if (node.status === "superseded") continue;
      expect(validator.validate({
        earsText: node.text,
        oracleSketch: String(node.fields.oracle_sketch),
      }).ok).toBe(true);
      const edges = graph.edgesFrom(node.id);
      expect(edges.some((edge) => edge.type === "belongs_to" && edge.dst === KITCHEN_FEATURE)).toBe(true);
      expect(edges.some((edge) => edge.type === "derived_from")).toBe(true);
      expect(node.fields.touches).toBeTruthy();
    }

    const callsAfterFirst = model.calls.length;
    const second = pipeline.run({
      cells: kitchenCells(),
      decisions: KITCHEN_DECISIONS,
      graph,
      model,
      store,
      contradiction,
      chosenOptions: [{ questionId: "data.concurrent_edits", optionId: "optimistic_version" }],
      featureTitles: { F01: "Kitchen" },
    });
    expect(model.calls.length).toBe(callsAfterFirst);
    expect(second.llmCalls).toBe(0);
    expect(second.tokensSpent).toBe(0);
    expect(second.outcomes.filter((outcome) => outcome.unchanged && outcome.disposition === "filled").length).toBeGreaterThan(0);
    graph.close();
  });

  it("spends zero LLM calls when pass 1 and pass 2 cover every active cell", () => {
    const graph = openFillerStateDb();
    const model = new FakeModelAdapter(() => {
      throw new Error("Pass 3 must not call the model");
    });
    const covered = kitchenCells().filter((cell) => !(KITCHEN_OPEN_PASS3 as readonly string[]).includes(cell.id));
    const result = new OrderedCellFillerPipeline().run({
      cells: covered,
      decisions: KITCHEN_DECISIONS,
      graph,
      model,
      chosenOptions: [{ questionId: "data.concurrent_edits", optionId: "optimistic_version" }],
    });
    expect(result.llmCalls).toBe(0);
    expect(result.tokensSpent).toBe(0);
    expect(result.metrics.deterministicShare).toBe(100);
    graph.close();
  });

  it("keeps a pass 1 decision ahead of a universal policy on the same cell", () => {
    const graph = openFillerStateDb();
    const model = new FakeModelAdapter(() => {
      throw new Error("covered cell must not reach Pass 3");
    });
    const cell = kitchenCells().find((item) => item.id === "cell:kitchen:loading");
    if (!cell) throw new Error("missing loading cell");
    const result = new OrderedCellFillerPipeline().run({
      cells: [cell],
      decisions: [
        {
          ...KITCHEN_DECISIONS[0]!,
          id: "D-0099",
          contentHash: "sha256:loading-decision",
          entails: [
            {
              cellId: cell.id,
              value: "custom skeleton",
              earsText:
                'When the kitchen screen is loading, the system shall show the banner "Loading orders" after 300 ms.',
              oracleSketch: 'Input: open the kitchen screen. Observe the banner "Loading orders" within 300 ms.',
            },
          ],
        },
      ],
      graph,
      model,
    });
    expect(result.outcomes[0]?.pass).toBe(1);
    expect(result.outcomes[0]?.basis).toBe("explicit");
    expect(result.llmCalls).toBe(0);
    graph.close();
  });

  it("forces auth, payments, PII, deletion, and external side effects up to a blocking must-ask", () => {
    expect(applyRiskFloor({ modelRisk: "low", touches: ["payments"], matrixId: "M07", subject: "payment.refund" }).risk).toBe(
      "high",
    );
    expect(applyRiskFloor({ modelRisk: "low", touches: ["personal_data"], matrixId: "M10", subject: "privacy.export" }).forcedHigh).toBe(
      true,
    );
    expect(applyRiskFloor({ modelRisk: "low", touches: ["deletion"], matrixId: "M02", subject: "entity.order.delete" }).risk).toBe(
      "high",
    );
    expect(applyRiskFloor({ modelRisk: "low", touches: ["authn"], matrixId: "M01", subject: "session.expired" }).matchedTags).toContain(
      "auth",
    );
    expect(
      applyRiskFloor({ modelRisk: "low", touches: ["external_api"], matrixId: "M07", subject: "outbound.charge" }).risk,
    ).toBe("high");

    const graph = openFillerStateDb();
    const model = scriptedModel((ids) => ({
      cells: ids.map((id) => concreteProposal(id, "low")),
    }));
    const result = new OrderedCellFillerPipeline().run({
      cells: [openCell("cell:pay:refund", "M07", ["payments"])],
      decisions: [],
      graph,
      model,
    });
    expect(result.mustAsk).toHaveLength(1);
    expect(result.mustAsk[0]?.forcedHigh).toBe(true);
    expect(result.review.groups()).toHaveLength(0);
    expect(graph.requirements()).toHaveLength(0);
    graph.close();
  });

  it("rejects vague phrases, repairs once, and marks a still-vague cell needs_review", () => {
    const vague = {
      cells: [
        {
          ...concreteProposal("cell:vague:errors", "low"),
          ears_text: "The system shall handle errors gracefully with good UX.",
          oracle_sketch: "Input: trigger an error. Observe good UX.",
        },
      ],
    };
    const fast = {
      cells: [
        {
          ...concreteProposal("cell:vague:speed", "low"),
          ears_text: "The system shall be fast.",
          oracle_sketch: "Input: open the page. Observe that it feels fast.",
        },
      ],
    };
    const graph = openFillerStateDb();
    const repaired = scriptedModel((ids, _step, repair) => {
      if (!repair) return vague;
      return {
        cells: ids.map((id) => ({
          ...concreteProposal(id, "low"),
          ears_text: 'If the kitchen list fails to load, then the system shall show the banner "Could not load orders" and a Retry button.',
          oracle_sketch: 'Input: force the kitchen list request to fail. Observe the banner "Could not load orders" and a Retry button.',
        })),
      };
    });
    const healed = new OrderedCellFillerPipeline().run({
      cells: [openCell("cell:vague:errors")],
      decisions: [],
      graph,
      model: repaired,
    });
    expect(healed.llmCalls).toBe(2);
    expect(parseExpanderPrompt(repaired.calls[1]?.prompt ?? "").repair).toBe(true);
    expect(parseExpanderPrompt(repaired.calls[1]?.prompt ?? "").instruction).toMatch(/HTTP status/);
    expect(healed.outcomes[0]?.disposition).toBe("filled");

    const stuckModel = scriptedModel(() => fast);
    const stuckGraph = openFillerStateDb();
    const stuck = new OrderedCellFillerPipeline().run({
      cells: [openCell("cell:vague:speed")],
      decisions: [],
      graph: stuckGraph,
      model: stuckModel,
    });
    expect(stuck.outcomes[0]?.disposition).toBe("needs_review");
    expect(stuck.diagnostics.some((diagnostic) => diagnostic.code === "vague_after_repair")).toBe(true);
    expect(stuck.llmCalls).toBe(2);
    graph.close();
    stuckGraph.close();
  });

  it("retries only the cells omitted from a batch, at most once", () => {
    const cells = Array.from({ length: 20 }, (_item, index) => openCell(`cell:batch:${String(index).padStart(2, "0")}`));
    const graph = openFillerStateDb();
    const model = new FakeModelAdapter((request, callIndex) => {
      const prompt = parseExpanderPrompt(request.prompt);
      const proposals = prompt.cells.map((cell) => concreteProposal(cell.cell_id, "low"));
      const cellsOut = callIndex === 0 ? proposals.slice(0, proposals.length - 3) : proposals;
      return completion({ cells: cellsOut }, 15);
    });
    const result = new OrderedCellFillerPipeline().run({ cells, decisions: [], graph, model });
    expect(model.calls).toHaveLength(2);
    expect(parseExpanderPrompt(model.calls[0]?.prompt ?? "").cells).toHaveLength(20);
    expect(parseExpanderPrompt(model.calls[1]?.prompt ?? "").cells.map((cell) => cell.cell_id)).toEqual([
      "cell:batch:17",
      "cell:batch:18",
      "cell:batch:19",
    ]);
    expect(result.outcomes.every((outcome) => outcome.disposition === "filled")).toBe(true);
    graph.close();
  });

  it("approves, edits, and rejects medium-risk proposals and materializes explicit requirements", () => {
    const cells = Array.from({ length: 8 }, (_item, index) => openCell(`cell:review:${String(index)}`));
    const graph = openFillerStateDb();
    const model = scriptedModel((ids) => ({
      cells: ids.map((id) => concreteProposal(id, "medium")),
    }));
    const contradiction = new RecordingContradictionRecheck();
    const result = new OrderedCellFillerPipeline().run({
      cells,
      decisions: [],
      graph,
      model,
      contradiction,
    });
    expect(result.review.groups()).toHaveLength(1);
    expect(result.review.groups()[0]?.title).toBe("8 proposed details — Approve all or expand");
    const ids = result.review.groups()[0]?.proposals.map((proposal) => proposal.cellId) ?? [];
    const settled = result.review.settle({ approve: ids.slice(0, 6), reject: ids.slice(6) });
    expect(settled.approved).toHaveLength(6);
    expect(settled.rejected).toHaveLength(2);
    expect(settled.readiness.pendingMedium).toBe(0);
    expect(settled.readiness.rejected).toBe(2);
    expect(settled.clarifications).toHaveLength(2);
    for (const id of ids.slice(0, 6)) {
      const node = graph.requirements().find((item) => item.fields.cell_id === id);
      expect(node?.basis).toBe("explicit");
      expect(node?.status).toBe("active");
    }
    for (const id of ids.slice(6)) {
      const node = graph.requirements().find((item) => item.fields.cell_id === id);
      expect(node?.status).toBe("superseded");
      expect(node?.fields.review_status).toBe("rejected");
    }
    expect(result.review.groups()).toHaveLength(0);

    const editGraph = openFillerStateDb();
    const editRun = new OrderedCellFillerPipeline().run({
      cells: [openCell("cell:review:edit")],
      decisions: [],
      graph: editGraph,
      model: scriptedModel((ids) => ({ cells: ids.map((id) => concreteProposal(id, "medium")) })),
      contradiction,
    });
    const before = editGraph.requirements()[0]?.text;
    expect(() =>
      editRun.review.settle({
        edits: [
          {
            cellId: "cell:review:edit",
            earsText: "The system shall handle errors gracefully with good UX.",
            oracleSketch: "Input: fail the request. Observe good UX.",
          },
        ],
      }),
    ).toThrow(ReviewValidationError);
    expect(editGraph.requirements()[0]?.text).toBe(before);
    expect(editGraph.requirements()[0]?.basis).toBe("proposed");
    const edited = editRun.review.settle({
      edits: [
        {
          cellId: "cell:review:edit",
          earsText: 'When the cook renames a dish, the system shall save the name and show the banner "Dish updated".',
          oracleSketch: 'Input: rename Soup to Stew. Observe the banner "Dish updated" and the stored name Stew.',
        },
      ],
    });
    expect(editGraph.requirements()[0]?.basis).toBe("explicit");
    expect(editGraph.requirements()[0]?.text).toContain("Dish updated");
    expect(edited.contradictionFlags).toBeGreaterThanOrEqual(0);
    expect(contradiction.calls.some((call) => call.reason === "review_edit")).toBe(true);
    graph.close();
    editGraph.close();
  });

  it("reuses one requirement node when two sibling cells return the same EARS text", () => {
    const graph = openFillerStateDb();
    const ears =
      'When a cook saves a note, the system shall show the banner "Note saved" and return status 204.';
    const oracle = 'Input: save a note. Observe status 204 and the banner "Note saved".';
    const model = scriptedModel((ids) => ({
      cells: ids.map((id) => ({ ...concreteProposal(id, "low"), ears_text: ears, oracle_sketch: oracle })),
    }));
    const result = new OrderedCellFillerPipeline().run({
      cells: [openCell("cell:dup:a"), openCell("cell:dup:b")],
      decisions: [],
      graph,
      model,
    });
    const specs = graph.requirements().filter((node) => node.status === "active");
    expect(specs).toHaveLength(1);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "duplicate_requirement")).toBe(true);
    const edges = graph.edgesFrom(specs[0]?.id ?? "");
    expect(edges.filter((edge) => edge.type === "derived_from").map((edge) => edge.dst).sort()).toEqual([
      "cell:dup:a",
      "cell:dup:b",
    ]);
    graph.close();
  });

  it("stops a feature at the call budget and reports the cells it did not send", () => {
    const cells = Array.from({ length: 30 }, (_item, index) => openCell(`cell:budget:${String(index).padStart(2, "0")}`));
    const graph = openFillerStateDb();
    const model = scriptedModel((ids) => ({ cells: ids.map((id) => concreteProposal(id, "low")) }));
    const result = new OrderedCellFillerPipeline().run({
      cells,
      decisions: [],
      graph,
      model,
      budget: { maxCallsPerFeature: 1, maxTokensPerFeature: 200_000 },
    });
    expect(model.calls).toHaveLength(1);
    expect(parseExpanderPrompt(model.calls[0]?.prompt ?? "").cells).toHaveLength(25);
    expect(result.outcomes.filter((outcome) => outcome.disposition === "filled")).toHaveLength(25);
    expect(result.outcomes.filter((outcome) => outcome.disposition === "needs_review")).toHaveLength(5);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "budget_exceeded")).toBe(true);
    graph.close();
  });
});
