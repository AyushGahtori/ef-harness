import { probeCliTool } from "./cli-probe.js";
import { probeDatabaseTarget } from "./database-url.js";
import { diagnoseCaught } from "./diagnosis.js";
import { probeDocker } from "./docker-probe.js";
import { isProbeTimeoutError, withProbeTimeout } from "./timeout.js";
import { probeDns, probeHttps } from "./external-probe.js";
import { HumanStepError } from "./errors.js";
import { probePlaywright } from "./playwright-probe.js";
import type {
  CommandRunner,
  DnsResolver,
  HttpProbe,
  KnowledgeGraphPort,
  ProbeLogger,
  SharedQuestionArbiter,
  WindowsDpapiSecretsVault,
} from "./ports.js";
import type { ChromiumLaunch } from "./playwright-probe.js";
import type { HumanStepStateStore } from "./store.js";
import { PROBE_TIMEOUT_DIAGNOSIS, type HumanStepRecord, type ProbeResult } from "./types.js";

export interface ProbeDependencies {
  readonly store: HumanStepStateStore;
  readonly runner: CommandRunner;
  readonly vault: WindowsDpapiSecretsVault;
  readonly graph: KnowledgeGraphPort;
  readonly questions: SharedQuestionArbiter;
  readonly logger: ProbeLogger;
  readonly now: () => number;
  readonly timeoutMs: number;
  readonly launchChromium?: ChromiumLaunch;
  readonly dns: DnsResolver;
  readonly http: HttpProbe;
}

/**
 * Deterministic read-only probes. `verified` is stamped only when a probe
 * passes, and that stamp releases `waiting_on_human_step` in the same
 * transaction as the evidence write.
 */
export class HumanStepProbeRegistry {
  constructor(private readonly deps: ProbeDependencies) {}

  async checkAgain(stepId: string): Promise<ProbeResult> {
    const step = this.deps.store.require(stepId);
    if (step.resolution === "feature_skipped") {
      return this.synthetic(step, "fail", "FEATURE_SKIPPED", "This feature was skipped and is not verified");
    }
    if (step.probeSpec.kind === "unprobeable") {
      return this.synthetic(
        step,
        "fail",
        "UNPROBEABLE",
        "This step cannot be probed automatically — use I did this manually if you finished it",
      );
    }
    const previous = step.status;
    this.deps.store.markProbing(step.stepId);
    try {
      const result = await this.probe(step);
      this.deps.store.commitProbeResult(step.stepId, result, () => {
        if (result.outcome === "pass") this.recordOutcome(step, result.diagnosis, true);
      });
      return result;
    } catch (error) {
      const restore = previous === "probing" ? "pending" : previous;
      this.deps.store.restoreStatus(step.stepId, restore);
      throw error;
    }
  }

  async probe(step: HumanStepRecord): Promise<ProbeResult> {
    const started = this.deps.now();
    try {
      return await withProbeTimeout(this.deps.timeoutMs, (signal) => this.dispatch(step, signal));
    } catch (error) {
      const outcome = isProbeTimeoutError(error) ? "timeout" : "fail";
      const code = isProbeTimeoutError(error) ? "PROBE_TIMEOUT" : "PROBE_FAILED";
      const diagnosis = isProbeTimeoutError(error) ? PROBE_TIMEOUT_DIAGNOSIS : diagnoseCaught(error);
      return {
        outcome,
        code,
        diagnosis,
        durationMs: Math.max(0, this.deps.now() - started),
        checkedAt: this.deps.now(),
        evidence: { readOnly: true },
      };
    }
  }

  private async dispatch(step: HumanStepRecord, signal: AbortSignal): Promise<ProbeResult> {
    const spec = step.probeSpec;
    if (spec.kind === "docker") {
      return probeDocker({
        runner: this.deps.runner,
        timeoutMs: this.deps.timeoutMs,
        signal,
        now: this.deps.now,
        logger: this.deps.logger,
      });
    }
    if (spec.kind === "cli_tool") {
      return probeCliTool({
        tool: spec.tool,
        ...(spec.minimumVersion === undefined ? {} : { minimumVersion: spec.minimumVersion }),
        ...(spec.checkAuth === undefined ? {} : { checkAuth: spec.checkAuth }),
        runner: this.deps.runner,
        timeoutMs: this.deps.timeoutMs,
        signal,
        now: this.deps.now,
        logger: this.deps.logger,
      });
    }
    if (spec.kind === "playwright") {
      return probePlaywright({
        projectRoot: spec.projectRoot,
        ...(spec.browsersPath === undefined ? {} : { browsersPath: spec.browsersPath }),
        timeoutMs: this.deps.timeoutMs,
        signal,
        now: this.deps.now,
        logger: this.deps.logger,
        ...(this.deps.launchChromium === undefined ? {} : { launch: this.deps.launchChromium }),
      });
    }
    if (spec.kind === "database_url") {
      return probeDatabaseTarget({
        vault: this.deps.vault,
        secretId: spec.secretId,
        engine: spec.engine,
        timeoutMs: this.deps.timeoutMs,
        signal,
        now: this.deps.now,
        logger: this.deps.logger,
      });
    }
    if (spec.kind === "dns") {
      return probeDns({
        hostname: spec.hostname,
        recordType: spec.recordType,
        expected: spec.expected,
        resolver: this.deps.dns,
        now: this.deps.now,
        logger: this.deps.logger,
      });
    }
    if (spec.kind === "cloud_api" || spec.kind === "webhook") {
      return probeHttps({
        kind: spec.kind,
        url: spec.url,
        ...(spec.kind === "cloud_api" && spec.secretId !== undefined ? { secretId: spec.secretId } : {}),
        ...(spec.expectStatuses === undefined ? {} : { expectStatuses: spec.expectStatuses }),
        vault: this.deps.vault,
        http: this.deps.http,
        timeoutMs: this.deps.timeoutMs,
        signal,
        now: this.deps.now,
        logger: this.deps.logger,
      });
    }
    throw new HumanStepError("unprobeable", "This step cannot be probed automatically");
  }

  private recordOutcome(step: HumanStepRecord, quote: string, verified: boolean): void {
    if (step.graphNodeId) {
      const node = this.deps.graph.getNode(step.graphNodeId);
      if (node) {
        this.deps.graph.recordEvidence({
          node: node.id,
          nodeVersion: node.version,
          sourceKind: "repo",
          sourceRef: `human-step:${step.stepId}`,
          locator: { stepId: step.stepId },
          quote,
          verified,
        });
      }
    }
    if (step.questionId) this.deps.questions.retireQuestion(step.questionId, verified ? "probe" : "attestation", quote);
  }

  private synthetic(step: HumanStepRecord, outcome: ProbeResult["outcome"], code: string, diagnosis: string): ProbeResult {
    return {
      outcome,
      code,
      diagnosis,
      durationMs: 0,
      checkedAt: this.deps.now(),
      evidence: { stepId: step.stepId, readOnly: true },
    };
  }
}
