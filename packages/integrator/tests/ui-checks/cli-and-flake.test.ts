import { describe, expect, it } from "vitest";

import { ApprovedScreenshotRegressionRunner } from "../../src/ui-checks/approved-screenshot-regression-runner.js";
import { InMemoryCasStore } from "../../src/ui-checks/cas-store.js";
import { UiConsistencyPipeline } from "../../src/ui-checks/ui-consistency-pipeline.js";
import { compareRasterFrames } from "../../src/ui-checks/visual-diff-artifacts.js";
import { SCREENSHOT_TOLERANCE } from "../../src/ui-checks/constants.js";
import {
  COMPLIANT_FILES,
  COMPLIANT_ROUTE_AUDITS,
  COMPLIANT_RHYTHM,
  compliantScreenshot,
  dynamicMaskedScreenshot,
} from "./fixtures.js";

describe("cli skip and screenshot flake tolerance", () => {
  it("skips all stages for CLI projects", async () => {
    const pipeline = new UiConsistencyPipeline();
    const result = await pipeline.run({
      projectKind: "cli",
      files: [{ path: "src/cli.ts", contents: "export function main() {}\n" }],
    });
    expect(result.status).toBe("not_applicable_no_ui");
    expect(result.stages.every((stage) => stage.status === "not_applicable_no_ui")).toBe(true);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("keeps identical layouts stable across ten masked screenshot comparisons", () => {
    const baseline = compliantScreenshot();
    const clocked = compliantScreenshot();
    const maskedFrame = {
      ...dynamicMaskedScreenshot(),
      pixels: dynamicMaskedScreenshot().pixels.slice(),
    };
    const maskedFrameVariant = {
      ...maskedFrame,
      pixels: maskedFrame.pixels.slice(),
    };
    maskedFrameVariant.pixels[0] = 255;
    for (let run = 0; run < 10; run += 1) {
      const same = compareRasterFrames(baseline, clocked, {
        maxDiffPixelRatio: SCREENSHOT_TOLERANCE.maxDiffPixelRatio,
        threshold: SCREENSHOT_TOLERANCE.threshold,
      });
      expect(same.diffRatio).toBe(0);
      const masked = compareRasterFrames(maskedFrame, maskedFrameVariant, {
        maxDiffPixelRatio: SCREENSHOT_TOLERANCE.maxDiffPixelRatio,
        threshold: SCREENSHOT_TOLERANCE.threshold,
        masked: new Set(["0,0", "1,0", "2,0"]),
      });
      expect(masked.diffRatio).toBe(0);
    }
  });

  it("respects taste budget skip after deterministic pass", async () => {
    const pipeline = new UiConsistencyPipeline();
    const result = await pipeline.run({
      projectKind: "ui",
      darkModeEnabled: true,
      files: COMPLIANT_FILES,
      routeAudits: COMPLIANT_ROUTE_AUDITS,
      rhythmMetrics: COMPLIANT_RHYTHM,
      tasteReviewBudgetOk: false,
    });
    expect(result.status).toBe("passed");
    expect(result.tasteReview?.status).toBe("skipped_no_budget");
  });

  it("exposes Windows sub-pixel tolerance constants", () => {
    const cas = new InMemoryCasStore();
    const runner = new ApprovedScreenshotRegressionRunner(cas);
    const nearly = compliantScreenshot();
    const variant = compliantScreenshot();
    const offset = 4;
    variant.pixels[offset] = variant.pixels[offset]! + 1;
    const compared = runner.runOne({
      route: "/orders",
      viewportId: "desktop",
      theme: "light",
      actual: variant,
      approvedBaseline: nearly,
    });
    expect(compared.findings).toEqual([]);
  });
});