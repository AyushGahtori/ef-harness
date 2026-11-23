import { describe, expect, it } from "vitest";
import { GeminiOptInRequiredError, isUserGeminiPath } from "../../src/gemini-cli/index.js";
import { nodeProcessSpawner, type ProcessSpawner } from "../../src/gemini-cli/process-util.js";
import { GeminiVisibleConPtyLoginHelper } from "../../src/gemini-cli/index.js";
import { acceptDefaultNotice, fakeGeminiPath, makeHarness, makeWorktree, removeWorktree } from "./support.js";

describe("visible ConPTY Gemini login", () => {
  it("shows the interactive login and cancels the process tree", async () => {
    const harness = makeHarness();
    const worktree = makeWorktree();
    const windowsHide: boolean[] = [];
    const spawner: ProcessSpawner = (request) => {
      windowsHide.push(request.windowsHide);
      return nodeProcessSpawner(request);
    };
    acceptDefaultNotice(harness.gate);
    const helper = new GeminiVisibleConPtyLoginHelper(harness.gate, worktree, {
      command: process.execPath,
      argsPrefix: [fakeGeminiPath],
      loginArgs: ["--login"],
      guard: harness.guard,
      spawner,
    });
    try {
      const session = await helper.open();
      expect(session.visible).toBe(true);
      expect(session.pane).toBe("settings-connections");
      expect(session.windowsHide).toBe(false);
      expect(windowsHide[0]).toBe(false);
      expect(session.pid).not.toBeNull();
      const deadline = Date.now() + 3_000;
      while (!session.output().includes("Sign in with Google") && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(session.output()).toContain("Sign in with Google");
      expect(session.output()).toContain(session.geminiCliHome);
      expect(isUserGeminiPath(session.geminiCliHome)).toBe(false);
      await session.cancel();
      const exitDeadline = Date.now() + 3_000;
      while (!session.exited() && Date.now() < exitDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(session.exited()).toBe(true);
      const verified = await helper.verifyAuthStatus();
      expect(verified.method).toBe("acp_initialize");
      expect(verified.readsCredentialDirectory).toBe(false);
      expect(verified.ok).toBe(true);
      expect(windowsHide.some((hidden) => hidden === true)).toBe(true);
    } finally {
      await removeWorktree(worktree);
    }
  });

  it("does not open a terminal before opt-in", async () => {
    const harness = makeHarness();
    const worktree = makeWorktree();
    const helper = new GeminiVisibleConPtyLoginHelper(harness.gate, worktree, {
      command: process.execPath,
      argsPrefix: [fakeGeminiPath],
      loginArgs: ["--login"],
      guard: harness.guard,
    });
    try {
      await expect(helper.open()).rejects.toBeInstanceOf(GeminiOptInRequiredError);
    } finally {
      await removeWorktree(worktree);
    }
  });
});
