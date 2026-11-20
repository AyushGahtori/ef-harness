import { describe, expect, it } from "vitest";
import {
  CostlyDerivationError,
  InMemoryKnowledgeGraph,
  LocalExactQuoteEvidenceVerifier,
  LowConfidenceDictationHold,
  PremiseSupersessionReopener,
  ReplacementSecondEventDisambiguator,
  factsFromGraph,
  parseDecisionFields,
  selectEntailmentModel,
} from "../../src/entailment/index.js";
import { claim, decisionFields, excerpt, gateFor, phoneRules, seed, turn } from "./fixture.js";

describe("replacement, second events, low confidence, and quote guards", () => {
  it("replaces 11:00 with 10:45, keeps history, and reopens dependents", () => {
    const graph = new InMemoryKnowledgeGraph();
    seed(graph, "R17", decisionFields({ criterion: "orders.cutoff", status: "settled", basis: "explicit", value: "11:00" }));
    seed(
      graph,
      "D-late",
      decisionFields({
        criterion: "kitchen.close",
        status: "settled",
        basis: "derived",
        value: "11:00",
        premises: ["R17"],
        rule: "infer.cutoff",
      }),
      [{ type: "derived_from", dst: "R17" }],
    );
    const disambiguator = new ReplacementSecondEventDisambiguator(graph, new PremiseSupersessionReopener(graph));
    const decision = disambiguator.apply("Actually set the cutoff to 10:45", factsFromGraph(graph, ["R17"]));
    expect(decision.kind).toBe("replacement");
    if (decision.kind !== "replacement") return;
    expect(decision.previousValue).toBe("11:00");
    expect(decision.nextValue).toBe("10:45");
    expect(decision.historyRetained).toBe(true);
    expect(parseDecisionFields(graph.getNode("R17")?.fields)?.value).toBe("10:45");
    expect(parseDecisionFields(graph.history("R17")[0]?.fields)?.value).toBe("11:00");
    expect(parseDecisionFields(graph.getNode("D-late")?.fields)?.status).toBe("open");
  });

  it("preserves an 11:00 cutoff beside a 10:45 kitchen count and asks clarify@1", () => {
    const graph = new InMemoryKnowledgeGraph();
    seed(graph, "R17", decisionFields({ criterion: "orders.cutoff", status: "settled", basis: "explicit", value: "11:00" }));
    const version = graph.getNode("R17")?.version;
    const disambiguator = new ReplacementSecondEventDisambiguator(graph, new PremiseSupersessionReopener(graph));
    const decision = disambiguator.apply("Kitchen wants final counts at 10:45", factsFromGraph(graph, ["R17"]));
    expect(decision.kind).toBe("second_event");
    if (decision.kind !== "second_event") return;
    expect(decision.clarifyContract).toBe("clarify@1");
    expect(decision.question).toContain("orders lock at 10:45");
    expect(decision.question).toContain("preliminary count");
    expect(decision.question).toContain("11:00");
    expect(decision.preserved).toEqual([
      { criterion: "orders.cutoff", value: "11:00" },
      { criterion: "kitchen.final_counts", value: "10:45" },
    ]);
    expect(graph.getNode("R17")?.version).toBe(version);
    expect(parseDecisionFields(graph.getNode("R17")?.fields)?.value).toBe("11:00");
    expect(parseDecisionFields(graph.getNode("kitchen.final_counts")?.fields)?.status).toBe("open");
    expect(parseDecisionFields(graph.getNode("kitchen.final_counts")?.fields)?.value).toBe("10:45");
  });

  it("holds a low-confidence dictated time open and bolds it in the change summary", () => {
    const source = turn("T4", "The cutoff is 10:45");
    const hold = new LowConfidenceDictationHold().assess({
      proposedValue: "10:45",
      excerpts: [excerpt(source, "10:45", { lowConfidence: true, valueKind: "time" })],
    });
    expect(hold.summary).toContain("**10:45**");
    const { graph, adapter, gate } = gateFor(
      () => {
        throw new Error("low-confidence values must not reach entailment-checker@1");
      },
      phoneRules,
      [source],
    );
    const result = gate.check(
      claim({
        decisionId: "D-time",
        criterion: "orders.cutoff",
        basis: "explicit",
        value: "10:45",
        excerpts: [excerpt(source, "10:45", { lowConfidence: true, valueKind: "time", support: "explicit_value" })],
        rule: null,
        costly: true,
        reversibility: "hard",
        criterionKind: "time",
      }),
    );
    expect(result.outcome).toBe("open");
    expect(result.credit).toBe(false);
    expect(result.changeSummary).toContain("**10:45**");
    expect(result.modelInvoked).toBe(false);
    expect(adapter.requests).toHaveLength(0);
    expect(parseDecisionFields(graph.getNode("D-time")?.fields)?.status).toBe("open");
  });

  it("rejects assistant quotes, edited digits, and dropped negations, and bans costly derivations", () => {
    const verifier = new LocalExactQuoteEvidenceVerifier();
    const source = turn("T5", "don't allow edits after 10:45");
    const assistant = turn("T6", "allow edits after 10:45", "harness");
    expect(verifier.verify({ turn: assistant, excerpt: excerpt(assistant, assistant.text) }).ok).toBe(false);
    const start = source.text.indexOf("allow edits after 10:45");
    expect(
      verifier.verify({
        turn: source,
        excerpt: excerpt(source, "allow edits after 10:45", { start, end: start + "allow edits after 10:45".length }),
      }).reason,
    ).toContain("negation");
    expect(
      verifier.verify({
        turn: source,
        excerpt: excerpt(source, "don't allow edits after 11:00", { start: 0, end: source.text.length }),
      }).ok,
    ).toBe(false);
    expect(verifier.verify({ turn: source, excerpt: excerpt(source, source.text) }).ok).toBe(true);

    const phone = turn("T8", "Staff use a link on a phone");
    const { adapter, gate } = gateFor(
      () => {
        throw new Error("costly derivations must not call the model");
      },
      phoneRules,
      [phone],
    );
    const result = gate.check(
      claim({
        decisionId: "D-paid",
        criterion: "auth.provider",
        excerpts: [excerpt(phone, phone.text)],
        rule: "infer.phone_menu_access",
        premises: [],
        costly: true,
        criterionKind: "identity",
      }),
    );
    expect(result.errorName).toBe(CostlyDerivationError.name);
    expect(adapter.requests).toHaveLength(0);
    expect(result.credit).toBe(false);
  });

  it("uses the only connected family when a second family is absent", () => {
    const selected = selectEntailmentModel({
      connected: [{ family: "batch-family", modelId: "resolver-a" }],
      batchResolve: { family: "batch-family", modelId: "resolver-a" },
    });
    expect(selected.independentFamily).toBe(false);
    expect(selected.modelId).toBe("resolver-a");
  });
});
