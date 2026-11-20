import { assert, integer, property } from "fast-check";
import { describe, expect, it } from "vitest";
import {
  WorkerContextBuilder,
  renderMustBand,
  toolPairViolations,
  type HistoryStep,
} from "../../src/context/index.js";
import { memory, packet, profile } from "./fixture.js";

describe("atomic tool-pair compaction", () => {
  it("keeps tool_use paired with tool_result across 200 fast-check histories", () => {
    const brief = packet();
    const mustText = renderMustBand(brief);
    const builder = new WorkerContextBuilder();
    assert(
      property(
        integer({ min: 0, max: 18 }),
        integer({ min: 0, max: 500 }),
        integer({ min: 0, max: 9_999 }),
        (stepCount, bodySize, salt) => {
          const history: HistoryStep[] = Array.from({ length: stepCount }, (_, index) => {
            const step = index + 1;
            const toolCount = step % 4;
            return {
              step,
              assistantText: `assistant ${step} ${salt}`,
              reasoning: [
                { kind: "reasoning" as const, opaque: `OPAQUE:${step}:0:${salt}` },
                { kind: "reasoning" as const, opaque: `OPAQUE:${step}:1:${salt}` },
              ],
              toolCalls: Array.from({ length: toolCount }, (_, toolIndex) => ({
                id: `tool-${step}-${toolIndex}`,
                name: toolIndex % 2 === 0 ? "read_file" : "str_replace",
                input: { path: `src/f${toolIndex}.ts` },
                resultSummary: `summary ${step}-${toolIndex} ART-${step}-${toolIndex}`,
                content: `${"y".repeat(bodySize)} body ${step}-${toolIndex}`,
                artifactIds: [`ART-${step}-${toolIndex}`],
              })),
            };
          });
          const result = builder.buildRequest({
            packet: brief,
            modelProfile: profile(24_000),
            workingMemory: memory({ learnedFacts: ["fact stays"] }),
            history,
            step: Math.max(1, stepCount + 1),
            turnSummarizer: () => ({ progress_note: "progress stays keyed to SI-212" }),
          });
          expect(result.status).not.toBe("task_too_large_for_model");
          if (result.status === "task_too_large_for_model") return;
          expect(toolPairViolations(result.messages)).toEqual([]);
          expect(result.zones[1].text).toBe(mustText);
          expect(result.zones[3].text).toContain("fact stays");
          const verbatim = new Set(result.verbatimStepNumbers);
          for (const message of result.messages) {
            if (message.role !== "assistant") continue;
            if (verbatim.has(message.step)) {
              const first = message.content.indexOf(`OPAQUE:${message.step}:0:${salt}`);
              const second = message.content.indexOf(`OPAQUE:${message.step}:1:${salt}`);
              expect(first).toBeGreaterThanOrEqual(0);
              expect(second).toBeGreaterThan(first);
              expect(message.reasoning.map((item) => item.opaque)).toEqual([
                `OPAQUE:${message.step}:0:${salt}`,
                `OPAQUE:${message.step}:1:${salt}`,
              ]);
            } else {
              expect(message.reasoning).toEqual([]);
              expect(message.content).not.toContain(`OPAQUE:${message.step}:`);
            }
          }
          for (const step of history) {
            if (verbatim.has(step.step)) continue;
            expect(result.text).not.toContain(`OPAQUE:${step.step}:0:${salt}`);
          }
        },
      ),
      { numRuns: 200, seed: 54 },
    );
  });
});
