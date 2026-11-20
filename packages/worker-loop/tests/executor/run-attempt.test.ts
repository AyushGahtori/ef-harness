import { describe, expect, it } from "vitest";
import { generateHandoffNote } from "../../src/executor/handoff-note.js";
import { reconstructProviderItems } from "../../src/executor/memory-coordinator.js";
import { NATIVE_TOOL_CATALOG, SUBAGENT_TOOL_NAMES } from "../../src/executor/types.js";
import { assertReserveBeforeStream, createFixture, type ScriptedTurn } from "./support.js";

describe("native worker loop runAttempt", () => {
  it("completes read, edit, run, and submit with checkpoints and a code handoff", async () => {
    const fixture = createFixture({
      script(call): ScriptedTurn {
        if (call === 0) {
          return {
            reasoning: "opaque-reasoning-blob",
            tools: [{ name: "read_file", arguments: { path: "src/app.ts" } }],
          };
        }
        if (call === 1) {
          return {
            tools: [
              {
                name: "edit",
                arguments: { path: "src/app.ts", content: "export const value = 2;\n" },
              },
            ],
          };
        }
        if (call === 2) {
          return { tools: [{ name: "harness.run", arguments: { command: "npm test" } }] };
        }
        if (call === 3) {
          return { tools: [{ name: "harness.submit_candidate", arguments: {} }] };
        }
        throw new Error(`unexpected model call ${call}`);
      },
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    expect(result.outcome).toBe("submitted");
    expect(result.state).toBe("submitted");
    expect(result.countsAsFailedAttempt).toBe(false);
    expect(result.step).toBe(4);
    expect(result.wipRef).toBe(`refs/harness/checkpoints/${fixture.id}/4`);
    expect(fixture.files.read("src/app.ts")).toBe("export const value = 2;\n/*formatted*/\n");
    expect(fixture.formatted).toEqual([["src/app.ts"]]);
    const formatAt = fixture.events.indexOf("format");
    expect(formatAt).toBeGreaterThan(fixture.events.lastIndexOf("edit"));
    expect(fixture.events.indexOf("submit")).toBeGreaterThan(formatAt);
    expect(fixture.events.filter((event) => event === "format")).toHaveLength(1);
    const turns = fixture.coordinator.turns(fixture.id);
    expect(turns.map((turn) => turn.step)).toEqual([1, 2, 3, 4]);
    expect(turns[1]?.checkpointCommit).toBe(`refs/harness/checkpoints/${fixture.id}/2`);
    expect(fixture.coordinator.checkpoint(fixture.id)?.sessionRef).toBeNull();
    const note = JSON.parse(result.handoffArtifact) as {
      llmTokens: number;
      generatedBy: string;
      stepsCompleted: string[];
      stepsRemaining: string[];
      changedFiles: string[];
      lastCheckResults: Array<{ id: string; status: string }>;
      lastFailingCheck: string | null;
      briefVersion: number;
    };
    expect(note.llmTokens).toBe(0);
    expect(note.generatedBy).toBe("code");
    expect(note.briefVersion).toBe(4);
    expect(note.stepsCompleted).toEqual(["MUST-1: edit the file"]);
    expect(note.stepsRemaining).toEqual(["submit"]);
    expect(note.changedFiles).toEqual(["src/app.ts"]);
    expect(note.lastCheckResults).toEqual([{ id: "AC-1", status: "pass" }]);
    expect(note.lastFailingCheck).toBeNull();
    expect(fixture.model.calls.every((call) => call.store === false)).toBe(true);
    expect(fixture.model.calls[0]?.zones).toEqual([
      "kernel",
      "must",
      "should",
      "working_memory",
      "history",
      "tail",
    ]);
    const body = fixture.model.calls[0]?.body ?? "";
    expect(body.indexOf("[zone:kernel]")).toBeLessThan(body.indexOf("[zone:must]"));
    expect(body.indexOf("[zone:must]")).toBeLessThan(body.indexOf("[zone:should]"));
    expect(body.indexOf("[zone:should]")).toBeLessThan(body.indexOf("[zone:working_memory]"));
    expect(body.indexOf("[zone:working_memory]")).toBeLessThan(body.indexOf("[zone:history]"));
    expect(body.indexOf("[zone:history]")).toBeLessThan(body.indexOf("[zone:tail]"));
    expect(fixture.model.calls[1]?.replayItems.map((item) => item.encryptedContent)).toContain(
      "opaque-reasoning-blob",
    );
    expect(fixture.model.lastOptions?.stallTimeoutMs).toBe(60_000);
    const reconstructed = reconstructProviderItems(turns, (artifact) => fixture.coordinator.items(artifact));
    expect(reconstructed.some((item) => item.encryptedContent === "opaque-reasoning-blob")).toBe(true);
    assertReserveBeforeStream(fixture.events);
    expect(fixture.attempt().failureCalibrationIncrements).toBe(0);
    expect(fixture.budget.spent).toBe(60);
  });

  it("formats only in-scope paths and only at submit", async () => {
    const fixture = createFixture({
      script(call): ScriptedTurn {
        if (call === 0) {
          return {
            tools: [
              { name: "str_replace", arguments: { path: "src/app.ts", content: "export const value = 2;\n" } },
              { name: "str_replace", arguments: { path: "README.md", content: "notes\n" } },
            ],
          };
        }
        if (call === 1) return { tools: [{ name: "harness.submit_candidate", arguments: {} }] };
        throw new Error(`unexpected model call ${call}`);
      },
    });
    await fixture.loop.runAttempt(fixture.id);
    expect(fixture.formatted).toEqual([["src/app.ts"]]);
    expect(fixture.files.read("README.md")).toBe("notes\n");
    expect(fixture.files.read("src/app.ts")).toContain("/*formatted*/");
  });

  it("updates working memory through notes.update and keeps the handoff deterministic", async () => {
    const fixture = createFixture({
      script(call): ScriptedTurn {
        if (call === 0) {
          return {
            tools: [
              {
                name: "notes.update",
                arguments: { doneByMustId: { "MUST-1": "edit the file" }, planSteps: ["edit the file", "submit"] },
              },
            ],
          };
        }
        if (call === 1) return { tools: [{ name: "harness.submit_candidate", arguments: {} }] };
        throw new Error(`unexpected model call ${call}`);
      },
    });
    const result = await fixture.loop.runAttempt(fixture.id);
    const note = JSON.parse(result.handoffArtifact) as { stepsCompleted: string[]; llmTokens: number };
    expect(note.stepsCompleted).toEqual(["MUST-1: edit the file"]);
    expect(note.llmTokens).toBe(0);
    const again = generateHandoffNote({
      briefVersion: 4,
      workingMemory: fixture.attempt().workingMemory,
      changedFiles: ["src/app.ts", "src/app.ts"],
      lastCheckResults: [{ id: "AC-9", status: "fail" }],
    });
    expect(again).toBe(
      generateHandoffNote({
        briefVersion: 4,
        workingMemory: fixture.attempt().workingMemory,
        changedFiles: ["src/app.ts"],
        lastCheckResults: [{ id: "AC-9", status: "fail" }],
      }),
    );
    expect(JSON.parse(again)).toMatchObject({ lastFailingCheck: "AC-9", llmTokens: 0, generatedBy: "code" });
  });

  it("offers no subagent tools", () => {
    for (const name of SUBAGENT_TOOL_NAMES) {
      expect(NATIVE_TOOL_CATALOG).not.toContain(name);
    }
  });

  it("rolls a coordinator transaction back when the commit fails", () => {
    const fixture = createFixture({ script: () => ({ text: "idle" }) });
    expect(() =>
      fixture.coordinator.transaction(() => {
        fixture.coordinator.appendTurn({
          attempt: fixture.id,
          step: 1,
          requestDigest: "digest",
          itemsArtifact: null,
          toolCall: null,
          resultSummary: "partial",
          resultArtifact: null,
          checkpointCommit: null,
          tokensIn: 1,
          tokensOut: 1,
        });
        fixture.coordinator.saveCheckpoint({
          attempt: fixture.id,
          step: 1,
          wipRef: "refs/harness/checkpoints/A1/1",
          sessionRef: null,
          contractVersions: {},
          pendingEffects: [],
          handoffArtifact: "partial",
          updatedAt: 1,
        });
        throw new Error("commit failed");
      }),
    ).toThrow("commit failed");
    expect(fixture.coordinator.turns(fixture.id)).toHaveLength(0);
    expect(fixture.coordinator.checkpoint(fixture.id)).toBeNull();
  });
});
