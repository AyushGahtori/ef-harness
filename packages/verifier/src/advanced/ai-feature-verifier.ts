import { JudgeFamilyError } from "./errors.js";
import { selectJudgeProfile, type JudgeSelection } from "./family-selection.js";
import { runJudgeEval, type EvalCase, type JudgeRunReport } from "./judge-runner.js";
import { checkOutputProperties, type OutputPropertyReport, type OutputPropertySpec } from "./output-properties.js";
import type { ModelFamilyProfile, ModelProtocolAdapter, SurfaceCheckResult, SurfaceVerifierAdapter, SurfaceVerifierContext } from "./ports.js";
import { runDeterministicShell, type ShellFeature, type ShellInput, type ShellReport } from "./shell-verifier.js";
import { assertThreshold, type ProductQualityDecisionNode } from "./threshold.js";
import type { ReplayCassette } from "./cassette.js";

export interface AiFeatureVerifierOptions {
  readonly generator: ModelFamilyProfile;
  readonly judge: ModelFamilyProfile;
  readonly connectedFamilies: readonly ModelFamilyProfile[];
  readonly threshold: ProductQualityDecisionNode;
  readonly developerAllowsDependents?: boolean;
  readonly judgeSamples?: number;
  readonly cassette?: ReplayCassette;
  readonly mode?: "live" | "replay";
  readonly judgeAdapter?: ModelProtocolAdapter;
}

export interface AiSurfaceInput {
  readonly shell?: {
    readonly feature: ShellFeature;
    readonly input: ShellInput;
    readonly stub: ModelProtocolAdapter;
  };
  readonly output?: {
    readonly value: unknown;
    readonly spec: OutputPropertySpec;
  };
  readonly judge?: {
    readonly cases: readonly EvalCase[];
    readonly adapter: ModelProtocolAdapter;
    readonly threshold?: ProductQualityDecisionNode;
  };
}

export class AiFeatureVerifier implements SurfaceVerifierAdapter {
  readonly surface = "ai_eval" as const;
  readonly generatorProfile: ModelFamilyProfile;
  readonly judgeProfile: ModelFamilyProfile;
  readonly warnings: readonly string[];
  readonly judgeSelection: JudgeSelection;
  private readonly threshold: ProductQualityDecisionNode;
  private readonly developerAllowsDependents: boolean;
  private readonly judgeSamples: number;
  private readonly cassette: ReplayCassette | undefined;
  private readonly mode: "live" | "replay";
  private readonly judgeAdapter: ModelProtocolAdapter | null;

  constructor(options: AiFeatureVerifierOptions) {
    assertThreshold(options.threshold);
    const selected = selectJudgeProfile(options.generator, options.judge, options.connectedFamilies);
    this.generatorProfile = options.generator;
    this.judgeProfile = selected.judge;
    this.warnings = selected.warnings;
    this.judgeSelection = selected.selection;
    this.threshold = options.threshold;
    this.developerAllowsDependents = options.developerAllowsDependents === true;
    this.judgeSamples = options.judgeSamples ?? 1;
    this.cassette = options.cassette;
    this.mode = options.mode ?? "live";
    this.judgeAdapter = options.judgeAdapter ?? null;
  }

  async runShell(feature: ShellFeature, input: ShellInput, stub: ModelProtocolAdapter): Promise<ShellReport> {
    return runDeterministicShell(feature, input, stub, this.warnings);
  }

  checkOutput(value: unknown, spec: OutputPropertySpec): OutputPropertyReport {
    return checkOutputProperties(value, spec);
  }

  async runJudge(
    cases: readonly EvalCase[],
    judge: ModelProtocolAdapter = this.requireJudgeAdapter(),
    threshold: ProductQualityDecisionNode = this.threshold,
  ): Promise<JudgeRunReport> {
    this.assertJudgeAdapter(judge);
    return runJudgeEval({
      cases,
      judge,
      threshold,
      samples: this.judgeSamples,
      mode: this.mode,
      ...(this.cassette ? { cassette: this.cassette } : {}),
      warnings: this.warnings,
      generatorFamily: this.generatorProfile.family,
      judgeFamily: this.judgeProfile.family,
      developerAllowsDependents: this.developerAllowsDependents,
    });
  }

  async verify(context: SurfaceVerifierContext): Promise<readonly SurfaceCheckResult[]> {
    const input = readSurfaceInput(context.surfaceInput);
    if (!input) {
      return [
        {
          checkId: `${context.taskId}:ai_eval`,
          status: "skip",
          receipt: { reason: "missing_ai_eval_input" },
        },
      ];
    }
    const results: SurfaceCheckResult[] = [];
    if (input.shell) {
      const report = await this.runShell(input.shell.feature, input.shell.input, input.shell.stub);
      results.push({
        checkId: `${context.taskId}:shell`,
        status: report.status === "shell_error" ? "error" : "pass",
        receipt: report,
      });
    }
    if (input.output) {
      const report = this.checkOutput(input.output.value, input.output.spec);
      results.push({
        checkId: `${context.taskId}:output_properties`,
        status: report.passed ? "pass" : "fail",
        receipt: report,
      });
    }
    if (input.judge) {
      const report = await this.runJudge(input.judge.cases, input.judge.adapter, input.judge.threshold ?? this.threshold);
      results.push({
        checkId: `${context.taskId}:judge`,
        status:
          report.taskStatus === "verified_except_quality" ? "pending" : report.taskStatus === "pass" ? "pass" : "fail",
        receipt: report,
      });
    }
    return results;
  }

  private requireJudgeAdapter(): ModelProtocolAdapter {
    if (!this.judgeAdapter) throw new Error("judge adapter is required");
    return this.judgeAdapter;
  }

  private assertJudgeAdapter(judge: ModelProtocolAdapter): void {
    if (judge.profile.family !== this.judgeProfile.family) {
      throw new JudgeFamilyError(
        `judge adapter family ${judge.profile.family} does not match selected judge family ${this.judgeProfile.family}`,
      );
    }
  }
}

function readSurfaceInput(value: unknown): AiSurfaceInput | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("shell" in value) && !("output" in value) && !("judge" in value)) return undefined;
  return value as AiSurfaceInput;
}
