import { describe, expect, it } from "vitest";
import { KEEP_IN_TRAY_LABEL } from "../../src/lifecycle/index.js";
import { MemoryTray, building, createHarness, idleActivity } from "./support.js";

describe("system tray and window close", () => {
  it("shows the tray menu, badge, and restores the window on click while a build is active", async () => {
    const harness = createHarness(building());
    expect(KEEP_IN_TRAY_LABEL).toBe("Keep in tray");
    const tray = harness.trayFactory.trays[0];
    expect(tray).toBeInstanceOf(MemoryTray);
    if (!tray) return;
    expect(tray.menu?.items.map((item) => item.label)).toEqual([
      "Open EF Harness",
      "Building Kitchen App · 3 workers active",
      "Pause Build",
      "Stop Build",
      "Quit",
    ]);
    expect(tray.image?.badge).toBe("green");
    expect(tray.menu?.items[1]?.enabled).toBe(false);
    expect(tray.menu?.items[2]?.enabled).toBe(true);

    harness.coordinator.setActivity(building({ questionsNeedingYou: 1 }));
    expect(harness.coordinator.tray.currentStatus).toBe("1 question needs you");
    expect(harness.coordinator.tray.currentBadge).toBe("amber");

    tray.emit("click");
    expect(harness.windows.focused).toBe(true);
    expect(harness.stream.reasons).toContain("tray-restore");
    tray.emit("double-click");
    expect(harness.stream.reasons.filter((reason) => reason === "tray-restore").length).toBeGreaterThan(1);
  });

  it("minimizes a running build to the tray and never aborts it, remembering Don't ask again", async () => {
    const harness = createHarness(building());
    harness.popOuts.openIds = ["canvas"];
    const first = await harness.coordinator.handleWindowClose();
    expect(first.kind).toBe("prompt");
    if (first.kind !== "prompt") return;
    expect(first.prompt.rememberLabel).toBe("Don't ask again");
    expect(first.prompt.confirmLabel).toBe("Minimize to tray");
    expect(harness.daemon.shutdowns).toHaveLength(0);
    expect(harness.stop.pauses).toHaveLength(0);
    expect(harness.stop.stops).toHaveLength(0);
    expect(harness.coordinator.currentActivity().state).toBe("BUILDING");

    harness.coordinator.dismissMinimize();
    expect(harness.windows.isMainVisible()).toBe(true);
    const second = await harness.coordinator.handleWindowClose();
    expect(second.kind).toBe("prompt");
    harness.coordinator.confirmMinimize(true);
    expect(harness.windows.isMainVisible()).toBe(false);
    expect(harness.coordinator.isResident()).toBe(true);
    expect(harness.daemon.shutdowns).toHaveLength(0);
    expect(harness.popOuts.openCount).toBe(1);
    expect(harness.notifier.shown[0]?.body).toBe("Still building · 3 workers · click to reopen");

    harness.coordinator.restoreFromTray();
    const third = await harness.coordinator.handleWindowClose();
    expect(third.kind).toBe("minimized");
    expect(harness.notifier.shown).toHaveLength(1);
    expect(harness.coordinator.electronQuitCount()).toBe(0);
  });

  it("quits from the window X when idle and notifies when a hidden build finishes or hits P0", async () => {
    const idle = createHarness(idleActivity());
    const closed = await idle.coordinator.handleWindowClose();
    expect(closed.kind).toBe("idle");
    expect(idle.coordinator.currentQuitPrompt()).toBeNull();

    const harness = createHarness(building());
    harness.coordinator.confirmMinimize(false);
    harness.coordinator.setActivity(
      building({ state: "DONE", activeWorkers: 0, waveLabel: "Wave 1" }),
    );
    expect(harness.notifier.shown.at(-1)?.body).toBe("Wave 1 finished");
    harness.notifier.shown.at(-1)?.onClick();
    expect(harness.windows.isMainVisible()).toBe(true);
    expect(harness.stream.reasons).toContain("tray-restore");

    harness.coordinator.confirmMinimize(false);
    harness.coordinator.setActivity(building({ priorityCard: "P0" }));
    expect(harness.notifier.shown.at(-1)?.body).toBe("P0 card needs you");
  });

  it("pauses and stops from the tray without quitting the shell", async () => {
    const harness = createHarness(building());
    const tray = harness.trayFactory.trays[0];
    tray?.select("pause-build");
    await Promise.resolve();
    expect(harness.stop.pauses[0]?.reason).toBe("tray-pause");
    expect(harness.coordinator.currentActivity().state).toBe("PAUSED");
    expect(harness.coordinator.electronQuitCount()).toBe(0);

    harness.coordinator.setActivity(building());
    harness.trayFactory.trays.at(-1)?.select("stop-build");
    await Promise.resolve();
    expect(harness.stop.stops[0]?.reason).toBe("tray-stop");
    expect(harness.coordinator.currentActivity().state).toBe("STOPPED");
  });

  it("keeps an idle tray only when the setting is on", () => {
    const harness = createHarness(idleActivity());
    expect(harness.coordinator.tray.isVisible).toBe(false);
    harness.coordinator.setKeepInTray(true);
    expect(harness.coordinator.tray.isVisible).toBe(true);
    expect(harness.coordinator.tray.currentBadge).toBe("neutral");
    expect(harness.coordinator.tray.currentStatus).toBe("Idle");
  });
});
