import { describe, expect, it } from "vitest";
import { CatalogRuleChecker, type CatalogRuleEntry, type SettledDecisionRef } from "../../src/contradictions/index.js";

function decision(id: string, optionId: string, groupId: string, basis = "explicit"): SettledDecisionRef {
  return { id, title: id, optionId, groupId, basis };
}

describe("layer 1 catalog rules", () => {
  const checker = new CatalogRuleChecker();

  it("flags a direct conflicts_with pair with both decision nodes and the catalog rule id", () => {
    const rules: CatalogRuleEntry[] = [
      { id: "rule-sqlite", optionId: "sqlite", groupId: "storage", conflictsWith: ["multi_writer"], requires: [] },
      { id: "rule-multi", optionId: "multi_writer", groupId: "jobs", conflictsWith: ["sqlite"], requires: [] },
    ];
    const conflicts = checker.check(
      [decision("D-sqlite", "sqlite", "storage"), decision("D-multi", "multi_writer", "jobs")],
      rules,
    );
    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0];
    expect(conflict?.layer).toBe(1);
    expect(conflict?.ruleId).toBe("rule-sqlite");
    expect(conflict?.nodeIds).toEqual(["D-multi", "D-sqlite"]);
    expect(conflict?.plainEnglishConflict).toContain("rule-sqlite");
    expect(conflict?.concreteCounterexample).toContain("sqlite");
    expect(conflict?.resolutionOptions.length).toBeGreaterThan(0);
  });

  it("flags an unsatisfied requires rule against the decision that chose the other option", () => {
    const rules: CatalogRuleEntry[] = [
      {
        id: "rule-workers",
        optionId: "background_workers",
        groupId: "jobs",
        conflictsWith: [],
        requires: [{ optionId: "postgres", groupId: "database" }],
      },
      { id: "rule-sqlite", optionId: "sqlite", groupId: "database", conflictsWith: [], requires: [] },
    ];
    const conflicts = checker.check(
      [decision("D-workers", "background_workers", "jobs"), decision("D-sqlite", "sqlite", "database")],
      rules,
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.nodeIds).toEqual(["D-sqlite", "D-workers"]);
    expect(conflicts[0]?.ruleId).toBe("rule-workers");
    expect(conflicts[0]?.plainEnglishConflict).toContain("postgres");
  });

  it("stays under 5 ms for two thousand settled decisions", () => {
    const decisions: SettledDecisionRef[] = [];
    const rules: CatalogRuleEntry[] = [];
    for (let index = 0; index < 2_000; index += 1) {
      decisions.push(decision(`D${String(index)}`, `opt${String(index)}`, `g${String(index)}`));
      rules.push({
        id: `rule${String(index)}`,
        optionId: `opt${String(index)}`,
        groupId: `g${String(index)}`,
        conflictsWith: [`missing${String(index)}`],
        requires: [],
      });
    }
    checker.check(decisions, rules);
    const started = performance.now();
    const conflicts = checker.check(decisions, rules);
    const elapsed = performance.now() - started;
    expect(conflicts).toHaveLength(0);
    expect(elapsed).toBeLessThan(5);
  });
});
