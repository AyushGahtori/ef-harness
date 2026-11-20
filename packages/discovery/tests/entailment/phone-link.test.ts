import { describe, expect, it } from "vitest";
import {
  earnsReadinessCredit,
  established,
  leavesOpen,
  parseDecisionFields,
  parseEntailmentCheckerV1,
  type EntailmentModelRequest,
} from "../../src/entailment/index.js";
import {
  PHONE_QUOTE,
  PHONE_QUOTE_THEIRS,
  claim,
  decisionFields,
  excerpt,
  gateFor,
  phoneRules,
  seed,
  turn,
} from "./fixture.js";

function script(request: EntailmentModelRequest) {
  if (request.payload.criterion === "menu.mobile_web") {
    return established("The quote says they use a link on a phone.");
  }
  return leavesOpen("A nearby phone quote does not establish offline support or a native app.");
}

describe("Review Area B phone-link entailment", () => {
  it("accepts mobile web and leaves offline and native open for both phone quotes", () => {
    for (const text of [PHONE_QUOTE, PHONE_QUOTE_THEIRS]) {
      const source = turn("T8", text);
      const { graph, adapter, metrics, gate } = gateFor(script, phoneRules, [source]);
      seed(
        graph,
        "E-phone",
        decisionFields({
          criterion: "access.device",
          status: "settled",
          basis: "explicit",
          value: "phone_link",
          evidence: [excerpt(source, text, { support: "explicit_value" })],
        }),
      );
      const cite = excerpt(source, text);
      const batch = gate.checkAll([
        claim({
          decisionId: "D-mobile",
          criterion: "menu.mobile_web",
          excerpts: [cite],
          rule: "infer.phone_menu_access",
          premises: ["E-phone"],
        }),
        claim({
          decisionId: "D-offline",
          criterion: "app.offline_support",
          excerpts: [cite],
          rule: "infer.offline_support",
          premises: ["E-phone"],
        }),
        claim({
          decisionId: "D-native",
          criterion: "app.native_mobile",
          excerpts: [cite],
          rule: "infer.native_app",
          premises: ["E-phone"],
        }),
      ]);

      const mobile = batch.results[0];
      const offline = batch.results[1];
      const native = batch.results[2];
      expect(mobile?.outcome).toBe("settled");
      expect(mobile?.basis).toBe("derived");
      expect(mobile?.verdict).toBe("establishes");
      expect(mobile?.credit).toBe(true);
      expect(offline?.outcome).toBe("pending_verification");
      expect(offline?.verdict).toBe("leaves_open");
      expect(offline?.credit).toBe(false);
      expect(native?.verdict).toBe("leaves_open");
      expect(native?.credit).toBe(false);

      const mobileNode = graph.getNode("D-mobile");
      const mobileFields = mobileNode ? parseDecisionFields(mobileNode.fields) : null;
      expect(mobileFields?.value).toBe(true);
      expect(mobileFields && earnsReadinessCredit(mobileFields)).toBe(true);
      const offlineFields = parseDecisionFields(graph.getNode("D-offline")?.fields);
      expect(offlineFields?.status).toBe("pending_verification");
      expect(offlineFields && earnsReadinessCredit(offlineFields)).toBe(false);

      const edges = graph.getEdgesAsOf(graph.currentRevision()).edges;
      expect(edges).toContainEqual({ src: "D-mobile", type: "derived_from", dst: "E-phone" });
      expect(edges.some((edge) => edge.src === "D-offline" || edge.src === "D-native")).toBe(false);

      const payload = adapter.requests[0]?.payload;
      expect(payload && Object.keys(payload).sort()).toEqual([
        "citedExcerptsWithSurroundingParagraph",
        "criterion",
        "premises",
        "proposedValue",
        "rule",
      ]);
      expect(Object.keys(payload?.citedExcerptsWithSurroundingParagraph[0] ?? {}).sort()).toEqual([
        "quote",
        "surroundingParagraph",
      ]);
      expect(JSON.stringify(adapter.requests)).not.toContain("lowConfidence");
      expect(adapter.requests.every((request) => request.contractId === "entailment-checker@1")).toBe(true);
      expect(adapter.requests.every((request) => request.family === "check-family")).toBe(true);
      expect(adapter.requests.every((request) => request.family !== "batch-family")).toBe(true);
      expect(metrics.records.map((record) => record.verdict)).toEqual([
        "establishes",
        "leaves_open",
        "leaves_open",
      ]);
      expect(metrics.records.every((record) => record.resolverModel === "resolver-a")).toBe(true);
      expect(metrics.records.every((record) => record.entailmentModel === "entailment-b")).toBe(true);
      expect(metrics.records.every((record) => record.criterionKind === "access")).toBe(true);
    }
  });

  it("parses the Task 009 entailment success and blocked shapes and rejects extra keys", () => {
    expect(parseEntailmentCheckerV1({ verdict: "establishes", reason: "The quote states the channel is email." })).toEqual({
      verdict: "establishes",
      reason: "The quote states the channel is email.",
    });
    expect(parseEntailmentCheckerV1({ blocked: true, reason: "missing premise", missing_ids: ["P1"] })?.blocked).toBe(true);
    expect(parseEntailmentCheckerV1({ verdict: "establishes", reason: "ok", extra: true })).toBeNull();
    expect(parseEntailmentCheckerV1({ verdict: "maybe", reason: "ok" })).toBeNull();
  });
});
