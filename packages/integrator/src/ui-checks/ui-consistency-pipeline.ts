import { STAGE_ORDER } from "./constants.js";
import { InMemoryCasStore } from "./cas-store.js";
import { CrossScreenRhythmAuditor } from "./cross-screen-rhythm-auditor.js";
import { DuplicateComponentDetector, splitUiSources } from "./duplicate-component-detector.js";
import { ApprovedScreenshotRegressionRunner } from "./approved-screenshot-regression-runner.js";
import { axeGatePassed, runAxeAccessibilityGate } from "./axe-accessibility-gate.js";
import { defaultConsumedPorts } from "./local-ports.js";
import type {
  BeforeAfterBaselinePort,
  BrandAssetRegistryPort,
  CasStorePort,
  DesignTokenLintPort,
  StaticAuditGatePort,
  TasteReviewerPort,
} from "./ports.js";
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
  if (input.projectKind !== "ui") return false;
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
  private readonly cas: CasStorePort;
  private readonly screenshotRunner: ApprovedScreenshotRegressionRunner;
  private readonly deps: Required<
    Pick<UiConsistencyPipelineDeps, "staticAudit" | "tokenLint" | "brandAssets" | "baseline" | "tasteReviewer">
  >;

  constructor(deps: UiConsistencyPipelineDeps = {}) {
    this.cas = deps.cas ?? new InMemoryCasStore();
    this.deps = {
      staticAudit: deps.staticAudit ?? defaultConsumedPorts.staticAudit,
      tokenLint: deps.tokenLint ?? defaultConsumedPorts.tokenLint,
      brandAssets: deps.brandAssets ?? defaultConsumedPorts.brandAssets,
      baseline: deps.baseline ?? defaultConsumedPorts.baseline,
      tasteReviewer: deps.tasteReviewer ?? defaultConsumedPorts.taste,
    };
    this.screenshotRunner = new ApprovedScreenshotRegressionRunner(this.cas, this.deps.baseline);
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

    const stages: UiConsistencyStageResult[] = [];
    const allFindings: UiConsistencyFinding[] = [];

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
      audits: input.routeAudits ?? [],
      darkModeEnabled: input.darkModeEnabled ?? false,
    });
    const layoutErrors = layoutFindings.filter((finding) => finding.severity === "error");
    for (const finding of layoutErrors) {
      const artifactId = this.cas.put({
        id: "",
        kind: "diff",
        route: finding.message,
        frame: { width: 1, height: 1, pixels: new Uint8ClampedArray([255, 0, 0, 255]) },
        ...(finding.location ? { source: finding.location } : {}),
      });
      allFindings.push({ ...finding, casArtifactId: artifactId });
    }
    const nonArtifactLayout = layoutFindings.filter((finding) => finding.severity !== "error");
    allFindings.push(...nonArtifactLayout);
    stages.push(stageResult("three_width_tap_target", [...layoutErrors, ...nonArtifactLayout], Date.now() - s3Start));

    const s4Start = Date.now();
    const axeFindings = runAxeAccessibilityGate(input.axeViolations ?? []);
    stages.push(stageResult("axe_accessibility", axeFindings, Date.now() - s4Start));
    allFindings.push(...axeFindings);

    const s5Start = Date.now();
    const rhythmFindings = this.rhythm.run(input.rhythmMetrics ?? []);
    stages.push(stageResult("cross_screen_rhythm", rhythmFindings, Date.now() - s5Start));
    allFindings.push(...rhythmFindings);

    const s6Start = Date.now();
    const screenshot = this.screenshotRunner.runMany(
      (input.screenshots ?? []).map((shot) => ({
        route: shot.route,
        viewportId: shot.viewportId,
        theme: shot.theme,
        actual: shot.actual,
        ...(shot.approvedBaseline ? { approvedBaseline: shot.approvedBaseline } : {}),
        ...(shot.dynamicMaskSelectors ? { dynamicMaskSelectors: shot.dynamicMaskSelectors } : {}),
      })),
    );
    stages.push(stageResult("screenshot_regression", screenshot.findings, Date.now() - s6Start));
    allFindings.push(...screenshot.findings);

    const hardFailures = allFindings.filter((finding) => finding.severity === "error");
    const passed =
      hardFailures.length === 0 &&
      axeGatePassed(allFindings) &&
      stages.every((stage) => stage.passed || stage.status === "not_applicable_no_ui");

    if (passed) {
      const tasteReview = await this.deps.tasteReviewer.reviewScreenshots({
        casArtifactIds: screenshot.seededCandidates,
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
  }
}