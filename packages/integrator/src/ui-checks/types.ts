export type UiProjectKind = "ui" | "cli" | "api";

export type ThemeMode = "light" | "dark";

export type UiConsistencyStageId =
  | "token_discipline"
  | "duplicate_component"
  | "three_width_tap_target"
  | "axe_accessibility"
  | "cross_screen_rhythm"
  | "screenshot_regression";

export type UiConsistencyStageStatus =
  | "passed"
  | "failed"
  | "skipped"
  | "not_applicable_no_ui";

export interface SourceLocation {
  readonly file: string;
  readonly line: number;
  readonly column?: number;
  readonly dataEfSource?: string;
}

export interface UiConsistencyFinding {
  readonly stage: UiConsistencyStageId;
  readonly rule: string;
  readonly message: string;
  readonly severity: "error" | "warning" | "notice";
  readonly location?: SourceLocation;
  readonly casArtifactId?: string;
}

export interface RepoFileSlice {
  readonly path: string;
  readonly contents: string;
}

export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RenderedElement {
  readonly selector: string;
  readonly role: string;
  readonly tag: string;
  readonly box: BoundingBox;
  readonly interactive: boolean;
  readonly accessibleName?: string;
  readonly source?: SourceLocation;
}

export interface RenderedRouteAudit {
  readonly route: string;
  readonly viewportId: string;
  readonly width: number;
  readonly height: number;
  readonly theme: ThemeMode;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly elements: readonly RenderedElement[];
  readonly images: readonly { readonly selector: string; readonly complete: boolean; readonly naturalWidth: number; readonly source?: SourceLocation }[];
  readonly primaryContentHeight: number;
}

export interface AxeViolation {
  readonly id: string;
  readonly impact: "minor" | "moderate" | "serious" | "critical";
  readonly description: string;
  readonly nodes: readonly { readonly target: string; readonly source?: SourceLocation }[];
}

export interface ScreenRhythmMetrics {
  readonly route: string;
  readonly headerHeight: number;
  readonly sidebarWidth: number;
  readonly pageTitleFontSize: number;
  readonly pageTitleFontFamily: string;
  readonly pageTitleLineHeight: number;
  readonly cardPadding: number;
  readonly cardBorderRadius: number;
  readonly primaryButtonHeight: number;
  readonly bodyFontFamily: string;
}

export interface RasterFrame {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
  readonly maskedSelectors?: readonly string[];
}

export interface ApprovedBaselineRef {
  readonly route: string;
  readonly viewportId: string;
  readonly theme: ThemeMode;
  readonly casId: string;
}

export interface ScreenshotComparisonOptions {
  readonly maxDiffPixelRatio?: number;
  readonly threshold?: number;
}

export interface CasArtifactRecord {
  readonly id: string;
  readonly kind: "expected" | "actual" | "diff";
  readonly route: string;
  readonly selector?: string;
  readonly source?: SourceLocation;
  readonly frame: RasterFrame;
}

export interface UiConsistencyStageResult {
  readonly stage: UiConsistencyStageId;
  readonly status: UiConsistencyStageStatus;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly findings: readonly UiConsistencyFinding[];
}

export interface UiConsistencyPipelineInput {
  readonly projectKind: UiProjectKind;
  readonly darkModeEnabled?: boolean;
  readonly files: readonly RepoFileSlice[];
  readonly featureComponentPaths?: readonly string[];
  readonly sharedPrimitivePaths?: readonly string[];
  readonly routeAudits?: readonly RenderedRouteAudit[];
  readonly axeViolations?: readonly AxeViolation[];
  readonly rhythmMetrics?: readonly ScreenRhythmMetrics[];
  readonly screenshots?: readonly {
    readonly route: string;
    readonly viewportId: string;
    readonly theme: ThemeMode;
    readonly actual: RasterFrame;
    readonly approvedBaseline?: RasterFrame;
    readonly dynamicMaskSelectors?: readonly string[];
  }[];
  readonly deterministicClockIso?: string;
  readonly tasteReviewBudgetOk?: boolean;
}

export interface TasteReviewResult {
  readonly status: "advisory_sent" | "skipped_no_budget" | "skipped_no_vision_model";
  readonly detail?: string;
}

export interface UiConsistencyPipelineResult {
  readonly status: "passed" | "failed" | "not_applicable_no_ui";
  readonly stages: readonly UiConsistencyStageResult[];
  readonly findings: readonly UiConsistencyFinding[];
  readonly tasteReview?: TasteReviewResult;
  readonly totalDurationMs: number;
}