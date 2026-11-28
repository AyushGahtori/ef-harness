import { describe, expect, it } from "vitest";
import {
  HIDDEN_TRAY_ARG,
  START_AT_SIGN_IN_LABEL,
  StartAtSignInManager,
  parseLaunchArgs,
} from "../../src/lifecycle/index.js";
import { building, createHarness, idleActivity, SingleInstanceBroker } from "./support.js";

describe("single instance and start at sign-in", () => {
  it("focuses the existing tray window and forwards the project path and deep link", () => {
    const broker = new SingleInstanceBroker();
    const primaryApp = broker.create([
      "ef-harness.exe",
      "--project",
      "C:\\src\\kitchen",
      "ef-harness://open/project/kitchen",
    ]);
    const primary = createHarness(building(), { singleInstanceApp: primaryApp });
    primary.coordinator.confirmMinimize(false);
    expect(primary.windows.isMainVisible()).toBe(false);
    const acquired = primary.coordinator.acquireSingleInstance(primaryApp.argv);
    expect(acquired.primary).toBe(true);
    expect(acquired.shouldExit).toBe(false);
    expect(primary.windows.lastLaunch).toMatchObject({
      projectPath: "C:\\src\\kitchen",
      deepLink: "ef-harness://open/project/kitchen",
    });

    const duplicateApp = broker.create(["ef-harness.exe", "C:\\src\\other"]);
    const duplicate = createHarness(idleActivity(), { singleInstanceApp: duplicateApp });
    const second = duplicate.coordinator.acquireSingleInstance(duplicateApp.argv);
    expect(second.primary).toBe(false);
    expect(second.shouldExit).toBe(true);
    expect(duplicateApp.exited).toBe(0);
    expect(primary.windows.isMainVisible()).toBe(true);
    expect(primary.windows.focused).toBe(true);
    expect(primary.windows.lastLaunch?.projectPath).toBe("C:\\src\\other");
    expect(primary.stream.reasons).toContain("tray-restore");
  });

  it("starts hidden when launched with --hidden-tray", () => {
    const broker = new SingleInstanceBroker();
    const app = broker.create(["ef-harness.exe", "--hidden-tray"]);
    const harness = createHarness(idleActivity(), { singleInstanceApp: app });
    const acquired = harness.coordinator.acquireSingleInstance(app.argv);
    expect(acquired.forwarded?.hiddenTray).toBe(true);
    expect(harness.windows.isMainVisible()).toBe(false);
    expect(harness.coordinator.isResident()).toBe(true);
    expect(harness.coordinator.tray.isVisible).toBe(true);
    expect(parseLaunchArgs(["ef-harness.exe", "--project=C:\\src\\kitchen"]).projectPath).toBe(
      "C:\\src\\kitchen",
    );
  });

  it("keeps start-at-sign-in off until the user opts in", () => {
    const harness = createHarness(idleActivity());
    expect(harness.coordinator.signIn.isEnabled()).toBe(false);
    expect(harness.coordinator.signIn.label).toBe(START_AT_SIGN_IN_LABEL);
    expect(harness.login.sets).toBe(0);
    harness.coordinator.setStartAtSignIn(true);
    expect(harness.login.openAtLogin).toBe(true);
    expect(harness.login.args).toEqual([HIDDEN_TRAY_ARG]);
    harness.coordinator.setStartAtSignIn(false);
    expect(harness.login.openAtLogin).toBe(false);
    expect(harness.login.args).toEqual([HIDDEN_TRAY_ARG]);

    const fresh = new StartAtSignInManager(harness.login);
    expect(fresh.isEnabled()).toBe(false);
  });
});
