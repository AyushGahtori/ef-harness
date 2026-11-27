import { describe, expect, it } from "vitest";
import {
  LocalSqliteKnowledgeGraph,
  VALUE_LIMIT_TAGS,
  localContentHash,
  parseDecisionFields,
  toDecisionNodeFields,
  valueSatisfiesLimits,
} from "../../src/core/index.js";

describe("decision contract", () => {
  it("accepts non-sqlite options when their limit tags match", () => {
    expect(VALUE_LIMIT_TAGS.postgres).toContain("relational_acid");
    expect(valueSatisfiesLimits("postgres", ["relational_acid"])).toBe(true);
    expect(valueSatisfiesLimits("postgres_relational", ["relational_acid"])).toBe(true);
    expect(valueSatisfiesLimits("local_only", ["local_only"])).toBe(true);
    expect(valueSatisfiesLimits("serverless_compatible", ["serverless_compatible"])).toBe(true);
    expect(valueSatisfiesLimits("zero_paid_saas", ["zero_paid_saas"])).toBe(true);
    expect(valueSatisfiesLimits("sqlite", ["free", "local"])).toBe(true);
    expect(valueSatisfiesLimits("postgres", ["free", "local"])).toBe(false);
    expect(valueSatisfiesLimits("paid-hosted-oracle", ["free", "local"])).toBe(false);
  });

  it("keeps group, option, and must-ask fields that other discovery writers store", () => {
    const parsed = parseDecisionFields({
      criterionId: "delivery.channel",
      status: "settled",
      basis: "explicit",
      value: "email",
      groupId: "delivery",
      must_ask: true,
      evidence: [{ turn: "T1", start: 0, end: 16, quote: "Email the totals" }],
    });
    expect(parsed.criterion).toBe("delivery.channel");
    expect(parsed.must_ask).toBe(true);
    expect(parsed.evidence?.[0]?.turnId).toBe("T1");
    expect(parsed.evidence?.[0]?.rubricId).toBeUndefined();
    const node = toDecisionNodeFields(parsed);
    expect(node.criterionId).toBe("delivery.channel");
    expect(node.groupId).toBe("delivery");
    expect(node.selectedOptionId).toBe("email");
  });

  it("writes a settled decision through KnowledgeGraphRepo with a prefixed content hash", () => {
    const graph = new LocalSqliteKnowledgeGraph(":memory:");
    graph.insertNode({
      id: "D-mail",
      kind: "decision",
      title: "notification channel",
      text: "Email the totals",
      fields: {
        criterion: "delivery.channel",
        status: "settled",
        basis: "explicit",
        value: "email",
        groupId: "delivery",
        evidence: [
          {
            rubricId: "opening.3",
            turnId: "T1",
            start: 0,
            end: 16,
            quote: "Email the totals",
          },
        ],
      },
      changeSetId: "cs-direct",
      rev: 1,
    });
    const stored = graph.getNode("D-mail");
    const fields = parseDecisionFields(JSON.parse(stored?.fieldsJson ?? "{}"));
    expect(fields.criterionId).toBe("delivery.channel");
    expect(fields.groupId).toBe("delivery");
    expect(fields.selectedOptionId).toBe("email");
    expect(graph.contentHash("D-mail")?.startsWith("sha256:")).toBe(true);
    expect(localContentHash({ kind: "decision", title: "t", text: "x", fields: {} }).startsWith("sha256:")).toBe(true);
    graph.close();
  });
});
