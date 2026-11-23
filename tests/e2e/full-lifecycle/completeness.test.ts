import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { reportToMarkdown } from "./lib/report.js";
import { fullLifecycleDir } from "./lib/runtime.js";
import { findSkipMarkers, scanDirectory } from "./lib/skip-scan.js";
import { FullLifecycleMultiProjectE2eSuite } from "./lib/suite.js";

describe("full-lifecycle completeness", () => {
  it("rejects skip markers and certifies three cross-milestone journeys", async () => {
    const planted = ["describe", ".skip", "('hidden')"].join("");
    expect(findSkipMarkers(planted)).toContain(["describe", ".skip"].join(""));
    expect(scanDirectory(fullLifecycleDir())).toEqual([]);

    const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "cross-milestone-report-"));
    try {
      const report = await FullLifecycleMultiProjectE2eSuite.run({ reportDir });
      expect(report.journeysExecuted).toBe(3);
      expect(report.journeysPassed).toBe(3);
      expect(report.skipped).toBe(0);
      expect(report.durationMs).toBeLessThan(150_000);
      expect(report.leakedPids).toBe(0);
      expect(report.leakedTempDirs).toBe(0);
      expect(report.plaintextSecrets).toBe(0);
      expect(report.seamHealth.contractDrift).toBe(0);
      expect(report.seamHealth.ipcGapFree).toBe(true);
      expect(report.seamHealth.boardUpdateMs).toBeLessThan(10);
      expect(report.journeys.map((j) => j.id).join(",")).toBe("greenfield-full,multi-project-broker,cli-and-api");

      const json = JSON.parse(fs.readFileSync(path.join(reportDir, "cross-milestone-integration.json"), "utf8")) as {
        version: string;
        journeysExecuted: number;
      };
      expect(json.version).toBe("cross-milestone-integration/1");
      expect(json.journeysExecuted).toBe(3);

      const markdown = fs.readFileSync(path.join(reportDir, "cross-milestone-integration.md"), "utf8");
      expect(markdown).toBe(reportToMarkdown(report));
      expect(markdown).toContain("journey-greenfield-full.test.ts");
      expect(markdown).toContain("Skipped: 0");
    } finally {
      fs.rmSync(reportDir, { recursive: true, force: true });
    }
  }, 150_000);
});