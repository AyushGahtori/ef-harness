import { describe, expect, it } from "vitest";
import {
  CyclicDerivationError,
  DerivationChainValidator,
  InMemoryKnowledgeGraph,
  MapInferenceCatalog,
  RuleNotAllowlistedError,
  UngroundedDerivationError,
  UnsettledPremiseError,
  established,
  parseDecisionFields,
  unavailable,
  type DerivationProposal,
} from "../../src/entailment/index.js";
import { claim, decisionFields, excerpt, gateFor, seed, turn } from "./fixture.js";

const rules = new Map<string, readonly string[]>([
  ["cycle.a", ["infer.cycle"]],
  ["cycle.b", ["infer.cycle"]],
  ["menu.mobile_web", ["infer.phone_menu_access"]],
  ["orders.cutoff", ["infer.cutoff"]],
  ["auth.provider", ["infer.provider"]],
]);

function proposal(
  decisionId: string,
  criterion: string,
  premises: readonly string[],
  evidence: DerivationProposal["evidence"] = [],
) {
  return {
    decisionId,
    criterion,
    rule: criterion === "menu.mobile_web" ? "infer.phone_menu_access" : "infer.cycle",
    premises,
    costly: false,
    reversibility: "easy" as const,
    mustAsk: false,
    evidence,
  };
}

