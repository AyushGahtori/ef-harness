import { describe, expect, it } from "vitest";
import { IntervalConflictDetector, type IntervalSource } from "../../src/contradictions/index.js";

const detector = new IntervalConflictDetector();

function source(nodeId: string, text: string): IntervalSource {
  return { nodeId, text };
}

describe("interval conflicts", () => {
  it("flags 10:45 before an 11:00 cutoff using minutes-of-day", () => {
    const conflicts = detector.detect([
      source("cutoff", "Kitchen cutoff time 11:00 AM America/New_York"),
      source("print", "Kitchen prints at 10:45 AM local"),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.nodeIds).toEqual(["cutoff", "print"]);
    expect(conflicts[0]?.concreteCounterexample).toContain("645");
    expect(conflicts[0]?.concreteCounterexample).toContain("660");
    expect(conflicts[0]?.layer).toBe(4);
  });

  it("flags prep at 10:30 against an 11:00 cutoff when edits stop after prep", () => {
    const conflicts = detector.detect([
      source("cutoff", "order_cutoff = 11:00"),
      source("prep", "prep_starts = 10:30 and no edits after prep starts"),
    ]);
    expect(conflicts.some((conflict) => conflict.ruleId === "prep_before_cutoff")).toBe(true);
    const prep = conflicts.find((conflict) => conflict.ruleId === "prep_before_cutoff");
    expect(prep?.nodeIds).toEqual(["cutoff", "prep"]);
    expect(prep?.concreteCounterexample).toContain("630");
    expect(prep?.concreteCounterexample).toContain("660");
  });

  it("flags a 5 MB upload cap against a 25 MB attachment", () => {
    const conflicts = detector.detect([
      source("api", "upload_max_bytes = 5 MB"),
      source("feature", "attach 25 MB high-res menus"),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.nodeIds).toEqual(["api", "feature"]);
    expect(conflicts[0]?.concreteCounterexample).toContain("5000000");
    expect(conflicts[0]?.concreteCounterexample).toContain("25000000");
  });

  it("treats 5120 KB as 5 MiB and still flags decimal 5 MB and 10 MB", () => {
    expect(detector.detect([source("kb", "payload = 5120 KB"), source("mib", "payload = 5 MiB")])).toEqual([]);
    const decimal = detector.detect([source("kb", "payload = 5120 KB"), source("mb", "payload = 5 MB")]);
    expect(decimal).toHaveLength(1);
    expect(decimal[0]?.concreteCounterexample).toContain("5242880");
    expect(decimal[0]?.concreteCounterexample).toContain("5000000");
    const ten = detector.detect([source("kb", "payload = 5120 KB"), source("ten", "payload = 10 MB")]);
    expect(ten).toHaveLength(1);
    expect(ten[0]?.concreteCounterexample).toContain("10000000");
  });

  it("flags session TTL prose that does not structurally distinguish idle from absolute", () => {
    const conflicts = detector.detect([
      source("ttl", "session_ttl = 7d"),
      source("logout", "auto-logout after 15 min inactivity"),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.nodeIds).toEqual(["logout", "ttl"]);
    expect(conflicts[0]?.concreteCounterexample).toContain("604800000");
    expect(conflicts[0]?.concreteCounterexample).toContain("900000");
  });

  it("keeps structured idle and absolute session bounds compatible", () => {
    const conflicts = detector.detect([
      {
        nodeId: "absolute",
        text: "",
        claims: [{ key: "session", family: "duration_ms", bound: "exact", amount: 7, unit: "d", qualifier: "absolute" }],
      },
      {
        nodeId: "idle",
        text: "",
        claims: [{ key: "session", family: "duration_ms", bound: "exact", amount: 15, unit: "min", qualifier: "idle" }],
      },
    ]);
    expect(conflicts).toEqual([]);
  });

  it("normalizes minor currency and row counts before comparing", () => {
    const money = detector.detect([source("low", "fee = $5.00"), source("high", "fee = 2500 cents")]);
    expect(money).toHaveLength(1);
    expect(money[0]?.concreteCounterexample).toContain("minor currency");
    const rows = detector.detect([source("cap", "export_max = 100 rows"), source("need", "export_min = 250 rows")]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.concreteCounterexample).toContain("250");
    expect(rows[0]?.concreteCounterexample).toContain("100");
  });
});
