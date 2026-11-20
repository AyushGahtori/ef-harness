import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalArtifactManager } from "./artifacts.js";
import { CommandOutputCapture } from "./capture.js";
import { CommandPolicyEvaluator, type PolicySegment } from "./command-policy.js";
import {
  DEFAULT_MAX_ARTIFACT_BYTES,
  DEFAULT_MEMORY_BYTES,
  DEFAULT_PROCESS_LIMIT,
  DEFAULT_TIMEOUT_MS,
} from "./constants.js";
import { resolveContainedCwd, resolveInsideWorktree } from "./cwd.js";
import { MemoryDenialLogger } from "./denial-log.js";
import { buildScrubbedEnv, envEntries, markNodeModulesReadOnly } from "./env.js";
import { CommandDeniedError, CwdEscapeDeniedError } from "./errors.js";
import { computeFailureFingerprint } from "./fingerprint.js";
import { NestedCommandJobManager } from "./job-host.js";
import { WarmExecutionPool } from "./pool.js";
import { StreamingSecretRedactor } from "./redactor.js";
import { serverRejectionHint } from "./server-hint.js";
import { OutputSummarizer } from "./summarizer.js";
import { InMemoryLocalTracer, TelemetryDb } from "./telemetry.js";
import type {
  ArtifactManager,
  DenialLogger,
  JobStep,
  LocalTracer,
  SandboxTier,
  SandboxTierSelector,
  SandboxedCommandRequest,
  SandboxedCommandResult,
  TelemetrySink,
  TerminationReason,
  WindowsJobManager,
} from "./types.js";

export interface HarnessRunEngineDeps {
  readonly selector?: SandboxTierSelector;
  readonly jobs?: WindowsJobManager;
  readonly artifacts?: ArtifactManager;
  readonly tracer?: LocalTracer;
  readonly denialLog?: DenialLogger;
  readonly telemetry?: TelemetrySink;
  readonly artifactRoot?: string;
  readonly telemetryDbPath?: string;
}

function commandTextOf(command: string | readonly string[]): string {
  return typeof command === "string" ? command : command.join(" ");
}

function safeId(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 80) : "attempt";
}

function mapOperator(operator: PolicySegment["operator"]): JobStep["operator"] {
  if (operator === "&&") return "and";
  if (operator === "||") return "or";
  if (operator === ";") return "semi";
  if (operator === "|") return "pipe";
  return "none";
}

export class HarnessRunEngine {
  private readonly selector: SandboxTierSelector;
  private readonly jobs: WindowsJobManager;
  private readonly artifacts: ArtifactManager;
  private readonly tracer: LocalTracer;
  private readonly denialLog: DenialLogger;
  private readonly telemetry: TelemetrySink;
  private readonly policy = new CommandPolicyEvaluator();
  private readonly ownsTelemetry: boolean;
  private readonly pool: WarmExecutionPool | null;

  constructor(deps: HarnessRunEngineDeps = {}) {
    this.pool = deps.selector === undefined ? new WarmExecutionPool() : null;
    this.selector = deps.selector ?? this.pool ?? new WarmExecutionPool();
    this.jobs = deps.jobs ?? new NestedCommandJobManager();
    this.artifacts =
      deps.artifacts ??
      new LocalArtifactManager(deps.artifactRoot ?? path.join(os.tmpdir(), "ef-harness-artifacts"));
    this.tracer = deps.tracer ?? new InMemoryLocalTracer();
    this.denialLog = deps.denialLog ?? new MemoryDenialLogger();
    if (deps.telemetry !== undefined) {
      this.telemetry = deps.telemetry;
      this.ownsTelemetry = false;
    } else {
      this.telemetry = new TelemetryDb(
        deps.telemetryDbPath ?? path.join(os.tmpdir(), "ef-harness-telemetry", "telemetry.db"),
      );
      this.ownsTelemetry = true;
    }
  }

  async executeSandboxedCommand(request: SandboxedCommandRequest): Promise<SandboxedCommandResult> {
    const started = performance.now();
    const span =
      request.traceParentId !== undefined
        ? this.tracer.startSpan("harness.run", request.traceParentId)
        : this.tracer.startSpan("harness.run");
    let tier: SandboxTier = "C";
    let mode = "own_loop";
    try {
      const result = await this.run(request, (binding) => {
        tier = binding.tier;
        mode = binding.mode;
      });
      span.end(result.exitCode === 0 && !result.timedOut && !result.outputLimitExceeded ? "ok" : "error", {
        tier: result.tier,
        mode: result.mode,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        peakMemoryBytes: result.peakMemoryBytes,
        truncated: result.truncated,
        omittedLines: result.omittedLines,
        artifactId: result.artifactId,
      });
      return result;
    } catch (error) {
      const redactor = new StreamingSecretRedactor(request.secrets ?? []);
      span.end("error", {
        tier,
        mode,
        durationMs: Math.max(0, performance.now() - started),
        exitCode: -1,
        peakMemoryBytes: 0,
        truncated: false,
        omittedLines: 0,
        artifactId: "",
        message: redactor.redact(error instanceof Error ? error.message : String(error)),
      });
      throw error;
    }
  }

