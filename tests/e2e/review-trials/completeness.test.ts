import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { reportToMarkdown } from "./lib/report.js";
import { reviewTrialsDir } from "./lib/runtime.js";
import { findSkipMarkers, scanDirectory } from "./lib/skip-scan.js";
import { ArchitectureReviewTrialsSuite } from "./lib/suite.js";

describe("review trials completeness", () => {
  it("rejects skip and todo markers and certifies 16 of 16", async () => {
    const planted = ["describe", ".skip", "('hidden')"].join("");
    expect(findSkipMarkers(planted)).toContain(["describe", ".skip"].join(""));
    expect(findSkipMarkers(["it", ".todo", "('later')"].join(""))).toContain(["it", ".todo"].join(""));
    expect(scanDirectory(reviewTrialsDir())).toEqual([]);

    const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-report-"));
    try {
      const report = await ArchitectureReviewTrialsSuite.run({ reportDir });
      expect(report.executed).toBe(16);
      expect(report.passed).toBe(16);
      expect(report.skipped).toBe(0);
      expect(report.areas.map((area) => area.id).join("")).toBe("ABCDEFGHIJ");
      expect(report.trials.map((trial) => trial.id).join("")).toBe("123456");
      expect(report.durationMs).toBeLessThan(90_000);
      expect(report.leakedPids).toBe(0);
      expect(report.leakedTempDirs).toBe(0);
      expect(report.offline).toBe(true);
      expect(report.portStrategy).toBe("ephemeral-loopback");
      expect(report.settledDecisions).toBeGreaterThan(60);
      const json = JSON.parse(fs.readFileSync(path.join(reportDir, "review-trials-certification.json"), "utf8")) as {
        version: string;
        executed: number;
      };
      expect(json.version).toBe("review-trials-certification/1");
      expect(json.executed).toBe(16);
      const markdown = fs.readFileSync(path.join(reportDir, "review-trials-certification.md"), "utf8");
      expect(markdown).toBe(reportToMarkdown(report));
      expect(markdown).toContain("area-a.test.ts");
      expect(markdown).toContain("trial-6.test.ts");
      expect(markdown).toContain("Skipped: 0");
    } finally {
      fs.rmSync(reportDir, { recursive: true, force: true });
    }
  }, 90_000);
});
