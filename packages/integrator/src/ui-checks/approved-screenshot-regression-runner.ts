import { SCREENSHOT_TOLERANCE } from "./constants.js";
import type { CasStorePort, BeforeAfterBaselinePort } from "./ports.js";
import type { RasterFrame, ThemeMode, UiConsistencyFinding } from "./types.js";
import {
  buildMaskedPixelSet,
  compareRasterFrames,
  findingFromVisualDiff,
  packageVisualDiffArtifacts,
} from "./visual-diff-artifacts.js";

export interface ScreenshotRegressionInput {
  readonly route: string;
  readonly viewportId: string;
  readonly theme: ThemeMode;
  readonly actual: RasterFrame;
  readonly approvedBaseline?: RasterFrame | null;
  readonly dynamicMaskSelectors?: readonly string[];
  readonly selector?: string;
}

export class ApprovedScreenshotRegressionRunner {
  constructor(
    private readonly cas: CasStorePort,
    private readonly baselinePort?: BeforeAfterBaselinePort,
    private readonly tolerance = SCREENSHOT_TOLERANCE,
  ) {}

  runOne(input: ScreenshotRegressionInput): {
    readonly findings: UiConsistencyFinding[];
    readonly seededCandidate?: string;
  } {
    const baseline =
      input.approvedBaseline ??
      this.baselinePort?.resolveApprovedBaseline({
        route: input.route,
        viewportId: input.viewportId,
        theme: input.theme,
      }) ??
      null;

  const masked = buildMaskedPixelSet(input.actual, input.dynamicMaskSelectors);

    if (!baseline) {
      const seeded = this.cas.put({
        id: "",
        kind: "actual",
        route: input.route,
        frame: input.actual,
      });
      return { findings: [], seededCandidate: seeded };
    }

    const compared = compareRasterFrames(baseline, input.actual, {
      maxDiffPixelRatio: this.tolerance.maxDiffPixelRatio,
      threshold: this.tolerance.threshold,
      masked,
    });
    if (compared.diffRatio <= this.tolerance.maxDiffPixelRatio) {
      return { findings: [] };
    }
    const artifacts = packageVisualDiffArtifacts({
      route: input.route,
      expected: baseline,
      actual: input.actual,
      diff: compared.diff,
      cas: this.cas,
      ...(input.selector ? { selector: input.selector } : {}),
    });
    return {
      findings: [
        findingFromVisualDiff({
          route: input.route,
          diffRatio: compared.diffRatio,
          artifactIds: artifacts,
          ...(input.selector ? { selector: input.selector } : {}),
        }),
      ],
    };
  }

  runMany(inputs: readonly ScreenshotRegressionInput[]): {
    readonly findings: UiConsistencyFinding[];
    readonly seededCandidates: string[];
  } {
    const findings: UiConsistencyFinding[] = [];
    const seededCandidates: string[] = [];
    for (const input of inputs) {
      const result = this.runOne(input);
      findings.push(...result.findings);
      if (result.seededCandidate) seededCandidates.push(result.seededCandidate);
    }
    return { findings, seededCandidates };
  }
}

export function solidFrame(width: number, height: number, rgba: [number, number, number, number]): RasterFrame {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    pixels[offset] = rgba[0];
    pixels[offset + 1] = rgba[1];
    pixels[offset + 2] = rgba[2];
    pixels[offset + 3] = rgba[3];
  }
  return { width, height, pixels };
}