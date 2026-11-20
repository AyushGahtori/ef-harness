import { describe, expect, it } from "vitest";
import { WorkerContextBuilder, resolveContextCaps } from "../../src/context/index.js";
import { historyStep, lines, memory, packet, profile } from "./fixture.js";

const builder = new WorkerContextBuilder();

describe("small model context caps", () => {
  it("enforces K = 4, 200-line reads, and 10 test failures at 16k and 32k", () => {
    for (const window of [16_384, 32_768]) {
      const caps = resolveContextCaps(profile(window));
      expect(caps.smallModel).toBe(true);
      expect(caps.verbatimSteps).toBe(4);
      expect(caps.maxReadLines).toBe(200);
      expect(caps.maxTestFailures).toBe(10);
      expect(caps.windowedSymbolOutline).toBe(true);
    }
    expect(resolveContextCaps(profile(32_769)).verbatimSteps).not.toBe(4);
    expect(resolveContextCaps(profile(32_769)).maxReadLines).toBe(400);
    expect(resolveContextCaps(profile(32_769)).maxTestFailures).toBe(25);

    const failures = Array.from({ length: 15 }, (_, index) => `FAILURE_${index + 1}`);
    const result = builder.buildRequest({
      packet: packet(),
      modelProfile: profile(16_384),
      workingMemory: memory(),
      history: [
        ...Array.from({ length: 6 }, (_, index) =>
          historyStep(index + 1, {
            assistantText: `old ${index + 1}`,
            reasoning: [`OLD_OPAQUE_${index + 1}`],
            tools: [{ name: "grep", content: `old-body-${index + 1}`, resultSummary: `summary-${index + 1}` }],
          }),
        ),
        historyStep(7, {
          reasoning: ["RECENT_OPAQUE"],
          tools: [
            {
              name: "read_file",
              path: "src/kitchen/print.tsx",
              content: lines(250, "LINE"),
              symbolOutline: "function PrintPage line 12",
              resultSummary: "read print.tsx",
            },
          ],
        }),
        historyStep(8, {
          tools: [
            {
              name: "harness.run",
              content: failures.join("\n"),
              testFailures: failures,
              resultSummary: "test: 0 passed, 15 failed",
            },
          ],
        }),
      ],
      step: 9,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.verbatimStepNumbers).toEqual([5, 6, 7, 8]);
    expect(result.text).not.toContain("OLD_OPAQUE_1");
    expect(result.text).toContain("RECENT_OPAQUE");
    expect(result.text).toContain("function PrintPage line 12");
    expect(result.text).toContain("File has 250 lines");
    expect(result.text).not.toContain("LINE-249");
    expect(result.text).toContain("FAILURE_1");
    expect(result.text).toContain("FAILURE_10");
    expect(result.text).not.toContain("FAILURE_15");
    expect(result.text).toContain("omitted 5 test failures");

    const wide = builder.buildRequest({
      packet: packet(),
      modelProfile: profile(131_072),
      workingMemory: memory(),
      history: [
        historyStep(1, {
          tools: [
            {
              name: "read_file",
              path: "src/wide.ts",
              content: lines(450, "WIDE"),
              symbolOutline: "outline should not replace the window",
              resultSummary: "read wide",
            },
          ],
        }),
        historyStep(2, {
          tools: [
            {
              name: "harness.run",
              content: failures.join("\n"),
              testFailures: failures,
              resultSummary: "test failures",
            },
          ],
        }),
      ],
      step: 3,
    });
    expect(wide.status).toBe("ok");
    if (wide.status !== "ok") return;
    expect(wide.verbatimStepNumbers).toEqual([1, 2]);
    expect(wide.text).toContain("WIDE-0");
    expect(wide.text).toContain("WIDE-399");
    expect(wide.text).not.toContain("WIDE-449");
    expect(wide.text).toContain("File has 450 lines");
    expect(wide.text).toContain("FAILURE_15");
  });
});
