import { describe, expect, it } from "vitest";

import { DuplicateComponentDetector } from "../../src/ui-checks/duplicate-component-detector.js";
import { runTokenDisciplineStage } from "../../src/ui-checks/token-discipline-stage.js";
import { ThreeWidthLayoutAndTapTargetChecker } from "../../src/ui-checks/three-width-tap-target-checker.js";
import { runAxeAccessibilityGate } from "../../src/ui-checks/axe-accessibility-gate.js";
import { CrossScreenRhythmAuditor } from "../../src/ui-checks/cross-screen-rhythm-auditor.js";
import { ApprovedScreenshotRegressionRunner, solidFrame } from "../../src/ui-checks/approved-screenshot-regression-runner.js";
import { InMemoryCasStore } from "../../src/ui-checks/cas-store.js";
import { UiConsistencyPipeline } from "../../src/ui-checks/ui-consistency-pipeline.js";
import {
  COMPLIANT_FILES,
  DARK_AXE_VIOLATION,
  DUPLICATE_MODAL_FILE,
  HOTLINK_FILE,
  OUTLIER_RHYTHM,
  OVERFLOW_AUDIT,
  OVERLAP_AUDIT,
  PRIMITIVE_DIALOG,
  RAW_HEX_FILE,
  SMALL_TAP_TARGET_AUDIT,
  compliantScreenshot,
  shiftedScreenshot,
} from "./fixtures.js";

describe("ui-checks adversarial defects", () => {
  it("catches stage 1 raw hex and hotlinks", () => {
    const findings = runTokenDisciplineStage([RAW_HEX_FILE, HOTLINK_FILE]);
    expect(findings.some((f) => f.rule === "ef/no-raw-color")).toBe(true);
    expect(findings.some((f) => f.rule === "ef/no-external-hotlink")).toBe(true);
  });

  it("catches stage 2 duplicate modal clone", () => {
    const detector = new DuplicateComponentDetector();
    const findings = detector.detect({
      featureFiles: [DUPLICATE_MODAL_FILE],
      primitiveFiles: [PRIMITIVE_DIALOG],
    });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.message).toContain("dialog.tsx");
  });

  it("catches stage 3 tap target, overflow, and overlap", () => {
    const checker = new ThreeWidthLayoutAndTapTargetChecker();
    const small = checker.run({ audits: [SMALL_TAP_TARGET_AUDIT], darkModeEnabled: false });
    expect(small.some((f) => f.rule === "tap-target-floor")).toBe(true);
    const overflow = checker.run({ audits: [OVERFLOW_AUDIT], darkModeEnabled: false });
    expect(overflow.some((f) => f.rule === "horizontal-overflow")).toBe(true);
    const overlap = checker.run({ audits: [OVERLAP_AUDIT], darkModeEnabled: false });
    expect(overlap.some((f) => f.rule === "interactive-overlap")).toBe(true);
  });

  it("catches stage 4 serious axe contrast failures", () => {
    const findings = runAxeAccessibilityGate([DARK_AXE_VIOLATION]);
    expect(findings.some((f) => f.severity === "error" && f.rule === "color-contrast")).toBe(true);
  });

  it("catches stage 5 cross-screen rhythm outliers", () => {
    const auditor = new CrossScreenRhythmAuditor();
    const findings = auditor.run(OUTLIER_RHYTHM);
    expect(findings.some((f) => f.message.includes("headerHeight"))).toBe(true);
    expect(findings.some((f) => f.message.includes("cardBorderRadius"))).toBe(true);
  });

  it("catches stage 6 approved baseline drift with CAS artifacts", () => {
    const cas = new InMemoryCasStore();
    const runner = new ApprovedScreenshotRegressionRunner(cas);
    const baseline = compliantScreenshot();
    const result = runner.runOne({
      route: "/orders",
      viewportId: "desktop",
      theme: "light",
      actual: shiftedScreenshot(),
      approvedBaseline: baseline,
    });
    expect(result.findings.length).toBe(1);
    expect(result.findings[0]?.casArtifactId).toBeTruthy();
    expect(cas.list().length).toBe(3);
  });

  it("maps failures to data-ef-source and CAS diff references in the pipeline", async () => {
    const pipeline = new UiConsistencyPipeline();
    const result = await pipeline.run({
      projectKind: "ui",
      files: [...COMPLIANT_FILES, RAW_HEX_FILE, DUPLICATE_MODAL_FILE],
      routeAudits: [SMALL_TAP_TARGET_AUDIT],
      axeViolations: [DARK_AXE_VIOLATION],
      rhythmMetrics: OUTLIER_RHYTHM,
      screenshots: [
        {
          route: "/orders",
          viewportId: "desktop",
          theme: "light",
          actual: shiftedScreenshot(),
          approvedBaseline: compliantScreenshot(),
        },
      ],
    });
    expect(result.status).toBe("failed");
    const located = result.findings.filter((f) => f.location?.dataEfSource);
    expect(located.length).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.casArtifactId)).toBe(true);
  });
});

describe("screenshot runner baseline seeding", () => {
  it("does not fail when no approved baseline exists", () => {
    const cas = new InMemoryCasStore();
    const runner = new ApprovedScreenshotRegressionRunner(cas);
    const result = runner.runOne({
      route: "/new-route",
      viewportId: "mobile",
      theme: "light",
      actual: solidFrame(40, 20, [10, 10, 10, 255]),
    });
    expect(result.findings).toEqual([]);
    expect(result.seededCandidate).toBeTruthy();
  });
});