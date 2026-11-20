import { describe, expect, it } from "vitest";
import {
  CORPUS_RULE_IDS,
  CrossCuttingRuleMatcher,
  corpusCrossCuttingRules,
  inheritedTagsForTask,
  normalizeEntityTags,
  scopeMatches,
  type MatchableRule,
} from "../../src/rule-matching/index.js";
import { projectRule } from "./fixtures.js";

function ids(rules: readonly { ruleId: string }[]): string[] {
  return rules.map((rule) => rule.ruleId);
}

const formsRule: MatchableRule = projectRule({
  id: "P-FORMS",
  title: "Web forms require auth and forms",
  any: ["web_frontend"],
  all: ["auth", "forms"],
});

const globalRule: MatchableRule = projectRule({
  id: "P-GLOBAL",
  title: "Project wide",
  global: true,
});

describe("CrossCuttingRuleMatcher", () => {
  const matcher = new CrossCuttingRuleMatcher([
    ...corpusCrossCuttingRules(),
    formsRule,
    globalRule,
    projectRule({ id: "P-OFF", global: true, active: false }),
    projectRule({ id: "P-EMPTY-ANY", any: [], all: null }),
  ]);

  it("loads X-01 through X-14 and UP-01 through UP-08", () => {
    expect(CORPUS_RULE_IDS).toEqual([
      "X-01",
      "X-02",
      "X-03",
      "X-04",
      "X-05",
      "X-06",
      "X-07",
      "X-08",
      "X-09",
      "X-10",
      "X-11",
      "X-12",
      "X-13",
      "X-14",
      "UP-01",
      "UP-02",
      "UP-03",
      "UP-04",
      "UP-05",
      "UP-06",
      "UP-07",
      "UP-08",
    ]);
    expect(corpusCrossCuttingRules().filter((rule) => rule.kind === "cross_cutting")).toHaveLength(14);
    expect(corpusCrossCuttingRules().filter((rule) => rule.kind === "universal_policy")).toHaveLength(8);
  });

  it("matches any when one listed tag is present", () => {
    const report = matcher.match({
      taskTouches: ["money"],
      inheritedEntityTags: [],
      screenEndpointTags: [],
    });
    const money = report.matches.find((match) => match.ruleId === "X-04");
    expect(money?.matchedVia).toBe("direct_tag");
    expect(money?.matchedTags).toEqual(["money"]);
    expect(ids(report.matches)).not.toContain("X-07");
    expect(ids(report.matches)).toContain("P-GLOBAL");
    expect(report.matches.find((match) => match.ruleId === "P-GLOBAL")?.matchedVia).toBe("global");
    expect(ids(report.matches)).not.toContain("P-OFF");
    expect(ids(report.matches)).not.toContain("P-EMPTY-ANY");
  });

  it("requires every all tag and does not match a partial subset", () => {
    const personalOnly = matcher.match({
      taskTouches: ["personal_data"],
      inheritedEntityTags: [],
      screenEndpointTags: [],
    });
    expect(ids(personalOnly.matches)).not.toContain("X-07");
    const both = matcher.match({
      taskTouches: ["personal_data", "logging"],
      inheritedEntityTags: [],
      screenEndpointTags: [],
    });
    expect(both.matches.find((match) => match.ruleId === "X-07")?.matchedVia).toBe("direct_tag");
    expect(both.matches.find((match) => match.ruleId === "X-05")?.matchedVia).toBe("direct_tag");
  });

  it("matches any and all only when every required tag is in the union", () => {
    const missingForms = matcher.match({
      taskTouches: ["web_frontend", "auth"],
      inheritedEntityTags: [],
      screenEndpointTags: [],
    });
    expect(ids(missingForms.matches)).not.toContain("P-FORMS");
    const missingAny = matcher.match({
      taskTouches: ["auth", "forms"],
      inheritedEntityTags: [],
      screenEndpointTags: [],
    });
    expect(ids(missingAny.matches)).not.toContain("P-FORMS");
    const complete = matcher.match({
      taskTouches: ["web_frontend", "auth", "forms"],
      inheritedEntityTags: [],
      screenEndpointTags: [],
    });
    expect(complete.matches.find((match) => match.ruleId === "P-FORMS")).toMatchObject({
      matchedVia: "direct_tag",
      matchedTags: ["auth", "forms", "web_frontend"],
    });
  });

  it("attributes a match to entity inheritance only when direct tags are not enough", () => {
    const inherited = matcher.match({
      taskTouches: ["logging"],
      inheritedEntityTags: ["personal_data"],
      screenEndpointTags: [],
    });
    expect(inherited.matches.find((match) => match.ruleId === "X-07")?.matchedVia).toBe(
      "entity_inheritance",
    );
    expect(inherited.matches.find((match) => match.ruleId === "X-05")?.matchedVia).toBe("direct_tag");
    const directMoney = matcher.match({
      taskTouches: ["money"],
      inheritedEntityTags: ["money"],
      screenEndpointTags: [],
    });
    expect(directMoney.matches.find((match) => match.ruleId === "X-04")?.matchedVia).toBe("direct_tag");
    const inheritedMoney = matcher.match({
      taskTouches: [],
      inheritedEntityTags: ["money"],
      screenEndpointTags: [],
    });
    expect(inheritedMoney.matches.find((match) => match.ruleId === "X-04")?.matchedVia).toBe(
      "entity_inheritance",
    );
  });

  it("treats screen and endpoint tags as direct provenance", () => {
    const report = matcher.match({
      taskTouches: [],
      inheritedEntityTags: [],
      screenEndpointTags: ["route"],
    });
    expect(report.effectiveTags).toEqual(["route"]);
    expect(report.matches.find((match) => match.ruleId === "X-01")?.matchedVia).toBe("direct_tag");
    expect(report.matches.find((match) => match.ruleId === "X-11")?.matchedVia).toBe("direct_tag");
    expect(report.matches.find((match) => match.ruleId === "UP-08")?.matchedVia).toBe("direct_tag");
    expect(ids(report.matches)).not.toContain("X-04");
  });

  it("matches a global rule against an empty tag union and skips inactive rules", () => {
    const report = matcher.match({
      taskTouches: [],
      inheritedEntityTags: [],
      screenEndpointTags: [],
    });
    expect(report.matches.map((match) => match.ruleId)).toEqual(["P-GLOBAL"]);
    expect(scopeMatches({ global: false, any: null, all: null }, new Set())).toBe(true);
    expect(scopeMatches({ global: false, any: [], all: null }, new Set(["money"]))).toBe(false);
    expect(scopeMatches({ global: true, any: [], all: ["missing"] }, new Set())).toBe(true);
  });

  it("normalizes inherited entity tag pii before matching X-07", () => {
    expect(normalizeEntityTags(["pii", "money", "pii"])).toEqual(["money", "personal_data"]);
    const inherited = inheritedTagsForTask(
      { nodes: [{ id: "T-Export", inheritedTags: ["pii"] }] },
      "T-Export",
    );
    const report = matcher.match({
      taskTouches: ["logging"],
      inheritedEntityTags: inherited,
      screenEndpointTags: [],
    });
    expect(report.matches.find((match) => match.ruleId === "X-07")?.matchedVia).toBe(
      "entity_inheritance",
    );
  });
});
