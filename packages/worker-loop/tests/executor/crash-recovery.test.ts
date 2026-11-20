import { describe, expect, it } from "vitest";
import type { CrashInjectorPort } from "../../src/executor/ports.js";
import { CrashInjectedError, type CrashPoint } from "../../src/executor/types.js";
import {
  createFixture,
  editThenSubmit,
  type MemoryFiles,
  type ScriptedTurn,
} from "./support.js";

describe("checkpoint crash recovery", () => {
  it.each([
    ["during_model_call", null],
    ["after_response_before_tool", null],
    ["during_tool", 0],
    ["after_tool_before_log", 0],
  ] as const)("resumes a %s crash to the same final files and contiguous steps", async (point, toolIndex) => {
    const clean = createFixture({ script: editThenSubmit });
    await clean.loop.runAttempt(clean.id);
    let tree: MemoryFiles | null = null;
    const crashed = createFixture({
      script: editThenSubmit,
      bindFiles: (files) => {
        tree = files;
      },
      crash: oneShot(point, () => tree, toolIndex),
    });
    await expect(crashed.loop.runAttempt(crashed.id)).rejects.toBeInstanceOf(CrashInjectedError);
    const pending = crashed.coordinator.checkpoint(crashed.id)?.pendingEffects[0];
    if (point === "during_model_call") {
      expect(pending?.kind).toBe("model_in_flight");
      expect(crashed.coordinator.turns(crashed.id)).toHaveLength(0);
      const digest = pending?.kind === "model_in_flight" ? pending.requestDigest : "";
      const resumed = await crashed.loop.resumeAttemptFromCheckpoint(crashed.id);
      expect(resumed.outcome).toBe("submitted");
      expect(crashed.events.indexOf("reconcile")).toBeGreaterThan(-1);
      expect(crashed.events.indexOf("reconcile")).toBeLessThan(crashed.events.indexOf("stream"));
      expect(crashed.model.calls[0]?.requestDigest).toBe(digest);
      expect(crashed.model.calls[0]?.store).toBe(false);
    } else {
      expect(crashed.coordinator.turns(crashed.id)).toHaveLength(0);
      if (point === "during_tool" || point === "after_tool_before_log") {
        expect(crashed.files.read("src/trash.ts")).toBe("trash");
      }
      const streamsBefore = crashed.model.calls.length;
      const resumed = await crashed.loop.resumeAttemptFromCheckpoint(crashed.id);
      expect(resumed.outcome).toBe("submitted");
      if (point === "after_response_before_tool") {
        expect(crashed.model.calls.length).toBe(streamsBefore + 1);
      }
    }
    expect(crashed.files.dump()).toEqual(clean.files.dump());
    expect(crashed.files.read("src/trash.ts")).toBeNull();
    const steps = crashed.coordinator.turns(crashed.id).map((turn) => turn.step);
    expect(steps).toEqual(steps.map((_, index) => index + 1));
    expect(new Set(steps).size).toBe(steps.length);
  });

  it("runs parallel tool calls one at a time and recovers a crash on the second tool", async () => {
    const script = (call: number): ScriptedTurn => {
      if (call === 0) {
        return {
          tools: [
            { name: "read_file", arguments: { path: "src/app.ts" } },
            { name: "str_replace", arguments: { path: "src/app.ts", content: "export const value = 2;\n" } },
            { name: "harness.run", arguments: { command: "npm test" } },
          ],
        };
      }
      if (call === 1) return { tools: [{ name: "harness.submit_candidate", arguments: {} }] };
      throw new Error(`unexpected model call ${call}`);
    };
    const clean = createFixture({ script });
    await clean.loop.runAttempt(clean.id);
    let tree: MemoryFiles | null = null;
    const crashed = createFixture({
      script,
      bindFiles: (files) => {
        tree = files;
      },
      crash: oneShot("during_tool", () => tree, 1),
    });
    await expect(crashed.loop.runAttempt(crashed.id)).rejects.toBeInstanceOf(CrashInjectedError);
    expect(crashed.coordinator.turns(crashed.id)).toHaveLength(1);
    expect(crashed.files.read("src/app.ts")).toBe("GARBAGE");
    expect(crashed.model.calls).toHaveLength(1);
    const resumed = await crashed.loop.resumeAttemptFromCheckpoint(crashed.id);
    expect(resumed.outcome).toBe("submitted");
    expect(crashed.model.calls).toHaveLength(2);
    expect(crashed.files.dump()).toEqual(clean.files.dump());
    expect(crashed.coordinator.turns(crashed.id).map((turn) => turn.step)).toEqual([1, 2, 3, 4]);
    expect(crashed.events.filter((event) => event === "run")).toHaveLength(1);
  });
});

function oneShot(
  point: CrashPoint,
  files: () => MemoryFiles | null,
  toolIndex: number | null,
): CrashInjectorPort {
  let armed = true;
  return {
    shouldCrash(candidate, site) {
      if (!armed || candidate !== point) return false;
      if (toolIndex !== null && site.toolIndex !== toolIndex) return false;
      armed = false;
      return true;
    },
    onCrash(candidate) {
      const tree = files();
      if (!tree) return;
      if (candidate === "during_tool" || candidate === "after_tool_before_log") {
        tree.write("src/app.ts", "GARBAGE");
        tree.write("src/trash.ts", "trash");
      }
    },
  };
}
