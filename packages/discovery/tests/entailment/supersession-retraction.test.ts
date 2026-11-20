import { describe, expect, it } from "vitest";
import {
  InMemoryKnowledgeGraph,
  LongTurnRetractionReconciler,
  PremiseSupersessionReopener,
  contradicts,
  parseDecisionFields,
} from "../../src/entailment/index.js";
import { claim, decisionFields, excerpt, gateFor, phoneRules, seed, turn } from "./fixture.js";

function explicit(criterion: string, value: string) {
  return decisionFields({ criterion, status: "settled", basis: "explicit", value, criterionKind: criterion });
}

describe("premise supersession and cross-chunk retraction", () => {
  it("reopens D2 and D5, re-anchors D3, and leaves D4 and a fields-only link untouched", () => {
    const graph = new InMemoryKnowledgeGraph();
    const quote = turn("T9", "Keep the kitchen list on the wall.");
    seed(graph, "P1", explicit("access.device", "phone_link"));
    seed(
      graph,
      "D2",
      decisionFields({
        criterion: "menu.mobile_web",
        status: "settled",
        basis: "derived",
        value: true,
        rule: "infer.phone_menu_access",
        premises: ["P1"],
        evidence: [excerpt(quote, quote.text)],
      }),
      [{ type: "derived_from", dst: "P1" }],
    );
    seed(
      graph,
      "D3",
      decisionFields({
        criterion: "menu.wall_list",
        status: "settled",
        basis: "derived",
        value: true,
        rule: "infer.wall_list",
        premises: ["P1"],
        evidence: [excerpt(quote, quote.text, { support: "explicit_value" })],
      }),
      [{ type: "derived_from", dst: "P1" }],
    );
    seed(graph, "D4", explicit("delivery.channel", "email"), [{ type: "depends_on", dst: "P1" }]);
    seed(
      graph,
      "D-fields-only",
      decisionFields({
        criterion: "menu.extra",
        status: "settled",
        basis: "derived",
        value: true,
        premises: ["P1"],
        rule: "infer.phone_menu_access",
      }),
    );
    seed(
      graph,
      "D5",
      decisionFields({
        criterion: "menu.mobile_checkout",
        status: "settled",
        basis: "derived",
        value: true,
        premises: ["D2"],
        rule: "infer.phone_menu_access",
      }),
      [{ type: "derived_from", dst: "D2" }],
    );
    const beforeD4 = graph.getNode("D4")?.version;

    const report = new PremiseSupersessionReopener(graph).supersede("P1", "superseded");
    expect(report.effects).toHaveLength(3);
    expect(report.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "D2", action: "reopened" }),
        expect.objectContaining({ id: "D5", action: "reopened" }),
        expect.objectContaining({ id: "D3", action: "preserved_explicit" }),
      ]),
    );
    expect(graph.getNode("P1")?.status).toBe("superseded");
    const d2 = parseDecisionFields(graph.getNode("D2")?.fields);
    expect(d2?.status).toBe("open");
    expect(d2?.basis).toBeNull();
    expect(graph.getNode("D2")?.version).toBe(2);
    const d2History = graph.history("D2").map((version) => parseDecisionFields(version.fields)?.status);
    expect(d2History).toEqual(["settled", "open"]);
    const d3 = parseDecisionFields(graph.getNode("D3")?.fields);
    expect(d3?.status).toBe("settled");
    expect(d3?.basis).toBe("explicit");
    expect(parseDecisionFields(graph.getNode("D5")?.fields)?.status).toBe("open");
    expect(graph.getNode("D4")?.version).toBe(beforeD4);
    expect(parseDecisionFields(graph.getNode("D4")?.fields)?.value).toBe("email");
    expect(graph.getNode("D-fields-only")?.version).toBe(1);
    expect(parseDecisionFields(graph.getNode("D-fields-only")?.fields)?.status).toBe("settled");
    const edges = graph.getEdgesAsOf(graph.currentRevision()).edges;
    expect(edges.some((edge) => edge.type === "derived_from" && (edge.src === "D2" || edge.src === "D3" || edge.src === "D5"))).toBe(
      false,
    );
    expect(edges).toContainEqual({ src: "D4", type: "depends_on", dst: "P1" });
  });

  it("follows derived_from from R17 and does not reopen delivery.channel", () => {
    const graph = new InMemoryKnowledgeGraph();
    seed(graph, "R17", explicit("orders.cutoff", "11:00"));
    seed(graph, "delivery.channel", explicit("delivery.channel", "email"), [{ type: "depends_on", dst: "R17" }]);
    seed(
      graph,
      "D-cutoff",
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
    new PremiseSupersessionReopener(graph).supersede("R17", "superseded");
    expect(parseDecisionFields(graph.getNode("D-cutoff")?.fields)?.status).toBe("open");
    expect(graph.getNode("delivery.channel")?.version).toBe(1);
    expect(parseDecisionFields(graph.getNode("delivery.channel")?.fields)?.status).toBe("settled");
  });

  it("reconciles a scrapped printing idea across chunks before any database write", () => {
    const graph = new InMemoryKnowledgeGraph();
    const reconciler = new LongTurnRetractionReconciler(graph);
    const opening = "Maybe add printing";
    const filler = "note ".repeat(500);
    const ending = "actually, scrap printing";
    const scrapped = reconciler.reconcile({
      turnId: "T-long",
      author: "developer",
      chunks: [
        {
          index: 0,
          text: opening,
          startOffset: 0,
          claims: [
            {
              id: "print-1",
              criterion: "feature.printing",
              value: true,
              feature: "printing",
              quote: opening,
              start: 0,
              end: opening.length,
            },
          ],
        },
        { index: 1, text: filler, startOffset: opening.length + 1, claims: [] },
        {
          index: 2,
          text: ending,
          startOffset: opening.length + 1 + filler.length + 1,
          claims: [],
        },
      ],
    });
    expect(graph.currentRevision()).toBe(0);
    expect(scrapped.spans[0]?.retracted).toBe(true);
    scrapped.commit();
    expect(graph.getNode("print-1")).toBeNull();
    expect(graph.currentRevision()).toBe(0);

    const menus = "Maybe print menus";
    const scrapPrint = "actually scrap print";
    const second = reconciler.reconcile({
      turnId: "T-print",
      author: "developer",
      chunks: [
        {
          index: 0,
          text: menus,
          startOffset: 0,
          claims: [
            {
              id: "print-2",
              criterion: "feature.printing",
              value: true,
              feature: "printing",
              quote: menus,
              start: 0,
              end: menus.length,
            },
          ],
        },
        {
          index: 1,
          text: scrapPrint,
          startOffset: 400,
          claims: [],
        },
      ],
    });
    second.commit();
    expect(second.spans[0]?.retracted).toBe(true);
    expect(graph.getNode("print-2")).toBeNull();

    const alone = reconciler.reconcile({
      turnId: "T-keep",
      author: "developer",
      chunks: [
        {
          index: 0,
          text: "Maybe add printing",
          startOffset: 0,
          claims: [
            {
              id: "print-keep",
              criterion: "feature.printing",
              value: true,
              feature: "printing",
              quote: "Maybe add printing",
              start: 0,
              end: "Maybe add printing".length,
            },
          ],
        },
      ],
    });
    expect(graph.currentRevision()).toBe(0);
    alone.commit();
    expect(parseDecisionFields(graph.getNode("print-keep")?.fields)?.feature).toBe("printing");
    expect(parseDecisionFields(graph.getNode("print-keep")?.fields)?.release).toBe("current");

    const later = reconciler.reconcile({
      turnId: "T-later",
      author: "developer",
      chunks: [
        {
          index: 0,
          text: "Add printing after launch",
          startOffset: 0,
          claims: [
            {
              id: "print-later",
              criterion: "feature.printing",
              value: true,
              feature: "printing",
              quote: "Add printing after launch",
              start: 0,
              end: "Add printing after launch".length,
            },
          ],
        },
      ],
    });
    later.commit();
    expect(parseDecisionFields(graph.getNode("print-later")?.fields)?.release).toBe("later");
  });

  it("stores a contradicting entailment as a conflict with no credit", () => {
    const source = turn("T8", "Staff use a link on a phone");
    const { graph, gate } = gateFor(() => contradicts("The quote denies a native app."), phoneRules, [source]);
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
    const result = gate.check(
      claim({
        decisionId: "D-native",
        criterion: "app.native_mobile",
        excerpts: [excerpt(source, source.text)],
        rule: "infer.native_app",
        premises: ["E-phone"],
      }),
    );
    expect(result.outcome).toBe("conflict");
    expect(result.credit).toBe(false);
    expect(parseDecisionFields(graph.getNode("D-native")?.fields)?.status).toBe("conflict");
  });
});
