import { describe, expect, it } from "vitest";
import { runBothAndWrite, summarizeFailures } from "./run-spike.ts";

describe("node:sqlite inside Electron 42+", () => {
  it("passes WAL, FTS5, VACUUM INTO, and the 67 schema scenarios on Node and ELECTRON_RUN_AS_NODE", async () => {
    const report = await runBothAndWrite();
    if (report.decision !== "go") {
      throw new Error(summarizeFailures(report));
    }
    expect(report.decision).toBe("go");
    expect(report.systemNode.passed).toBe(true);
    expect(report.electron.passed).toBe(true);
  }, 300_000);
});
