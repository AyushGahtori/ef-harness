import { describe, expect, it } from "vitest";
import { createFixture, type ScriptedTurn } from "./support.js";

describe("nudges, holds, steers, and blocked exits", () => {
  it("reminds once about prose code and then sticks", async () => {
    const fixture = createFixture({
      script: (): ScriptedTurn => ({ text: "```ts\nexport const value = 2;\n```" }),
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.outcome).toBe("stuck");
    expect(result.reason).toBe("prose_only");
    const summaries = fixture.coordinator.turns(fixture.id).map((turn) => turn.resultSummary ?? "");
    expect(summaries.filter((summary) => summary.includes("edit tool"))).toHaveLength(1);
    expect(fixture.model.calls).toHaveLength(2);
  });

  it("prompts once to submit or flag what is missing", async () => {
    const fixture = createFixture({
      script: (): ScriptedTurn => ({ text: "I'm done" }),
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.outcome).toBe("stuck");
    expect(result.reason).toBe("premature_done");
    const summaries = fixture.coordinator.turns(fixture.id).map((turn) => turn.resultSummary ?? "");
    expect(
      summaries.filter((summary) => summary.includes("harness.submit_candidate") && summary.includes("harness.flag_blocked")),
    ).toHaveLength(1);
  });

  it("stops on flag_blocked, keeps the checkpoint, and does not fail the attempt", async () => {
    const fixture = createFixture({
      script(call): ScriptedTurn {
        if (call === 0) {
          return {
            tools: [{ name: "str_replace", arguments: { path: "src/app.ts", content: "export const value = 2;\n" } }],
          };
        }
        return {
          tools: [
            {
              name: "harness.flag_blocked",
              arguments: { reason: "Brief rule R17 contradicts test AC-31" },
            },
          ],
        };
      },
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.outcome).toBe("blocked");
    expect(result.reason).toBe("Brief rule R17 contradicts test AC-31");
    expect(result.routedTo).toBe("AskOwner");
    expect(result.countsAsFailedAttempt).toBe(false);
    expect(result.state).toBe("parked");
    expect(fixture.attempt().outcome).toBe("blocked");
    expect(result.wipRef).toBe(`refs/harness/checkpoints/${fixture.id}/1`);
    expect(fixture.coordinator.checkpoint(fixture.id)?.handoffArtifact).toContain('"llmTokens":0');
  });

  it("yields on a hold and rebuilds from the new brief plus the WIP diff", async () => {
    let edits = 0;
    const fixture = createFixture({
      onTool: (name) => {
        if (name !== "str_replace") return;
        edits += 1;
        if (edits === 8) {
          fixture.attempt().holds.push({ reason: "requirement_change", source: "brief" });
        }
      },
      script: (call): ScriptedTurn => ({
        reasoning: "opaque-reasoning-blob",
        tools: [
          {
            name: "str_replace",
            arguments: { path: "src/app.ts", content: `export const value = ${call};\n` },
          },
        ],
      }),
    });
    const parked = await fixture.loop.runAttempt(fixture.id);
    expect(parked.outcome).toBe("parked");
    expect(parked.reason).toBe("hold:requirement_change");
    expect(parked.step).toBe(8);
    expect(parked.wipRef).toBe(`refs/harness/checkpoints/${fixture.id}/8`);
    expect(fixture.model.calls).toHaveLength(8);
    const attempt = fixture.attempt();
    attempt.holds = [];
    attempt.briefChangedContradiction = true;
    attempt.briefVersion = 9;
    attempt.packet = { ...attempt.packet, goal: "Replacement brief" };
    attempt.maxSteps = 9;
    fixture.model.calls.length = 0;
    const resumed = await fixture.loop.resumeAttemptFromCheckpoint(fixture.id);
    expect(resumed.outcome).toBe("stuck");
    const rebuilt = fixture.model.calls[0];
    expect(rebuilt?.rebuiltFromContradiction).toBe(true);
    expect(rebuilt?.replayItems).toEqual([]);
    expect(rebuilt?.body).toContain("WIP diff from refs/harness/checkpoints/A1/8");
    expect(rebuilt?.body).toContain("Replacement brief");
    expect(rebuilt?.body).not.toContain("opaque-reasoning-blob");
    const stored = fixture.coordinator.items(fixture.coordinator.turns(fixture.id)[0]?.itemsArtifact ?? "");
    expect(stored?.some((item) => item.encryptedContent === "opaque-reasoning-blob")).toBe(true);
  });

  it("pauses at the next boundary and can resume", async () => {
    const fixture = createFixture({
      onTool: (name) => {
        if (name === "read_file") fixture.loop.pauseAtBoundary(fixture.id);
      },
      script(call): ScriptedTurn {
        if (call === 0) return { tools: [{ name: "read_file", arguments: { path: "src/app.ts" } }] };
        return { tools: [{ name: "harness.submit_candidate", arguments: {} }] };
      },
    });
    const paused = await fixture.loop.runAttempt(fixture.id);
    expect(paused.outcome).toBe("parked");
    expect(paused.reason).toBe("user_pause");
    expect(fixture.model.calls).toHaveLength(1);
    const resumed = await fixture.loop.resumeAttemptFromCheckpoint(fixture.id);
    expect(resumed.outcome).toBe("submitted");
  });

  it("requires acknowledgment before the next edit after an additive steer", async () => {
    const fixture = createFixture({
      maxSteps: 2,
      script(call): ScriptedTurn {
        if (call === 0) {
          return {
            text: "editing now",
            tools: [{ name: "str_replace", arguments: { path: "src/app.ts", content: "export const value = 9;\n" } }],
          };
        }
        return {
          text: "acknowledged",
          tools: [{ name: "str_replace", arguments: { path: "src/app.ts", content: "export const value = 4;\n" } }],
        };
      },
    });
    fixture.loop.deliverSteer(fixture.id, {
      id: "steer-1",
      kind: "additive",
      compatible: true,
      text: "Also rename the export.",
    });
    await fixture.loop.runAttempt(fixture.id);
    expect(fixture.coordinator.turns(fixture.id)[0]?.resultSummary).toContain("steer_ack_required");
    expect(fixture.files.read("src/app.ts")).toContain("value = 4");
    expect(fixture.model.calls[0]?.body).toContain("Steer steer-1");
  });

  it("checkpoints and yields on a hard steer before any model call", async () => {
    const fixture = createFixture({
      script: () => {
        throw new Error("model should not be called");
      },
    });
    fixture.loop.deliverSteer(fixture.id, {
      id: "steer-hard",
      kind: "hard",
      compatible: false,
      text: "Stop.",
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.outcome).toBe("parked");
    expect(result.reason).toBe("hard_steer");
    expect(fixture.model.calls).toHaveLength(0);
    expect(result.handoffArtifact).toContain('"generatedBy":"code"');
  });

  it("fences between tool calls when the epoch changes", async () => {
    const fixture = createFixture({
      onTool: (name) => {
        if (name === "read_file") fixture.attempt().liveEpoch = 99;
      },
      script: (): ScriptedTurn => ({
        tools: [
          { name: "read_file", arguments: { path: "src/app.ts" } },
          { name: "str_replace", arguments: { path: "src/app.ts", content: "export const value = 5;\n" } },
          { name: "harness.run", arguments: { command: "npm test" } },
        ],
      }),
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.outcome).toBe("fenced");
    expect(result.state).toBe("fenced");
    expect(fixture.files.read("src/app.ts")).toBe("export const value = 1;\n");
    expect(fixture.events.filter((event) => event === "run")).toHaveLength(0);
    expect(fixture.coordinator.turns(fixture.id)).toHaveLength(1);
  });

  it("stops immediately during a model call and releases the reservation", async () => {
    const fixture = createFixture({
      onStreamStart: () => {
        fixture.loop.stopImmediately(fixture.id);
      },
      script: () => ({ text: "should not land" }),
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.outcome).toBe("parked");
    expect(result.reason).toBe("stop");
    expect(fixture.budget.spent).toBe(0);
    expect(fixture.coordinator.turns(fixture.id)).toHaveLength(0);
  });

  it("parks when pinned zones do not fit the model window", async () => {
    const fixture = createFixture({
      contextWindow: 8,
      must: ["x".repeat(400)],
      script: () => {
        throw new Error("model should not be called");
      },
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.outcome).toBe("parked");
    expect(result.reason).toBe("task_too_large_for_model");
    expect(fixture.model.calls).toHaveLength(0);
  });

  it("checkpoints an edit recovery escalation", async () => {
    const fixture = createFixture({
      script: () => ({ tools: [{ name: "str_replace", arguments: { path: "stuck", content: "nope" } }] }),
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.outcome).toBe("stuck");
    expect(result.reason).toBe("edit_recovery");
    expect(fixture.coordinator.checkpoint(fixture.id)?.handoffArtifact).toContain('"llmTokens":0');
  });

  it("waits for the owner on ask_owner", async () => {
    const fixture = createFixture({
      script: () => ({
        tools: [{ name: "harness.ask_owner", arguments: { question: "Which name?" } }],
      }),
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.outcome).toBe("waiting_input");
    expect(result.countsAsFailedAttempt).toBe(false);
  });
});
