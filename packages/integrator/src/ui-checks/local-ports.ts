import { LocalBrandAssetRegistry, LocalDesignTokenLint } from "./token-discipline-stage.js";
import type { BeforeAfterBaselinePort, StaticAuditGatePort, TasteReviewerPort } from "./ports.js";
import type { RasterFrame, RepoFileSlice, UiConsistencyFinding } from "./types.js";

export class LocalStaticAuditGate implements StaticAuditGatePort {
  readonly source = "local-port:StaticAuditGate:Task-054";

  scanFiles(files: readonly RepoFileSlice[]): UiConsistencyFinding[] {
    const findings: UiConsistencyFinding[] = [];
    for (const file of files) {
      if (/\bconsole\.log\(/.test(file.contents)) {
        findings.push({
          stage: "token_discipline",
          rule: "static-audit/console",
          severity: "warning",
          message: `console.log in ${file.path}`,
          location: { file: file.path, line: 1, dataEfSource: `${file.path}:1` },
        });
      }
    }
    return findings;
  }
}

export class MemoryBeforeAfterBaseline implements BeforeAfterBaselinePort {
  readonly source = "local-port:BeforeAfterBaselineApprover:Task-161";
  private readonly baselines = new Map<string, RasterFrame>();

  approve(input: { route: string; viewportId: string; theme: string; frame: RasterFrame }): void {
    this.baselines.set(`${input.route}@${input.viewportId}@${input.theme}`, input.frame);
  }

  resolveApprovedBaseline(input: {
    route: string;
    viewportId: string;
    theme: string;
  }): RasterFrame | null {
    return this.baselines.get(`${input.route}@${input.viewportId}@${input.theme}`) ?? null;
  }
}

export class LocalTasteReviewer implements TasteReviewerPort {
  readonly source = "local-port:AdvisoryTasteVisionReviewer:Task-102";

  async reviewScreenshots(input: {
    casArtifactIds: readonly string[];
    budgetOk: boolean;
  }): Promise<{ status: "advisory_sent" | "skipped_no_budget" | "skipped_no_vision_model" }> {
    if (!input.budgetOk) return { status: "skipped_no_budget" };
    if (input.casArtifactIds.length === 0) return { status: "skipped_no_vision_model" };
    return { status: "advisory_sent" };
  }
}

export const defaultConsumedPorts = {
  staticAudit: new LocalStaticAuditGate(),
  tokenLint: new LocalDesignTokenLint(),
  brandAssets: new LocalBrandAssetRegistry(),
  baseline: new MemoryBeforeAfterBaseline(),
  taste: new LocalTasteReviewer(),
} as const;