  close(): void {
    if (this.ownsTelemetry) this.telemetry.close();
    this.pool?.close();
  }

  private async run(
    request: SandboxedCommandRequest,
    bind: (binding: { tier: SandboxTier; mode: SandboxedCommandResult["mode"] }) => void,
  ): Promise<SandboxedCommandResult> {
    const started = performance.now();
    const commandId = randomBytes(8).toString("hex");
    const text = commandTextOf(request.command);
    const safeCommand = new StreamingSecretRedactor(request.secrets ?? []).redact(text);
    const at = new Date().toISOString();
    let cwd: string;
    try {
      cwd = resolveContainedCwd(request.worktreePath, request.cwd);
    } catch (error) {
      if (error instanceof CwdEscapeDeniedError) {
        this.denialLog.logDenial({
          rule: error.rule,
          reason: error.reason,
          command: safeCommand,
          attemptId: request.attemptId,
          at,
        });
      }
      throw error;
    }
    const decision = this.policy.evaluate({
      command: request.command,
      worktreePath: request.worktreePath,
      cwd,
    });
    if (!decision.allowed) {
      for (const denial of decision.denials) {
        this.denialLog.logDenial({
          rule: denial.rule,
          reason: denial.reason,
          command: safeCommand,
          attemptId: request.attemptId,
          at,
        });
      }
      const first = decision.denials[0];
      throw new CommandDeniedError(first?.rule ?? "not_allowlisted", first?.reason ?? "command denied");
    }
    const slot = await this.selector.acquire({
      priority: request.priority ?? "worker",
      attemptId: request.attemptId,
    });
    bind({ tier: slot.tier, mode: slot.mode });
    const job = this.jobs.createJob({
      memoryBytes: request.memoryBytes ?? DEFAULT_MEMORY_BYTES,
      activeProcessLimit: request.processLimit ?? DEFAULT_PROCESS_LIMIT,
      killOnJobClose: true,
      timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    try {
      markNodeModulesReadOnly(request.worktreePath);
      const attemptTemp =
        request.attemptTempDir ?? path.join(os.tmpdir(), "ef-harness-attempts", safeId(request.attemptId));
      fs.mkdirSync(attemptTemp, { recursive: true });
      const env = envEntries(buildScrubbedEnv(process.env, attemptTemp));
      const summarizer = new OutputSummarizer();
      const capture = new CommandOutputCapture(
        request.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES,
        request.secrets ?? [],
        summarizer,
        (event) => this.telemetry.writeProgress(request.attemptId, event),
        commandId,
      );
      const run = await job.run(
        {
          cwd,
          env,
          steps: decision.segments.map((segment) => this.toStep(segment, request.worktreePath, cwd)),
        },
        {
          onStdout: (chunk) => capture.onStdout(chunk),
          onStderr: (chunk) => capture.onStderr(chunk),
          shouldAbort: () => capture.shouldAbort(),
        },
      );
      const finished = capture.finish();
      const artifact = await this.artifacts.storeArtifact({
        body: finished.body,
        retention: "ephemeral",
        attemptId: request.attemptId,
        kind: "command_output",
      });
      const summary = summarizer.finalize(artifact.artifactId);
      const output = finished.body.toString("utf8");
      const timedOut = run.timedOut;
      const outputLimitExceeded = run.outputLimitExceeded || finished.outputLimited;
      const terminationReason: TerminationReason = outputLimitExceeded
        ? "output_limit_exceeded"
        : run.oomKilled
          ? "memory_limit_exceeded"
          : timedOut
            ? "timeout"
            : "completed";
      const failing = run.exitCode !== 0;
      return {
        tier: slot.tier,
        mode: slot.mode,
        exitCode: run.exitCode,
        timedOut,
        oomKilled: run.oomKilled,
        artifactId: artifact.artifactId,
        omittedLines: summary.omittedLines,
        failureFingerprint: failing
          ? computeFailureFingerprint({
              exitCode: run.exitCode,
              commandText: text,
              output,
              timedOut,
              outputLimitExceeded,
            })
          : null,
        durationMs: Math.max(0, performance.now() - started),
        peakMemoryBytes: run.peakMemoryBytes,
        truncated: summary.truncated || outputLimitExceeded,
        outputLimitExceeded,
        terminationReason,
        summary: summary.summary,
        stdoutSummary: summary.stdoutSummary,
        stderrSummary: summary.stderrSummary,
        toolSummary: summary.toolSummary,
        hint: serverRejectionHint(text, output, timedOut),
        nodeModulesReadOnly: true,
        commandId,
      };
    } finally {
      job.close();
      slot.release();
    }
  }

  private toStep(segment: PolicySegment, worktreePath: string, cwd: string): JobStep {
    return {
      operator: mapOperator(segment.operator),
      argv: segment.argv,
      redirects: segment.redirects.map((redirect) => {
        if (redirect.kind === "merge_stderr") return { kind: redirect.kind, target: "&1" };
        return {
          kind: redirect.kind,
          target: resolveInsideWorktree(worktreePath, cwd, redirect.target) ?? redirect.target,
        };
      }),
    };
  }
}
