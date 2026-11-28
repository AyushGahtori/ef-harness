import { isUiProjectKind, normalizeProjectKind } from "@ef-harness/shared-contracts";
import { STAGE_ORDER } from "./constants.js";
import { CrossScreenRhythmAuditor } from "./cross-screen-rhythm-auditor.js";
import { DuplicateComponentDetector, splitUiSources } from "./duplicate-component-detector.js";
import { ApprovedScreenshotRegressionRunner } from "./approved-screenshot-regression-runner.js";
import { axeGatePassed, runAxeAccessibilityGate } from "./axe-accessibility-gate.js";
import { defaultConsumedPorts, openLandedCas } from "./local-ports.js";
import type {
  BeforeAfterBaselinePort,
  BrandAssetRegistryPort,
  CasStorePort,
  DesignTokenLintPort,
  StaticAuditGatePort,
  TasteReviewerPort,
} from "./ports.js";
import { captureActiveUiPlaywright, frameFromPng } from "./playwright-capture.js";
import { runTokenDisciplineStage } from "./token-discipline-stage.js";
import { ThreeWidthLayoutAndTapTargetChecker } from "./three-width-tap-target-checker.js";
import type {
  UiConsistencyFinding,
  UiConsistencyPipelineInput,
  UiConsistencyPipelineResult,
  UiConsistencyStageId,
  UiConsistencyStageResult,
  UiConsistencyStageStatus,
} from "./types.js";

function hasUiSignals(input: UiConsistencyPipelineInput): boolean {
  const kind = normalizeProjectKind(input.projectKind);
  if (!kind || !isUiProjectKind(kind)) return false;
  return input.files.some((file) => /\.(tsx|jsx|css|html)$/i.test(file.path));
}

function stageResult(
  stage: UiConsistencyStageId,
  findings: readonly UiConsistencyFinding[],
  durationMs: number,
  statusOverride?: UiConsistencyStageStatus,
): UiConsistencyStageResult {
  const hardErrors = findings.filter((finding) => finding.severity === "error");
  const passed = hardErrors.length === 0;
  const status: UiConsistencyStageStatus =
    statusOverride ?? (passed ? "passed" : "failed");
  return { stage, status, passed, durationMs, findings: [...findings] };
}

export interface UiConsistencyPipelineDeps {
  readonly staticAudit?: StaticAuditGatePort;
  readonly tokenLint?: DesignTokenLintPort;
  readonly brandAssets?: BrandAssetRegistryPort;
  readonly baseline?: BeforeAfterBaselinePort;
  readonly tasteReviewer?: TasteReviewerPort;
  readonly cas?: CasStorePort;
}

export class UiConsistencyPipeline {
  private readonly duplicateDetector = new DuplicateComponentDetector();
  private readonly threeWidth = new ThreeWidthLayoutAndTapTargetChecker();
  private readonly rhythm = new CrossScreenRhythmAuditor();
  private readonly injectedCas: CasStorePort | null;
  private readonly deps: Required<
    Pick<UiConsistencyPipelineDeps, "staticAudit" | "tokenLint" | "brandAssets" | "baseline" | "tasteReviewer">
  >;

  constructor(deps: UiConsistencyPipelineDeps = {}) {
    this.injectedCas = deps.cas ?? null;
    this.deps = {
      staticAudit: deps.staticAudit ?? defaultConsumedPorts.staticAudit,
      tokenLint: deps.tokenLint ?? defaultConsumedPorts.tokenLint,
      brandAssets: deps.brandAssets ?? defaultConsumedPorts.brandAssets,
      baseline: deps.baseline ?? defaultConsumedPorts.baseline,
      tasteReviewer: deps.tasteReviewer ?? defaultConsumedPorts.taste,
    };
  }

