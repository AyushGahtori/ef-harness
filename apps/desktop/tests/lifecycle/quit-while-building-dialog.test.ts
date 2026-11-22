import { describe, expect, it } from "vitest";
import { QUIT_CHOICES } from "../../src/lifecycle/index.js";
import { building, createHarness, idleActivity } from "./support.js";

const CHOICE_LABELS = [
  "Keep building in background (Minimize to tray)",
  "Pause safely & Quit",
  "Cancel (Stay open)",
] as const;

describe("QuitWhileBuildingDialog", () => {
  it("offers the exact 3 choices and keeps harnessd building in the tray", async () => {
    const harness = createHarness(building());
    harness.popOuts.openIds = ["preview"];
    const pending = await harness.coordinator.requestQuit("file-menu");
    expect(pending.kind).toBe("dialog");
    if (pending.kind !== "dialog") return;
    expect(pending.prompt.choices).toBe(QUIT_CHOICES);
    expect(pending.prompt.choices.map((choice) => choice.label)).toEqual([...CHOICE_LABELS]);
    expect(pending.prompt.choices.map((choice) => choice.shortLabel)).toEqual([
      "Keep building in tray",
      "Pause safely & Quit",
      "Cancel",
    ]);
    expect(harness.daemon.shutdowns).toHaveLength(0);

    const kept = await harness.coordinator.resolveQuit("keep-building-in-background");
    expect(kept.choice).toBe("keep-building-in-background");
    expect(kept.daemonKeptRunning).toBe(true);
    expect(kept.electronQuit).toBe(false);
    expect(kept.buildsInterrupted).toBe(false);
    expect(kept.rendererDestroyed).toBe(true);
    expect(harness.windows.isRendererDestroyed()).toBe(true);
    expect(harness.coordinator.electronQuitCount()).toBe(0);
    expect(harness.daemon.shutdowns[0]?.mode).toBe("detach_ui_keep_running");
    expect(harness.stop.pauses).toHaveLength(0);
    expect(harness.stop.stops).toHaveLength(0);
    expect(harness.popOuts.openCount).toBe(0);
    expect(harness.popOuts.closedReasons).toEqual(["keep-building"]);
    expect(harness.coordinator.tray.isVisible).toBe(true);
    expect(harness.coordinator.tray.currentStatus).toBe("Building Kitchen App · 3 workers active");
    expect(harness.notifier.shown[0]?.body).toBe("Still building · 3 workers · click to reopen");
  });

  it("pauses safely, flushes within 10s, and quits both processes", async () => {
    const harness = createHarness(building());
    harness.popOuts.openIds = ["board"];
    await harness.coordinator.requestQuit("alt+f4");
    const paused = await harness.coordinator.resolveQuit("pause-safely-and-quit");
    expect(paused.choice).toBe("pause-safely-and-quit");
    expect(paused.orphanedProcesses).toBe(0);
    expect(paused.llmCalls).toBe(0);
    expect(paused.walModes).toEqual(["PASSIVE", "TRUNCATE"]);
    expect(paused.elapsedMs).toBeLessThanOrEqual(10_000);
    expect(paused.electronQuit).toBe(true);
    expect(paused.daemonKeptRunning).toBe(false);
    expect(harness.stop.pauses).toEqual([{ reason: "pause-safely-and-quit", graceMs: 10_000 }]);
    expect(harness.daemon.shutdowns[0]).toMatchObject({
      mode: "drain_and_exit",
      reason: "pause-safely-and-quit",
      deadlineMs: 10_000,
    });
    expect(harness.popOuts.closedReasons).toEqual(["primary-quit"]);
    expect(harness.coordinator.electronQuitCount()).toBe(1);
  });

  it("cancels quit with zero interruption", async () => {
    const harness = createHarness(building());
    await harness.coordinator.requestQuit("tray");
    const cancelled = await harness.coordinator.resolveQuit("cancel");
    expect(cancelled.choice).toBe("cancel");
    expect(cancelled.buildsInterrupted).toBe(false);
    expect(cancelled.electronQuit).toBe(false);
    expect(cancelled.windowVisible).toBe(true);
    expect(harness.daemon.shutdowns).toHaveLength(0);
    expect(harness.stop.pauses).toHaveLength(0);
    expect(harness.stop.stops).toHaveLength(0);
    expect(harness.windows.isMainVisible()).toBe(true);
    expect(harness.coordinator.electronQuitCount()).toBe(0);
    expect(harness.coordinator.currentActivity().state).toBe("BUILDING");
  });

  it("quits immediately when nothing is building, verifying, or merging", async () => {
    const harness = createHarness(idleActivity());
    harness.popOuts.openIds = ["office"];
    const result = await harness.coordinator.requestQuit("file-menu");
    expect(result.kind).toBe("idle");
    if (result.kind !== "idle") return;
    expect(result.result.dialogShown).toBe(false);
    expect(result.result.elapsedMs).toBeLessThan(1_000);
    expect(result.result.daemonKeptRunning).toBe(false);
    expect(result.result.orphanedProcesses).toBe(0);
    expect(harness.coordinator.currentQuitPrompt()).toBeNull();
    expect(harness.daemon.shutdowns[0]).toMatchObject({
      mode: "drain_and_exit",
      reason: "idle-quit",
      idle: true,
      deadlineMs: 1_000,
    });
    expect(harness.popOuts.closedReasons).toEqual(["primary-quit"]);
    expect(harness.coordinator.electronQuitCount()).toBe(1);
  });

  it("leaves harnessd running on idle quit when background sync is active", async () => {
    const harness = createHarness(idleActivity({ backgroundSyncActive: true }));
    const result = await harness.coordinator.requestQuit("alt+f4");
    expect(result.kind).toBe("idle");
    if (result.kind !== "idle") return;
    expect(result.result.daemonKeptRunning).toBe(true);
    expect(result.result.dialogShown).toBe(false);
    expect(result.result.elapsedMs).toBeLessThan(1_000);
    expect(harness.daemon.shutdowns[0]?.mode).toBe("detach_ui_keep_running");
  });

  it("treats verification and merge-queue work as active quit gates", async () => {
    const verifying = createHarness(
      idleActivity({ state: "VERIFYING", projectName: "Kitchen App", verificationActive: true }),
    );
    expect((await verifying.coordinator.requestQuit("before-quit")).kind).toBe("dialog");
    const merging = createHarness(
      idleActivity({ state: "MERGE_QUEUE", projectName: "Kitchen App", mergeQueueActive: true }),
    );
    expect((await merging.coordinator.requestQuit("tray")).kind).toBe("dialog");
  });
});
