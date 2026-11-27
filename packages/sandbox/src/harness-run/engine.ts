import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WindowsJobManager as OsWindowsJobManager } from "../job-objects/windows-job-manager.js";
import type { JobHandle, JobSpec } from "../job-objects/types.js";
import type { SandboxTierSelector as IsolationTierSelector } from "../tier-c-d-selector/selector.js";
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
import { CommandDeniedError, CommandLaunchError, CwdEscapeDeniedError, SandboxTierHoldError } from "./errors.js";
import { computeFailureFingerprint } from "./fingerprint.js";
import { PosixCommandJobManager } from "./posix-command.js";
import { WarmExecutionPool } from "./pool.js";
import { StreamingSecretRedactor } from "./redactor.js";
import { serverRejectionHint } from "./server-hint.js";
import { OutputSummarizer } from "./summarizer.js";
import { InMemoryLocalTracer, TelemetryDb } from "./telemetry.js";
import type {
  ArtifactManager,
  CommandJob,
  DenialLogger,
  JobLimits,
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

export interface OsCommandSupervisor {
  createJob(spec: JobSpec): Promise<JobHandle>;
  closeJob(job: JobHandle): Promise<void>;
}

export interface HarnessRunEngineDeps {
  readonly selector?: SandboxTierSelector;
  readonly jobs?: WindowsJobManager;
  readonly isolation?: IsolationTierSelector;
  readonly osJobs?: OsCommandSupervisor;
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
  private readonly isolation: IsolationTierSelector | null;
  private readonly osJobs: OsCommandSupervisor | null;

  constructor(deps: HarnessRunEngineDeps = {}) {
    this.pool = deps.selector === undefined ? new WarmExecutionPool() : null;
    this.selector = deps.selector ?? this.pool ?? new WarmExecutionPool();
    this.jobs = deps.jobs ?? new PosixCommandJobManager();
    this.isolation = deps.isolation ?? null;
    this.osJobs = deps.osJobs ?? null;
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
    let tier: SandboxTier = "UNSANDBOXED";
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
    bind({ tier: "UNSANDBOXED", mode: slot.mode });
    const limits: JobLimits = {
      memoryBytes: request.memoryBytes ?? DEFAULT_MEMORY_BYTES,
      activeProcessLimit: request.processLimit ?? DEFAULT_PROCESS_LIMIT,
      killOnJobClose: true,
      timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
    let job: CommandJob | null = null;
    let osHandle: JobHandle | null = null;
    let reportedTier: SandboxTier = "UNSANDBOXED";
    let reportedMode = slot.mode;
    try {
      const isolated = await this.resolveIsolation(request, commandId, decision.segments);
      if (isolated) {
        reportedTier = isolated.tier;
        reportedMode = isolated.mode;
        bind({ tier: reportedTier, mode: reportedMode });
      }
      osHandle = await this.openOsJob(commandId, limits);
      job = this.jobs.createJob(limits);
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
        tier: reportedTier,
        mode: reportedMode,
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
      job?.close();
      if (osHandle && this.osJobs) await this.osJobs.closeJob(osHandle);
      slot.release();
    }
  }

  private async resolveIsolation(
    request: SandboxedCommandRequest,
    commandId: string,
    segments: readonly PolicySegment[],
  ): Promise<{ tier: SandboxTier; mode: SandboxedCommandResult["mode"] } | null> {
    if (!this.isolation) return null;
    const argv = segments[0]?.argv ?? [];
    const executable = argv[0] ?? commandTextOf(request.command);
    const decision = await this.isolation.resolve({
      task: {
        taskId: request.taskId ?? request.attemptId,
        attemptId: request.attemptId,
        projectId: request.projectId ?? request.attemptId,
        projectPath: request.worktreePath,
        worktreePath: request.worktreePath,
        tempPath: request.attemptTempDir ?? request.worktreePath,
        commands: [request.command],
      },
      runtime: { kind: "own_loop", runtimeId: "harness-run" },
      command: {
        commandId,
        executable,
        args: argv.slice(1),
      },
    });
    if (decision.kind === "hold") throw new SandboxTierHoldError(decision.hold.explanation);
    return { tier: decision.tier, mode: decision.mode };
  }

  private async openOsJob(commandId: string, limits: JobLimits): Promise<JobHandle | null> {
    const supervisor = this.osJobs;
    if (!supervisor) return null;
    if (supervisor instanceof OsWindowsJobManager && process.platform !== "win32") {
      throw new CommandLaunchError("Windows Job Objects require win32");
    }
    const spec: JobSpec = {
      name: `harness-run-${commandId}`,
      kind: "command",
      limits: {
        memoryBytes: limits.memoryBytes,
        activeProcessLimit: limits.activeProcessLimit,
      },
      timeoutMs: limits.timeoutMs,
    };
    return supervisor.createJob(spec);
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