  async run(input: UiConsistencyPipelineInput): Promise<UiConsistencyPipelineResult> {
    const started = Date.now();
    if (!hasUiSignals(input)) {
      const stages = STAGE_ORDER.map((stage) =>
        stageResult(stage, [], 0, "not_applicable_no_ui"),
      );
      return {
        status: "not_applicable_no_ui",
        stages,
        findings: [],
        totalDurationMs: Date.now() - started,
      };
    }

    const opened = this.injectedCas ? null : await openLandedCas();
    const cas = this.injectedCas ?? opened?.store;
    if (!cas) throw new Error("ui consistency pipeline has no CAS store");
    const landed = opened?.store;
    try {
      const captured = await captureActiveUiPlaywright();
      const pngIds: string[] = [];
      if (landed) {
        for (const shot of captured.screenshots) {
          if (shot.png.byteLength > 16 && shot.width > 1 && shot.height > 1) {
            pngIds.push(landed.putBytes(shot.png));
          }
        }
      }
      const stages: UiConsistencyStageResult[] = [];
      const allFindings: UiConsistencyFinding[] = [];
      const screenshotRunner = new ApprovedScreenshotRegressionRunner(cas, this.deps.baseline);

    const s1Start = Date.now();
    const tokenFindings = [
      ...runTokenDisciplineStage(input.files, {
        tokenLint: this.deps.tokenLint,
        brandAssets: this.deps.brandAssets,
      }),
      ...this.deps.staticAudit.scanFiles(input.files),
    ];
    stages.push(stageResult("token_discipline", tokenFindings, Date.now() - s1Start));
    allFindings.push(...tokenFindings);

    const s2Start = Date.now();
    const split = splitUiSources(input.files);
    const duplicateFindings = this.duplicateDetector.detect({
      featureFiles: split.featureFiles,
      primitiveFiles: split.primitiveFiles,
    });
    stages.push(stageResult("duplicate_component", duplicateFindings, Date.now() - s2Start));
    allFindings.push(...duplicateFindings);

    const s3Start = Date.now();
    const layoutFindings = this.threeWidth.run({
      audits: [...(input.routeAudits ?? []), ...captured.audits],
      darkModeEnabled: input.darkModeEnabled ?? false,
    });
    if (captured.audits.length === 0) {
      layoutFindings.push({
        stage: "three_width_tap_target",
        rule: "playwright-capture-missing",
        severity: "error",
        message: "UiPlaywrightContractVerifier returned no viewport captures",
      });
    }
    const layoutErrors = layoutFindings.filter((finding) => finding.severity === "error");
    const evidence = captured.screenshots.find((shot) => shot.png.byteLength > 16) ?? captured.screenshots[0];
    for (const finding of layoutErrors) {
      const frame = evidence
        ? frameFromPng(evidence.png, Math.max(evidence.width, 24), Math.max(Math.min(evidence.height, 64), 24))
        : { width: 24, height: 24, pixels: new Uint8ClampedArray(24 * 24 * 4) };
      const artifactId = landed
        ? landed.putBytes(evidence?.png ?? Buffer.from(frame.pixels), {
            id: "",
            kind: "diff",
            route: finding.message,
            frame,
            ...(finding.location ? { source: finding.location } : {}),
          })
        : cas.put({
            id: "",
            kind: "diff",
            route: finding.message,
            frame,
            ...(finding.location ? { source: finding.location } : {}),
          });
      allFindings.push({ ...finding, casArtifactId: artifactId });
    }
    const nonArtifactLayout = layoutFindings.filter((finding) => finding.severity !== "error");
    allFindings.push(...nonArtifactLayout);
    stages.push(stageResult("three_width_tap_target", [...layoutErrors, ...nonArtifactLayout], Date.now() - s3Start));

    const s4Start = Date.now();
    const axeFindings = runAxeAccessibilityGate([...(input.axeViolations ?? []), ...captured.axeViolations]);
    if (captured.verifierId.length === 0) {
      axeFindings.push({
        stage: "axe_accessibility",
        rule: "axe-core-not-run",
        severity: "error",
        message: "axe-core did not run inside UiPlaywrightContractVerifier",
      });
    }
    stages.push(stageResult("axe_accessibility", axeFindings, Date.now() - s4Start));
    allFindings.push(...axeFindings);

    const s5Start = Date.now();
    const rhythmInput = input.rhythmMetrics && input.rhythmMetrics.length > 0 ? input.rhythmMetrics : captured.rhythm;
    const rhythmFindings = this.rhythm.run(rhythmInput);
    if (rhythmInput.length === 0) {
      rhythmFindings.push({
        stage: "cross_screen_rhythm",
        rule: "rhythm-not-measured",
        severity: "error",
        message: "computed-style rhythm was not measured",
      });
    }
    stages.push(stageResult("cross_screen_rhythm", rhythmFindings, Date.now() - s5Start));
    allFindings.push(...rhythmFindings);

    const s6Start = Date.now();
    const screenshot = screenshotRunner.runMany([
      ...(input.screenshots ?? []).map((shot) => ({
        route: shot.route,
        viewportId: shot.viewportId,
        theme: shot.theme,
        actual: shot.actual,
        ...(shot.approvedBaseline ? { approvedBaseline: shot.approvedBaseline } : {}),
        ...(shot.dynamicMaskSelectors ? { dynamicMaskSelectors: shot.dynamicMaskSelectors } : {}),
      })),
      ...captured.screenshots.map((shot) => ({
        route: shot.route,
        viewportId: shot.viewportId,
        theme: shot.theme,
        actual: shot.frame,
      })),
    ]);
    if (landed && captured.screenshots.length > 0 && pngIds.length === 0) {
      screenshot.findings.push({
        stage: "screenshot_regression",
        rule: "cas-png-missing",
        severity: "error",
        message: "Playwright screenshots were not stored in CasBlobStore",
      });
    }
    stages.push(stageResult("screenshot_regression", screenshot.findings, Date.now() - s6Start));
    allFindings.push(...screenshot.findings);

    const hardFailures = allFindings.filter((finding) => finding.severity === "error");
    const passed =
      hardFailures.length === 0 &&
      axeGatePassed(allFindings) &&
      stages.every((stage) => stage.passed || stage.status === "not_applicable_no_ui");

    if (passed) {
      const tasteReview = await this.deps.tasteReviewer.reviewScreenshots({
        casArtifactIds: [...screenshot.seededCandidates, ...pngIds],
        budgetOk: input.tasteReviewBudgetOk ?? true,
      });
      return {
        status: "passed",
        stages,
        findings: allFindings,
        tasteReview,
        totalDurationMs: Date.now() - started,
      };
    }
    return {
      status: "failed",
      stages,
      findings: allFindings,
      totalDurationMs: Date.now() - started,
    };
    } finally {
      if (opened) await opened.close();
    }
  }
}