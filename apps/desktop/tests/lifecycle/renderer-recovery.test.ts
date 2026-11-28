import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindElectronLifecycleHost, type ElectronModules } from "../../src/lifecycle/index.js";
import { building, createHarness } from "./support.js";

describe("renderer crash recovery", () => {
  it("keeps harnessd alive and resyncs the stream epoch in under a second", async () => {
    const harness = createHarness(building());
    harness.coordinator.recovery.noteFailure("render-process-gone", "gpu-reset");
    const offer = harness.coordinator.recovery.currentOffer();
    expect(offer?.label).toBe("Reload UI");
    expect(offer?.daemonAlive).toBe(true);
    expect(harness.daemon.shutdowns).toHaveLength(0);
    expect(harness.presence.alive()).toBe(true);
    expect(harness.presence.shutdownCalls).toBe(0);

    const reloaded = await harness.coordinator.recovery.reloadUi();
    expect(reloaded.reconnected).toBe(true);
    expect(reloaded.lostBuildProgress).toBe(0);
    expect(reloaded.streamEpoch).toBe(7);
    expect(reloaded.elapsedMs).toBeLessThan(1_000);
    expect(reloaded.daemonAlive).toBe(true);
    expect(harness.windows.isMainVisible()).toBe(true);
    expect(harness.daemon.shutdowns).toHaveLength(0);

    harness.coordinator.recovery.noteFailure("unresponsive", "renderer-unresponsive");
    expect(harness.coordinator.recovery.currentOffer()?.reason).toBe("unresponsive");
    const again = await harness.coordinator.recovery.reloadUi();
    expect(again.lostBuildProgress).toBe(0);
    expect(harness.stream.reasons).toContain("unresponsive");
  });

  it("wires Electron power, quit, tray, and render-process-gone without importing electron", async () => {
    const source = readFileSync(new URL("../../src/lifecycle/electron-binding.ts", import.meta.url), "utf8");
    expect(source.includes('from "electron"')).toBe(false);
    expect(source.includes("requestSingleInstanceLock")).toBe(true);
    expect(source.includes('start(type: "prevent-app-suspension")')).toBe(true);

    const events = new Map<string, Array<(...args: unknown[]) => void>>();
    const powerEvents = new Map<string, Array<() => void>>();
    const quits: string[] = [];
    let prevented = false;
    const windowEvents = new Map<string, Array<(...args: unknown[]) => void>>();
    const webEvents = new Map<string, Array<(...args: unknown[]) => void>>();
    const modules: ElectronModules = {
      argv: ["ef-harness.exe"],
      app: {
        requestSingleInstanceLock: () => true,
        quit: () => quits.push("quit"),
        exit: () => quits.push("exit"),
        setLoginItemSettings: () => undefined,
        getLoginItemSettings: () => ({ openAtLogin: false, args: [] }),
        on: (event, listener) => {
          const list = events.get(event) ?? [];
          list.push(listener);
          events.set(event, list);
        },
      },
      powerMonitor: {
        on: (event, listener) => {
          const list = powerEvents.get(event) ?? [];
          list.push(listener);
          powerEvents.set(event, list);
        },
      },
      powerSaveBlocker: {
        start: () => 1,
        stop: () => undefined,
        isStarted: () => false,
      },
      tray: { create: () => { throw new Error("tray is created by the controller factory"); } },
      nativeImage: { createFromBadge: (badge) => ({ badge }) },
      window: {
        on: (event, listener) => {
          const list = windowEvents.get(event) ?? [];
          list.push(listener);
          windowEvents.set(event, list);
        },
        hide: () => undefined,
        show: () => undefined,
        focus: () => undefined,
        destroy: () => undefined,
        isDestroyed: () => false,
        isVisible: () => true,
        webContents: {
          on: (event, listener) => {
            const list = webEvents.get(event) ?? [];
            list.push(listener);
            webEvents.set(event, list);
          },
          reload: () => undefined,
        },
      },
    };
    const harness = createHarness(building());
    const host = bindElectronLifecycleHost(modules);
    harness.coordinator.attach(host);
    expect(powerEvents.has("suspend")).toBe(true);
    expect(powerEvents.has("resume")).toBe(true);
    expect(powerEvents.has("shutdown")).toBe(true);
    expect(events.has("before-quit")).toBe(true);
    const suspend = powerEvents.get("suspend")?.[0];
    await suspend?.();
    expect(harness.claims.paused).toBe(true);
    const beforeQuit = events.get("before-quit")?.[0];
    beforeQuit?.({
      preventDefault() {
        prevented = true;
      },
      get defaultPrevented() {
        return prevented;
      },
    });
    await Promise.resolve();
    expect(prevented).toBe(true);
    expect(harness.coordinator.currentQuitPrompt()?.title).toBe("Quit while building?");
    expect(webEvents.has("render-process-gone")).toBe(true);
    webEvents.get("render-process-gone")?.[0]?.({}, { reason: "crashed" });
    expect(harness.coordinator.recovery.currentOffer()?.label).toBe("Reload UI");
    expect(harness.daemon.shutdowns).toHaveLength(0);
    expect(harness.presence.alive()).toBe(true);
  });
});
