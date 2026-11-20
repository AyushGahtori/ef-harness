import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TierENotInV1Error,
  UnimplementedRemoteExecutionProvider,
  adviseWslMemory,
  reportWslMemory,
} from "../../src/tier-c-d-selector/index.js";

describe("Tier E and WSL memory", () => {
  it("exports a secret-free Tier E stub that local selection does not call", async () => {
    const selectorSource = fs.readFileSync(
      new URL("../../src/tier-c-d-selector/selector.ts", import.meta.url),
      "utf8",
    );
    expect(selectorSource.includes("remote-execution")).toBe(false);
    expect(selectorSource.includes("RemoteExecutionProvider")).toBe(false);
    const remote = new UnimplementedRemoteExecutionProvider();
    expect(remote.tier).toBe("E");
    expect(remote.v1Coupling).toBe("none");
    await expect(remote.listTargets()).rejects.toBeInstanceOf(TierENotInV1Error);
    await expect(
      remote.transferViaGit({ mechanism: "git", baseCommit: "abc", patches: [] }),
    ).rejects.toBeInstanceOf(TierENotInV1Error);
    expect(() =>
      remote.recordUsd({ currency: "usd", amount: 1, targetId: "remote", attemptId: "attempt" }),
    ).toThrow(TierENotInV1Error);
  });

  it("reports WSL2 memory to the governor and never edits .wslconfig", async () => {
    const source = fs.readFileSync(new URL("../../src/tier-c-d-selector/tier-d-wsl.ts", import.meta.url), "utf8");
    expect(source.includes("writeFile")).toBe(false);
    expect(source.includes("appendFile")).toBe(false);
    const samples: Array<{ editedWslConfig: false; memoryBytes: number; recommendedCapMb: number }> = [];
    const advice = await reportWslMemory(
      {
        reportConsumer: (sample) => {
          samples.push(sample);
        },
      },
      async () => "[wsl2]\nmemory=8GB\n",
      async () => 1024,
    );
    expect(advice.editedWslConfig).toBe(false);
    expect(advice.observedConfig).toBe("8GB");
    expect(advice.recommendedCapMb).toBeGreaterThan(0);
    expect(advice.advice).toContain("does not edit .wslconfig");
    expect(samples).toEqual([
      {
        name: "wsl2_vm",
        memoryBytes: 1024,
        recommendedCapMb: advice.recommendedCapMb,
        editedWslConfig: false,
        advice: advice.advice,
      },
    ]);
    const empty = adviseWslMemory({ totalMemoryBytes: 16 * 1024 * 1024 * 1024, vmmemBytes: null, wslConfigText: null });
    expect(empty.editedWslConfig).toBe(false);
    expect(empty.usageKnown).toBe(false);
    expect(empty.advice).toContain("Recommend");
  });
});
