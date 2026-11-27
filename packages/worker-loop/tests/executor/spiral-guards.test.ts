import { describe, expect, it } from "vitest";
import { LocalTurnFailure } from "../../src/executor/types.js";
import { assertReserveBeforeStream, createFixture, type ScriptedTurn } from "./support.js";

describe("spiral and stall guards", () => {
  it("parks a junior attempt at 40 steps and a senior attempt at 80", async () => {
    const junior = createFixture({
      level: "junior",
      script: (call) => ({ tools: [{ name: "read_file", arguments: { path: `src/f-${call}.ts` } }] }),
    });
    const juniorResult = await junior.loop.runAttempt(junior.id);
    expect(juniorResult.outcome).toBe("stuck");
    expect(juniorResult.reason).toBe("max_steps");
    expect(juniorResult.state).toBe("parked");
    expect(junior.coordinator.turns(junior.id)).toHaveLength(40);
    expect(junior.model.calls).toHaveLength(40);

    const senior = createFixture({
      level: "senior",
      script: (call) => ({ tools: [{ name: "read_file", arguments: { path: `src/f-${call}.ts` } }] }),
    });
    const seniorResult = await senior.loop.runAttempt(senior.id);
    expect(seniorResult.reason).toBe("max_steps");
    expect(senior.coordinator.turns(senior.id)).toHaveLength(80);
    expect(senior.model.calls).toHaveLength(80);
  });

  it("honors a configured step cap", async () => {
    const fixture = createFixture({
      maxSteps: 4,
      script: (call) => ({ tools: [{ name: "read_file", arguments: { path: `src/f-${call}.ts` } }] }),
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.reason).toBe("max_steps");
    expect(fixture.coordinator.turns(fixture.id)).toHaveLength(4);
  });

  it("sticks on the third identical tool, arguments, and result", async () => {
    const fixture = createFixture({
      script: (call) => ({
        tools: [
          {
            name: "read_file",
            arguments:
              call === 2
                ? { note: "a", path: "src/app.ts" }
                : { path: "src/app.ts", note: "a" },
          },
        ],
      }),
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.outcome).toBe("stuck");
    expect(result.reason).toBe("repeat_tool");
    expect(fixture.coordinator.turns(fixture.id)).toHaveLength(3);
  });

  it("sticks after 8 steps with the same tree and failing fingerprint", async () => {
    const fixture = createFixture({
      script: (call): ScriptedTurn => ({
        tools: [
          {
            name: "harness.run",
            arguments: { command: `npm test ${call} fingerprint=ac-31 fail=AC-31` },
          },
        ],
      }),
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.outcome).toBe("stuck");
    expect(result.reason).toBe("no_progress");
    expect(fixture.coordinator.turns(fixture.id)).toHaveLength(8);
    expect(fixture.files.read("src/app.ts")).toBe("export const value = 1;\n");
  });

  it("resets the no-progress streak when the tree changes", async () => {
    const fixture = createFixture({
      script: (call): ScriptedTurn => {
        if (call < 7) {
          return {
            tools: [
              {
                name: "harness.run",
                arguments: { command: `npm test ${call} fingerprint=ac-31 fail=AC-31` },
              },
            ],
          };
        }
        if (call === 7) {
          return {
            tools: [{ name: "str_replace", arguments: { path: "src/app.ts", content: "export const value = 3;\n" } }],
          };
        }
        return { tools: [{ name: "harness.submit_candidate", arguments: {} }] };
      },
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.outcome).toBe("submitted");
  });

  it("retries one stream stall and parks on the second without spending a step", async () => {
    const fixture = createFixture({
      script: () => ({
        error: new LocalTurnFailure("stream_stall", "No tokens for 60s", {
          partialUsage: { inputTokens: 0, outputTokens: 0 },
        }),
      }),
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.outcome).toBe("parked");
    expect(result.reason).toBe("stream_stall");
    expect(fixture.model.calls).toHaveLength(2);
    expect(fixture.model.calls[0]).toEqual(fixture.model.calls[1]);
    expect(fixture.model.lastOptions?.stallTimeoutMs).toBe(60_000);
    expect(fixture.coordinator.turns(fixture.id)).toHaveLength(0);
    expect(fixture.attempt().failureCalibrationIncrements).toBe(0);
  });

  it("treats a 429 as pacing and not as a step, stuck count, or worker failure", async () => {
    const fixture = createFixture({
      script: (call): ScriptedTurn => {
        if (call === 2) {
          return {
            error: new LocalTurnFailure("rate_limit", "slow down", {
              retryAfterMs: 1500,
              isProviderSchedulingError: true,
            }),
          };
        }
        return { tools: [{ name: "read_file", arguments: { path: "src/app.ts", note: "a" } }] };
      },
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.reason).toBe("repeat_tool");
    expect(fixture.coordinator.turns(fixture.id)).toHaveLength(3);
    expect(fixture.waits).toEqual([1500]);
    expect(fixture.attempt().failureCalibrationIncrements).toBe(0);
    expect(fixture.model.calls).toHaveLength(4);
  });

  it("checkpoints and parks on a usage limit without failing the attempt", async () => {
    const fixture = createFixture({
      script: () => ({
        error: new LocalTurnFailure("usage_limit", "plan window closed", {
          isProviderSchedulingError: true,
        }),
      }),
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.outcome).toBe("parked");
    expect(result.reason).toBe("usage_limit");
    expect(result.countsAsFailedAttempt).toBe(false);
    expect(result.countsAsWorkerFailure).toBe(false);
    expect(fixture.coordinator.turns(fixture.id)).toHaveLength(0);
    expect(result.handoffArtifact).toContain('"llmTokens":0');
  });

  it("rejects one malformed tool with the allowed list, then sticks", async () => {
    const tools = ["read_file", "str_replace", "harness.run", "harness.submit_candidate"];
    const fixture = createFixture({
      tools,
      script: (call): ScriptedTurn => ({
        tools: [
          {
            name: call === 0 ? "bash" : "web_search",
            arguments: {},
          },
        ],
      }),
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.outcome).toBe("stuck");
    expect(result.reason).toBe("malformed_tool");
    const turns = fixture.coordinator.turns(fixture.id);
    expect(turns[0]?.resultSummary).toContain(
      "Available tools: harness.run, harness.submit_candidate, read_file, str_replace.",
    );
    expect(turns[0]?.resultSummary).not.toContain("bash,");
    expect(turns[0]?.resultSummary).not.toContain("web_search");
    expect(turns[1]?.resultSummary).not.toContain("Available tools:");
    expect(fixture.attempt().failureCalibrationIncrements).toBe(0);
  });

  it("parks with the step-12 checkpoint when the budget is gone before submit", async () => {
    const fixture = createFixture({
      maxReserves: 12,
      script: (call) => ({
        tools: [
          {
            name: "str_replace",
            arguments: { path: "src/app.ts", content: `export const value = ${call};\n` },
          },
        ],
      }),
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.outcome).toBe("budget_exhausted");
    expect(result.state).toBe("parked");
    expect(result.countsAsFailedAttempt).toBe(false);
    expect(result.step).toBe(12);
    expect(result.wipRef).toBe(`refs/harness/checkpoints/${fixture.id}/12`);
    expect(fixture.files.read("src/app.ts")).toBe("export const value = 11;\n");
    expect(fixture.budget.spent).toBe(180);
    expect(fixture.model.calls).toHaveLength(12);
    expect(fixture.events.at(-1)).toBe("reserve-fail");
    expect(JSON.parse(result.handoffArtifact).llmTokens).toBe(0);
    assertReserveBeforeStream(fixture.events);
  });

  it("sticks on no_progress when alternating read_file and failing checks without tree edits", async () => {
    const fixture = createFixture({
      script: (call): ScriptedTurn => {
        if (call % 2 === 0) {
          return {
            tools: [
              {
                name: "harness.run",
                arguments: { command: `npm test ${call} fingerprint=ac-31 fail=AC-31` },
              },
            ],
          };
        }
        return {
          tools: [{ name: "read_file", arguments: { path: `src/f-${call}.ts` } }],
        };
      },
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.outcome).toBe("stuck");
    expect(result.reason).toBe("no_progress");
    expect(result.countsAsFailedAttempt).toBe(true);
    expect(result.countsAsWorkerFailure).toBe(true);
    expect(fixture.coordinator.turns(fixture.id)).toHaveLength(8);
  });

  it("resets the no-progress streak when a check run passes", async () => {
    const fixture = createFixture({
      script: (call): ScriptedTurn => {
        if (call < 6) {
          return {
            tools: [
              {
                name: "harness.run",
                arguments: { command: `npm test ${call} fingerprint=ac-31 fail=AC-31` },
              },
            ],
          };
        }
        if (call === 6) {
          return { tools: [{ name: "harness.run", arguments: { command: "npm test pass" } }] };
        }
        if (call < 10) {
          return {
            tools: [
              {
                name: "harness.run",
                arguments: { command: `npm test ${call} fingerprint=ac-31 fail=AC-31` },
              },
            ],
          };
        }
        return { tools: [{ name: "harness.submit_candidate", arguments: {} }] };
      },
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.outcome).toBe("submitted");
    expect(result.countsAsFailedAttempt).toBe(false);
  });

  it("clears pendingEffects when rejecting a malformed tool in a multi-tool response", async () => {
    const executed: string[] = [];
    const fixture = createFixture({
      tools: ["read_file", "harness.submit_candidate"],
      onTool: (name) => executed.push(name),
      script: (call): ScriptedTurn => {
        if (call === 0) {
          return {
            tools: [
              { name: "bash", arguments: { cmd: "ls" } },
              { name: "read_file", arguments: { path: "src/app.ts" } },
            ],
          };
        }
        if (call === 1) {
          return { tools: [{ name: "read_file", arguments: { path: "src/app.ts" } }] };
        }
        return { tools: [{ name: "harness.submit_candidate", arguments: {} }] };
      },
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.outcome).toBe("submitted");
    expect(executed).toEqual(["read_file"]);
    expect(fixture.model.calls).toHaveLength(3);
    const turns = fixture.coordinator.turns(fixture.id);
    expect(turns[0]?.resultSummary).toContain("Available tools:");
    expect(fixture.coordinator.checkpoint(fixture.id)?.pendingEffects).toEqual([]);
  });

  it("recovers across edit errors 1-3 via tool results and escalates to stuck on failure 4", async () => {
    const recovered = createFixture({
      tools: ["read_file", "str_replace", "harness.submit_candidate"],
      files: { "src/recover.ts": "export const value = 1;\n" },
      script: (call): ScriptedTurn => {
        if (call < 3) {
          return {
            tools: [
              {
                name: "str_replace",
                arguments: { path: "src/recover.ts", oldText: "miss", newText: "x" },
              },
            ],
          };
        }
        if (call === 3) {
          return {
            tools: [
              {
                name: "replace_lines",
                arguments: { path: "src/recover.ts", start: 1, end: 1, content: "export const value = 2;\n", rangeHash: "abc123" },
              },
            ],
          };
        }
        return { tools: [{ name: "harness.submit_candidate", arguments: {} }] };
      },
    });
    const okResult = await recovered.loop.runAttempt(recovered.id);
    expect(okResult.outcome).toBe("submitted");
    const recoverTurns = recovered.coordinator.turns(recovered.id);
    expect(recoverTurns[0]?.resultSummary).toBe("error: NearestCandidateError");
    expect(recoverTurns[1]?.resultSummary).toBe("error: FreshRegionViewError");
    expect(recoverTurns[2]?.resultSummary).toBe("error: ReplaceLinesUnlockedError");
    expect(recovered.files.read("src/recover.ts")).toBe("export const value = 2;\n/*formatted*/\n");
    expect(recovered.formatted).toEqual([["src/recover.ts"]]);

    const escalated = createFixture({
      files: { "src/recover.ts": "export const value = 1;\n" },
      script: (): ScriptedTurn => ({
        tools: [
          {
            name: "str_replace",
            arguments: { path: "src/recover.ts", oldText: "miss", newText: "x" },
          },
        ],
      }),
    });
    const stuckResult = await escalated.loop.runAttempt(escalated.id);
    expect(stuckResult.outcome).toBe("stuck");
    expect(stuckResult.reason).toBe("edit_recovery");
    expect(stuckResult.countsAsFailedAttempt).toBe(true);
    expect(stuckResult.countsAsWorkerFailure).toBe(true);
    expect(escalated.coordinator.turns(escalated.id)).toHaveLength(4);
  });
});
