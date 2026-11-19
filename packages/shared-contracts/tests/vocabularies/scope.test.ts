import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  ClosedVocabularyError,
  evaluateTouchesScope,
  isTouchesTag,
  matchesScopePredicate,
  ScopePredicateSchema,
  TOUCHES_TAG_GROUPS,
  TOUCHES_TAGS,
  TouchesTagSchema,
  type ScopePredicate,
  type TouchesTag,
} from "../../src/vocabularies/index.js";

const CROSS_CUTTING_RULES: readonly {
  id: string;
  predicate: ScopePredicate;
}[] = [
  { id: "X-01", predicate: { all: ["route", "authz"] } },
  { id: "X-02", predicate: { any: ["form_input", "inbound_webhook", "external_api"] } },
  { id: "X-03", predicate: { any: ["scheduling", "time_display"] } },
  { id: "X-04", predicate: { any: ["money"] } },
  { id: "X-05", predicate: { any: ["credentials", "config_env", "logging"] } },
  { id: "X-06", predicate: { any: ["destructive_write"] } },
  { id: "X-07", predicate: { all: ["personal_data", "logging"] } },
  { id: "X-08", predicate: { any: ["file_upload"] } },
  { id: "X-09", predicate: { any: ["inbound_webhook"] } },
  { id: "X-10", predicate: { any: ["external_api", "outbound_message"] } },
  { id: "X-11", predicate: { any: ["route", "interactive_ui"] } },
  { id: "X-12", predicate: { any: ["background_job"] } },
  { id: "X-13", predicate: { any: ["interactive_ui"] } },
  { id: "X-14", predicate: { any: ["authn", "rate_limited"] } },
];

function accepts(predicate: ScopePredicate): TouchesTag[][] {
  if (predicate.all && predicate.any === undefined) {
    const all = [...predicate.all];
    return [all, [...all, "search"]];
  }
  if (predicate.any && predicate.all === undefined) {
    return predicate.any.map((tag) => [tag, "search"]);
  }
  return [];
}

function rejects(predicate: ScopePredicate): TouchesTag[][] {
  if (predicate.all && predicate.any === undefined) {
    const all = [...predicate.all];
    return [[], ...all.map((tag) => all.filter((item) => item !== tag))];
  }
  if (predicate.any && predicate.all === undefined) {
    return [[], ["search"]];
  }
  return [];
}