describe("DerivationChainValidator", () => {
  it("rejects self-cycles, mutual cycles, unknown rules, and unsettled premises before any model call", () => {
    const graph = new InMemoryKnowledgeGraph();
    const validator = new DerivationChainValidator(graph, new MapInferenceCatalog(rules));
    const source = turn("T1", "Staff use a link on a phone");
    expect(() => validator.validate(proposal("D1", "cycle.a", ["D1"]))).toThrow(CyclicDerivationError);
    try {
      validator.validate(proposal("D1", "cycle.a", ["D1"]));
    } catch (error) {
      expect(error).toBeInstanceOf(CyclicDerivationError);
      expect((error as CyclicDerivationError).cycle).toEqual(["D1", "D1"]);
    }
    expect(() =>
      validator.validate(proposal("D-A", "cycle.a", ["D-B"]), [proposal("D-B", "cycle.b", ["D-A"])]),
    ).toThrow(CyclicDerivationError);
    try {
      validator.validate(proposal("D-A", "cycle.a", ["D-B"]), [proposal("D-B", "cycle.b", ["D-A"])]);
    } catch (error) {
      expect((error as CyclicDerivationError).cycle).toEqual(["D-A", "D-B", "D-A"]);
    }

    expect(() => validator.validate({ ...proposal("D-magic", "menu.mobile_web", ["E1"]), rule: "infer.magic_guess" })).toThrow(
      RuleNotAllowlistedError,
    );

    seed(graph, "P-open", decisionFields({ criterion: "access.device", status: "open", value: "phone" }));
    expect(() => validator.validate(proposal("D-open", "cycle.a", ["P-open"]))).toThrow(UnsettledPremiseError);

    seed(
      graph,
      "P-retracted",
      decisionFields({ criterion: "access.device", status: "settled", basis: "explicit", value: "x", retracted: true }),
    );
    try {
      validator.validate(proposal("D-ret", "cycle.a", ["P-retracted"]));
    } catch (error) {
      expect(error).toBeInstanceOf(UnsettledPremiseError);
      expect((error as UnsettledPremiseError).reason).toBe("retracted");
    }

    const { graph: gated, adapter, gate } = gateFor(() => established("no"), rules, [source]);
    seed(
      gated,
      "E1",
      decisionFields({
        criterion: "access.device",
        status: "settled",
        basis: "explicit",
        value: "phone_link",
        evidence: [excerpt(source, source.text, { support: "explicit_value" })],
      }),
    );
    const rejected = gate.check(
      claim({
        decisionId: "D-magic",
        criterion: "menu.mobile_web",
        excerpts: [excerpt(source, source.text)],
        rule: "infer.magic_guess",
        premises: ["E1"],
      }),
    );
    expect(rejected.errorName).toBe("RuleNotAllowlistedError");
    expect(rejected.credit).toBe(false);
    expect(adapter.requests).toHaveLength(0);
    expect(gated.getNode("D-magic")).toBeNull();
  });

  it("rejects assistant paraphrase, proposed roots, and unedged derived premises, and persists a grounded chain", () => {
    const source = turn("T2", "Email the totals.");
    const graph = new InMemoryKnowledgeGraph();
    const validator = new DerivationChainValidator(graph, new MapInferenceCatalog(rules));
    seed(
      graph,
      "P-paraphrase",
      decisionFields({
        criterion: "delivery.channel",
        status: "settled",
        basis: "explicit",
        value: "email",
        evidence: [excerpt(source, source.text, { author: "harness", support: "explicit_value" })],
      }),
    );
    expect(() => validator.validate(proposal("D-para", "cycle.a", ["P-paraphrase"]))).toThrow(UngroundedDerivationError);

    seed(
      graph,
      "P-proposed",
      decisionFields({ criterion: "delivery.channel", status: "settled", basis: "proposed", value: "email" }),
    );
    try {
      validator.validate(proposal("D-prop", "cycle.a", ["P-proposed"]));
    } catch (error) {
      expect(error).toBeInstanceOf(UngroundedDerivationError);
      expect((error as UngroundedDerivationError).reason).toBe("disallowed_basis");
    }

    seed(
      graph,
      "P-derived-bare",
      decisionFields({
        criterion: "delivery.channel",
        status: "settled",
        basis: "derived",
        value: "email",
        premises: ["missing-edge"],
        rule: "infer.cutoff",
      }),
    );
    try {
      validator.validate(proposal("D-bare", "cycle.a", ["P-derived-bare"]));
    } catch (error) {
      expect((error as UngroundedDerivationError).reason).toBe("unrooted");
    }

    seed(
      graph,
      "P-delegated",
      decisionFields({ criterion: "data.engine", status: "settled", basis: "delegated", value: "sqlite" }),
    );
    expect(() => validator.validate(proposal("D-del", "cycle.a", ["P-delegated"]))).not.toThrow();
    seed(
      graph,
      "P-observed",
      decisionFields({ criterion: "repo.database", status: "settled", basis: "observed", value: "postgres" }),
    );
    expect(() => validator.validate(proposal("D-obs", "cycle.a", ["P-observed"]))).not.toThrow();

    const phone = turn("T8", "Staff use a link on a phone");
    const { graph: persisted, gate } = gateFor(
      () => established("The quote establishes the menu link."),
      rules,
      [phone],
    );
    seed(
      persisted,
      "E-phone",
      decisionFields({
        criterion: "access.device",
        status: "settled",
        basis: "explicit",
        value: "phone_link",
        evidence: [excerpt(phone, phone.text, { support: "explicit_value" })],
      }),
    );
    const settled = gate.check(
      claim({
        decisionId: "D-mobile",
        criterion: "menu.mobile_web",
        excerpts: [excerpt(phone, phone.text)],
        rule: "infer.phone_menu_access",
        premises: ["E-phone"],
      }),
    );
    expect(settled.outcome).toBe("settled");
    const fields = parseDecisionFields(persisted.getNode("D-mobile")?.fields);
    expect(fields?.premises).toEqual(["E-phone"]);
    expect(persisted.getEdgesAsOf(persisted.currentRevision()).edges).toContainEqual({
      src: "D-mobile",
      type: "derived_from",
      dst: "E-phone",
    });
  });

  it("keeps a valid sibling when another claim is rejected, and fails closed on 503 and timeout", () => {
    const source = turn("T8", "Staff use a link on a phone");
    let calls = 0;
    const { graph, adapter, gate, metrics } = gateFor(
      () => {
        calls += 1;
        return calls === 1 ? unavailable(503) : established("grounded");
      },
      rules,
      [source],
    );
    seed(
      graph,
      "E-phone",
      decisionFields({
        criterion: "access.device",
        status: "settled",
        basis: "explicit",
        value: "phone_link",
        evidence: [excerpt(source, source.text, { support: "explicit_value" })],
      }),
    );
    const cite = excerpt(source, source.text);
    const timed = gateFor(() => ({ ok: false, failure: "timeout", statusCode: null }), rules, [source]);
    seed(
      timed.graph,
      "E-phone",
      decisionFields({
        criterion: "access.device",
        status: "settled",
        basis: "explicit",
        value: "phone_link",
        evidence: [excerpt(source, source.text, { support: "explicit_value" })],
      }),
    );
    const timeout = timed.gate.check(
      claim({
        decisionId: "D-time",
        criterion: "menu.mobile_web",
        excerpts: [cite],
        premises: ["E-phone"],
      }),
    );
    expect(timeout.outcome).toBe("pending_verification");
    expect(timeout.verdict).toBe("unavailable");
    expect(timeout.credit).toBe(false);
    expect(timeout.reason).toContain("timeout");
    expect(timed.graph.getEdgesAsOf(timed.graph.currentRevision()).edges.some((edge) => edge.src === "D-time")).toBe(false);

    const mixed = gate.checkAll([
      claim({
        decisionId: "D-magic",
        criterion: "menu.mobile_web",
        excerpts: [cite],
        rule: "infer.magic_guess",
        premises: ["E-phone"],
      }),
      claim({
        decisionId: "D-mobile",
        criterion: "menu.mobile_web",
        excerpts: [cite],
        premises: ["E-phone"],
      }),
    ]);
    expect(mixed.results[0]?.errorName).toBe("RuleNotAllowlistedError");
    expect(mixed.results[1]?.outcome).toBe("pending_verification");
    expect(mixed.results[1]?.reason).toContain("503");
    expect(adapter.requests).toHaveLength(1);
    expect(metrics.records[0]?.verdict).toBe("unavailable");
    expect(parseDecisionFields(graph.getNode("D-mobile")?.fields)?.status).toBe("pending_verification");
    expect(graph.getNode("D-magic")).toBeNull();
  });
});
