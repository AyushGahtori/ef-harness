import { describe, expect, it } from "vitest";

import { CrossDeviceLeaseManager, createNodeGitCommandPort } from "../../src/rehydration/index.js";
import { createHarnessFixture, runGit } from "./fixtures.js";

describe("cross-device lease manager", () => {
  it("defaults laptop B to read-only while laptop A holds epoch 4 and fences stale epoch on reconnect", async () => {
    const fixture = await createHarnessFixture();
    const manager = new CrossDeviceLeaseManager(createNodeGitCommandPort());
    const remote = manager.readRemoteLease(fixture.laptopAPath);

    const laptopBView = manager.evaluateOpenMode(
      { deviceId: fixture.deviceB, deviceLabel: "Laptop-B", writerEpoch: 4 },
      remote,
    );
    expect(laptopBView.mode).toBe("read_only_viewer");

    const laptopAView = manager.evaluateOpenMode(
      { deviceId: fixture.deviceA, deviceLabel: "Laptop-A", writerEpoch: 4 },
      remote,
    );
    expect(laptopAView.mode).toBe("writer");

    const expectedSha = runGit(["rev-parse", "refs/heads/harness-state"], fixture.laptopBPath).trim();
    const pushed = manager.commitTakeover(
      fixture.laptopBPath,
      { deviceId: fixture.deviceB, deviceLabel: "Laptop-B", writerEpoch: 4 },
      expectedSha,
    );
    expect(pushed.newEpoch).toBe(5);
    runGit(["push", "origin", "harness-state", `--force-with-lease=refs/heads/harness-state:${expectedSha}`], fixture.laptopBPath);

    runGit(["fetch", "origin"], fixture.laptopAPath);
    runGit(["reset", "--hard", "origin/harness-state"], fixture.laptopAPath);
    const remoteAfter = manager.readRemoteLease(fixture.laptopAPath);
    const fenced = manager.assertStaleEpochFenced(4, remoteAfter.epoch);
    expect(fenced).toBe("read_only_fenced");
  }, 60_000);
});