describe("closed touches tags and scope predicates", () => {
  it("lists the 28 corpus tags in the seven documented groups", () => {
    expect(TOUCHES_TAG_GROUPS.map((group) => group.group)).toEqual([
      "Data sensitivity",
      "Identity",
      "Time",
      "I/O",
      "Data operations",
      "UI",
      "Operations",
    ]);
    expect(TOUCHES_TAG_GROUPS.flatMap((group) => [...group.tags])).toEqual([...TOUCHES_TAGS]);
    expect(new Set(TOUCHES_TAGS).size).toBe(28);
    expect(TOUCHES_TAGS).toHaveLength(28);
    for (const tag of TOUCHES_TAGS) {
      expect(tag).toMatch(/^[a-z][a-z0-9_]*$/u);
      expect(isTouchesTag(tag)).toBe(true);
      expect(isTouchesTag(tag.toUpperCase())).toBe(false);
      expect(TouchesTagSchema.safeParse(tag.toUpperCase()).success).toBe(false);
    }
  });

  it("hard-rejects tags outside the closed registry", () => {
    expect(TouchesTagSchema.safeParse("payments_stripe").success).toBe(false);
    expect(ScopePredicateSchema.safeParse({ any: ["payments_stripe"] }).success).toBe(false);
    expect(ScopePredicateSchema.safeParse({ all: ["Route"] }).success).toBe(false);
    expect(() =>
      evaluateTouchesScope(["payments_stripe" as TouchesTag], { any: ["route"] }),
    ).toThrow(ClosedVocabularyError);
  });

  it("rejects empty predicates and arbitrary predicate strings", () => {
    expect(ScopePredicateSchema.safeParse({}).success).toBe(false);
    expect(ScopePredicateSchema.safeParse({ any: [] }).success).toBe(false);
    expect(ScopePredicateSchema.safeParse({ all: [] }).success).toBe(false);
    expect(ScopePredicateSchema.safeParse({ any: [], all: [] }).success).toBe(false);
    expect(ScopePredicateSchema.safeParse({ all: ["route"], any: [] }).success).toBe(false);
    expect(ScopePredicateSchema.safeParse({ any: ["route"], all: [] }).success).toBe(false);
    for (const bogus of [
      "task.tags.includes('route')",
      "SELECT 1",
      "touches ANY route",
      { where: "touches('payments_stripe')" },
      { not: ["route"] },
      { any: ["route"], sql: "1=1" },
      { any: ["route"], all: ["authz"], expr: "true" },
    ]) {
      expect(ScopePredicateSchema.safeParse(bogus).success).toBe(false);
    }
    expect(() => evaluateTouchesScope(["route"], {})).toThrow(ZodError);
    expect(() => matchesScopePredicate(["route"], { any: [] })).toThrow(ZodError);
  });

  it("matches X-01 only when both route and authz are present", () => {
    const predicate = { all: ["route", "authz"] } as const;
    expect(evaluateTouchesScope(["route", "authz"], predicate)).toBe(true);
    expect(matchesScopePredicate(["authz", "route", "logging"], predicate)).toBe(true);
    expect(evaluateTouchesScope(["route"], predicate)).toBe(false);
    expect(evaluateTouchesScope(["authz"], predicate)).toBe(false);
    expect(evaluateTouchesScope(["route", "authn"], predicate)).toBe(false);
    expect(evaluateTouchesScope([], predicate)).toBe(false);
  });

  it("matches X-07 only when both personal_data and logging are present", () => {
    const predicate = { all: ["personal_data", "logging"] } as const;
    expect(evaluateTouchesScope(["personal_data", "logging"], predicate)).toBe(true);
    expect(matchesScopePredicate(["logging", "personal_data", "money"], predicate)).toBe(true);
    expect(evaluateTouchesScope(["personal_data"], predicate)).toBe(false);
    expect(evaluateTouchesScope(["logging"], predicate)).toBe(false);
    expect(evaluateTouchesScope(["personal_data", "authz"], predicate)).toBe(false);
  });

  it("requires every all tag and at least one any tag when both are set", () => {
    const predicate = {
      all: ["route", "authz"],
      any: ["form_input", "inbound_webhook"],
    } as const;
    expect(ScopePredicateSchema.safeParse(predicate).success).toBe(true);
    expect(evaluateTouchesScope(["route", "authz", "form_input"], predicate)).toBe(true);
    expect(matchesScopePredicate(["inbound_webhook", "authz", "route"], predicate)).toBe(true);
    expect(evaluateTouchesScope(["route", "authz"], predicate)).toBe(false);
    expect(evaluateTouchesScope(["form_input"], predicate)).toBe(false);
    expect(evaluateTouchesScope(["route", "form_input"], predicate)).toBe(false);
  });

  it("validates X-01 through X-14 and matches the closed tag sets", () => {
    expect(CROSS_CUTTING_RULES.map((rule) => rule.id)).toEqual([
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
    ]);
    for (const rule of CROSS_CUTTING_RULES) {
      expect(ScopePredicateSchema.safeParse(rule.predicate).success).toBe(true);
      for (const tags of accepts(rule.predicate)) {
        expect(evaluateTouchesScope(tags, rule.predicate)).toBe(true);
        expect(matchesScopePredicate(tags, rule.predicate)).toBe(true);
      }
      for (const tags of rejects(rule.predicate)) {
        expect(evaluateTouchesScope(tags, rule.predicate)).toBe(false);
        expect(matchesScopePredicate(tags, rule.predicate)).toBe(false);
      }
    }
  });

  it("agrees on any/all semantics for arbitrary closed tag sets", () => {
    fc.assert(
      fc.property(
        fc.subarray([...TOUCHES_TAGS], { minLength: 0, maxLength: 8 }),
        fc.subarray([...TOUCHES_TAGS], { minLength: 1, maxLength: 3 }),
        fc.subarray([...TOUCHES_TAGS], { minLength: 1, maxLength: 3 }),
        fc.boolean(),
        fc.boolean(),
        (taskTags, anyTags, allTags, useAny, useAll) => {
          if (!useAny && !useAll) return;
          const predicate: ScopePredicate = {
            ...(useAny ? { any: anyTags } : {}),
            ...(useAll ? { all: allTags } : {}),
          };
          const present = new Set<string>(taskTags);
          const allOk = !useAll || allTags.every((tag) => present.has(tag));
          const anyOk = !useAny || anyTags.some((tag) => present.has(tag));
          const expected = allOk && anyOk;
          expect(evaluateTouchesScope(taskTags, predicate)).toBe(expected);
          expect(matchesScopePredicate(taskTags, predicate)).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});
