import { describe, expect, it } from "vitest";

import { parseFinalProjectAuditorV1 } from "../../src/final-audit/schema.js";

describe("final-project-auditor@1 schema", () => {
  it("accepts a complete audit only when every finding list is empty", () => {
    expect(
      parseFinalProjectAuditorV1({
        missing: [],
        stubbed: [],
        unhandled_edge_cases: [],
        weak_checks: [],
        verdict: "complete",
      }),
    ).toMatchObject({ verdict: "complete" });
  });

  it("rejects complete when any finding list is non-empty", () => {
    expect(() =>
      parseFinalProjectAuditorV1({
        missing: [{ requirement: "SI-1", location: "src/app.ts:1", detail: "Orders total is missing" }],
        stubbed: [],
        unhandled_edge_cases: [],
        weak_checks: [],
        verdict: "complete",
      }),
    ).toThrow(/complete is valid only/);
  });

  it("accepts an honest blocked exit and rejects extra keys", () => {
    expect(parseFinalProjectAuditorV1({ blocked: true, reason: "Need the route index", missing_ids: ["SI-9"] })).toMatchObject({
      blocked: true,
    });
    expect(() =>
      parseFinalProjectAuditorV1({
        missing: [],
        stubbed: [],
        unhandled_edge_cases: [],
        weak_checks: [],
        verdict: "incomplete",
        note: "extra",
      }),
    ).toThrow(/unexpected key/);
  });
});
