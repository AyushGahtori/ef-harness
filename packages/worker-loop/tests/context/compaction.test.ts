import { describe, expect, it } from "vitest";
import {
  WorkerContextBuilder,
  compactionTargetTokens,
  renderMustBand,
  renderWorkingMemoryZone,
  toolPairViolations,
  type HistoryStep,
} from "../../src/context/index.js";
import { historyStep, memory, packet, profile } from "./fixture.js";

const builder = new WorkerContextBuilder();

function toolMessage(result: { status: string; text?: string; zones?: { text: string }[] }, toolId: string) {
  if (result.status !== "ok" && result.status !== "park_after_context_overflow") return undefined;
  const zones = "zones" in result ? result.zones : undefined;
  const text = zones?.map((zone) => zone.text).join("\n") ?? "";
  return text.includes(toolId) ? text : text;
}

describe("compaction pipeline", () => {
  it("uses a 70 percent target and tightens that target by 15 percent once", () => {
    expect(compactionTargetTokens(10_000, false)).toBe(7_000);
    expect(compactionTargetTokens(10_000, true)).toBe(5_950);
    const fit = builder.buildRequest({
      packet: packet(),
      modelProfile: profile(128_000),
      workingMemory: memory(),
      history: [],
      step: 1,
      contextOverflow: true,
    });
    expect(fit.status).toBe("ok");
    if (fit.status !== "ok") return;
    expect(fit.tightened).toBe(true);
    expect(fit.recoveryAttempts).toBe(1);
    expect(fit.targetTokens).toBe(compactionTargetTokens(128_000, true));
    expect(fit.exceedsTarget).toBe(false);
  });

  it("marks both earlier reads superseded after a later edit and stops trimming once the request fits", () => {
    const body = "export const rows = []; ".repeat(800);
    const result = builder.buildRequest({
      packet: packet({ should: ["KEEP_SHOULD convention"] }),
      modelProfile: profile(9_000),
      workingMemory: memory(),
      history: [
        historyStep(2, {
          tools: [
            {
              name: "read_file",
              path: "src/a.ts",
              content: `STEP2-${body}`,
              resultSummary: "read src/a.ts",
              artifactIds: ["ART-2"],
            },
          ],
        }),
        historyStep(5, {
          tools: [
            {
              name: "read_file",
              path: "src/a.ts",
              content: `STEP5-${body}`,
              resultSummary: "read src/a.ts again",
              artifactIds: ["ART-5"],
            },
            {
              name: "read_file",
              path: "src/other.ts",
              content: "KEEP_OTHER_FILE",
              resultSummary: "read src/other.ts",
            },
          ],
        }),
        historyStep(6, {
          assistantText: "edit the rows helper",
          tools: [
            {
              name: "str_replace",
              path: "src/a.ts",
              content: "applied hunk",
              resultSummary: "edited src/a.ts",
            },
          ],
        }),
      ],
      step: 7,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.stagesApplied[0]).toBe("trim_should_and_superseded_reads");
    expect(result.text).toContain("[read of src/a.ts @ step 2, superseded]");
    expect(result.text).toContain("[read of src/a.ts @ step 5, superseded]");
    expect(result.text).not.toContain("STEP2-");
    expect(result.text).not.toContain("STEP5-");
    expect(result.text).toContain("KEEP_OTHER_FILE");
    expect(result.text).toContain("applied hunk");
    expect(result.text).toContain("KEEP_SHOULD convention");
    expect(result.zones[1].text).toBe(renderMustBand(packet({ should: ["KEEP_SHOULD convention"] })));
    const read = result.messages.find((message) => message.role === "tool" && message.toolUseId === "tool-2-0");
    expect(read?.role).toBe("tool");
    if (read?.role === "tool") expect(read.artifactIds).toEqual(["ART-2"]);
    expect(toolPairViolations(result.messages)).toEqual([]);
  });

  it("runs superseded-read trimming, old-result collapse, and summarizer fallback in order", () => {
    const calls: unknown[] = [];
    const history: HistoryStep[] = [
      ...Array.from({ length: 12 }, (_, index) =>
        historyStep(index + 1, {
          assistantText: `turn ${index + 1}`,
          reasoning: [`REASON-${index + 1}-END`],
          tools: [
            {
              name: "read_file",
              path: `src/file-${index + 1}.ts`,
              content: `${"HUGE_TOOL_BODY ".repeat(400)}${index + 1}`,
              resultSummary: `${"S".repeat(1_800)} read src/file-${index + 1}.ts [ART-${index + 1}]`,
              artifactIds: [`ART-${index + 1}`],
            },
          ],
        }),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        historyStep(index + 13, {
          assistantText: `recent ${index + 13}`,
          reasoning: [`REASON-${index + 13}-END`],
          tools: [
            {
              name: "read_file",
              path: `src/file-${index + 13}.ts`,
              content: `FILE_${index + 13}`,
              resultSummary: `read src/file-${index + 13}.ts [ART-${index + 13}]`,
              artifactIds: [`ART-${index + 13}`],
            },
          ],
        }),
      ),
    ];
    const result = builder.buildRequest({
      packet: packet({
        should: ["SHOULD_DROP_ME convention", "SHOULD_ALSO_DROP research warning"],
      }),
      modelProfile: profile(8_000),
      workingMemory: memory({ learnedFacts: ["toPrintRows returns rows sorted by label"] }),
      history,
      step: 9,
      turnSummarizer: (input) => {
        calls.push(input);
        return { progress_note: 12 };
      },
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.stagesApplied).toEqual([
      "trim_should_and_superseded_reads",
      "collapse_old_tool_results",
      "summarize_old_turns",
    ]);
    expect(result.summarizerOutcome).toBe("fallback_one_line");
    expect(calls.length).toBe(1);
    expect(result.text).not.toContain("SHOULD_DROP_ME");
    expect(result.text).not.toContain("HUGE_TOOL_BODY");
    expect(result.text).toContain("read src/file-1.ts [ART-1]");
    expect(result.text).toContain("FILE_16");
    expect(result.text).toContain("REASON-16-END");
    expect(result.text).not.toContain("REASON-1-END");
    expect(result.zones[3].text).toBe(
      renderWorkingMemoryZone(memory({ learnedFacts: ["toPrintRows returns rows sorted by label"] })),
    );
    expect(result.zones[1].text).toContain("SI-212");
    expect(toolPairViolations(result.messages)).toEqual([]);
    const recent = result.messages.filter((message) => message.role === "assistant");
    const last = recent.at(-1);
    expect(last?.role).toBe("assistant");
    if (last?.role === "assistant") {
      expect(last.reasoning.map((item) => item.opaque)).toEqual(["REASON-16-END"]);
      expect(last.toolUses).toHaveLength(1);
    }
  });

  it("accepts a valid turn-summarizer note and reuses current working memory with no extra note", () => {
    const huge = "OLD_BODY ".repeat(1_800);
    const history = Array.from({ length: 8 }, (_, index) =>
      historyStep(index + 1, {
        assistantText: `turn ${index + 1}`,
        tools: [
          {
            name: "grep",
            content: `${huge} ONLY_${index + 1}`,
            resultSummary: `OLD_SUMMARY_${index + 1}`,
            artifactIds: [`ART-${index + 1}`],
          },
        ],
      }),
    );
    let calls = 0;
    const summarized = builder.buildRequest({
      packet: packet({ should: ["drop me"] }),
      modelProfile: profile(8_000),
      workingMemory: memory(),
      history,
      step: 9,
      turnSummarizer: () => {
        calls += 1;
        return { schema: "turn-summarizer@1", progress_note: "Tried src/a.ts; AC-31 still fails." };
      },
    });
    expect(summarized.status).toBe("ok");
    if (summarized.status !== "ok") return;
    expect(summarized.summarizerOutcome).toBe("progress_note");
    expect(calls).toBe(1);
    expect(summarized.text).toContain("Tried src/a.ts; AC-31 still fails.");
    expect(summarized.text).not.toContain("OLD_SUMMARY_1");
    expect(summarized.text).toContain("ONLY_8");
    expect(toolPairViolations(summarized.messages)).toEqual([]);

    const reused = builder.buildRequest({
      packet: packet({ should: ["drop me"] }),
      modelProfile: profile(8_000),
      workingMemory: memory({ learnedFacts: ["working memory is current"] }),
      workingMemoryCoversThroughStep: 4,
      history,
      step: 9,
      turnSummarizer: () => {
        throw new Error("summarizer must not run when working memory is current");
      },
    });
    expect(reused.status).toBe("ok");
    if (reused.status !== "ok") return;
    expect(reused.summarizerOutcome).toBe("working_memory");
    expect(reused.text).not.toContain('source="progress_note"');
    expect(reused.text).not.toContain("OLD_SUMMARY_1");
    expect(reused.text).toContain("working memory is current");
    expect(reused.text).toContain("ONLY_8");
  });

  it("falls back when the summarizer throws or exceeds its token cap, and keeps tool pairs", () => {
    const history = [
      historyStep(1, {
        tools: [
          { id: "read", name: "read_file", path: "src/a.ts", content: "A".repeat(12_000), resultSummary: "read a" },
          { id: "edit", name: "str_replace", path: "src/a.ts", content: "B".repeat(12_000), resultSummary: "edit a" },
          { id: "run", name: "harness.run", content: "C".repeat(12_000), resultSummary: "test: 1 failed [ART-42]", artifactIds: ["ART-42"] },
        ],
      }),
      ...Array.from({ length: 6 }, (_, index) =>
        historyStep(index + 2, {
          tools: [{ name: "grep", content: "D".repeat(8_000), resultSummary: `grep ${index + 2}` }],
        }),
      ),
    ];
    const thrown = builder.buildRequest({
      packet: packet({ should: ["x".repeat(4_000)] }),
      modelProfile: profile(8_000),
      workingMemory: memory(),
      history,
      step: 8,
      turnSummarizer: () => {
        throw new Error("offline summarizer failed");
      },
    });
    const oversized = builder.buildRequest({
      packet: packet({ should: ["x".repeat(4_000)] }),
      modelProfile: profile(8_000),
      workingMemory: memory(),
      history,
      step: 8,
      turnSummarizer: () => ({ progress_note: "Z".repeat(8_000) }),
    });
    for (const result of [thrown, oversized]) {
      expect(result.status).toBe("ok");
      if (result.status !== "ok") continue;
      expect(result.summarizerOutcome).toBe("fallback_one_line");
      expect(result.text).toContain("test: 1 failed [ART-42]");
      expect(result.text).not.toContain("C".repeat(100));
      expect(toolPairViolations(result.messages)).toEqual([]);
    }
  });

  it("refuses instead of slicing MUST when the pinned band does not fit the window", () => {
    const mustText = `${"M".repeat(80_000)} UNIQUE_MUST_TAIL`;
    const full = packet({ mustText });
    const result = builder.buildRequest({
      packet: full,
      modelProfile: profile(16_384, { family: "local", maxOutputTokens: 256 }),
      workingMemory: memory(),
      history: [],
      step: 1,
    });
    expect(result.status).toBe("task_too_large_for_model");
    if (result.status !== "task_too_large_for_model") return;
    expect(result.mustTokens).toBeGreaterThan(result.windowTokens);
    expect(result.windowTokens).toBe(16_384);
    expect(result.stagesApplied).toEqual(["hard_refusal"]);
    expect("text" in result).toBe(false);
    expect(renderMustBand(full)).toContain("UNIQUE_MUST_TAIL");
    expect(renderMustBand(full).length).toBeGreaterThan(80_000);
  });

  it("parks after one tightened compaction when the provider still reports context overflow", () => {
    const history = Array.from({ length: 4 }, (_, index) =>
      historyStep(index + 1, {
        tools: [{ name: "read_file", path: `src/${index}.ts`, content: "Q".repeat(6_000), resultSummary: `read ${index}` }],
      }),
    );
    const first = builder.buildRequest({
      packet: packet({ should: [] }),
      modelProfile: profile(4_000),
      workingMemory: memory(),
      history,
      step: 5,
    });
    const second = builder.buildRequest({
      packet: packet({ should: [] }),
      modelProfile: profile(4_000),
      workingMemory: memory(),
      history,
      step: 5,
      contextOverflow: true,
    });
    expect(first.status === "ok" || first.status === "park_after_context_overflow").toBe(true);
    expect(second.status).toBe("park_after_context_overflow");
    if (second.status !== "park_after_context_overflow") return;
    expect(second.recoveryAttempts).toBe(1);
    expect(second.tightened).toBe(true);
    expect(second.targetTokens).toBe(compactionTargetTokens(4_000, true));
    expect(second.estimatedTokens).toBeGreaterThan(second.targetTokens);
    expect(second.zones[1]?.text).toContain("SI-212");
    expect(toolMessage(second, "read")).toContain("SI-212");
  });
});
