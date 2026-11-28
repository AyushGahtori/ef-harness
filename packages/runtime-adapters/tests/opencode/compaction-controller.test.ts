import { describe, expect, it } from "vitest";
import { OpenCodeCompactionController } from "../../src/opencode/index.js";
import type { UsageTotals } from "../../src/opencode/index.js";

const controller = new OpenCodeCompactionController();

function usage(input: number, extra: Partial<UsageTotals> = {}): UsageTotals {
  return { input, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, ...extra };
}

const mustChecklist = ["MUST keep the pinned checklist", "MUST retain write scope"];
const writeScope = ["src/**", "packages/runtime-adapters/src/opencode/**"];

describe("OpenCodeCompactionController", () => {
  it("stays idle below 75 percent", () => {
    const assessment = controller.assess({
      usage: usage(749),
      contextCeilingTokens: 1000,
      mustChecklist,
      writeScope,
      brief: "MUST keep the pinned checklist",
      transcript: "working",
    });
    expect(assessment.action).toBe("none");
    expect(assessment.utilization).toBeCloseTo(0.749);
  });

  it("pins every MUST line and write_scope path at 75 and 78 percent", () => {
    for (const used of [750, 780]) {
      const assessment = controller.assess({
        usage: usage(used, { output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }),
        contextCeilingTokens: 1000,
        mustChecklist,
        writeScope,
        brief: "Background\nMUST keep the pinned checklist\nMUST retain write scope",
        transcript: "x".repeat(8_000),
      });
      expect(assessment.action).toBe("pinned_compaction");
      if (assessment.action !== "pinned_compaction") continue;
      for (const pin of [...mustChecklist, ...writeScope]) {
        expect(assessment.compactedBrief).toContain(pin);
      }
      expect(assessment.compactedBrief.length).toBeLessThan(8_000);
    }
  });

  it("counts cache and reasoning tokens from usage_update", () => {
    const assessment = controller.assess({
      usage: usage(100, { output: 100, cacheRead: 300, cacheWrite: 200, reasoning: 50 }),
      contextCeilingTokens: 1000,
      mustChecklist,
      writeScope,
      brief: "",
      transcript: "",
    });
    expect(assessment.usedTokens).toBe(750);
    expect(assessment.action).toBe("pinned_compaction");
  });

  it("hands a pinned brief to a fresh-session checkpoint when asked", () => {
    const assessment = controller.assess({
      usage: usage(900),
      contextCeilingTokens: 1000,
      mustChecklist,
      writeScope,
      brief: "MUST keep the pinned checklist",
      transcript: "partial edit",
      preferFreshSession: true,
    });
    expect(assessment.action).toBe("fresh_session_checkpoint");
    if (assessment.action !== "fresh_session_checkpoint") return;
    expect(assessment.labeledWip).toContain("[PRIOR UNVERIFIED WIP DIFF — REVIEW & FINISH]");
    for (const pin of mustChecklist) expect(assessment.compactedBrief).toContain(pin);
    for (const pin of writeScope) expect(assessment.compactedBrief).toContain(pin);
  });
});
