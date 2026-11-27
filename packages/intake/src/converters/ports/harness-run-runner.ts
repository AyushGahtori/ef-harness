import { chmodSync, existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HarnessRunEngine, LocalArtifactManager, type HarnessRunEngineDeps } from "@ef-harness/sandbox";
import { ConverterProcessError } from "../errors.js";
import type { SandboxRunRequest, SandboxRunResult, SandboxRunner } from "./sandbox-runner.js";

const quietTelemetry = {
  writeProgress() {
    return;
  },
  close() {
    return;
  },
};

export interface HarnessRunBinding {
  readonly engine: HarnessRunEngine;
  readonly artifacts: LocalArtifactManager;
}

export function bindHarnessRun(artifactRoot: string, deps: HarnessRunEngineDeps = {}): HarnessRunBinding {
  const artifacts = deps.artifacts instanceof LocalArtifactManager ? deps.artifacts : new LocalArtifactManager(artifactRoot);
  const engine = new HarnessRunEngine({
    ...deps,
    artifacts,
    telemetry: deps.telemetry ?? quietTelemetry,
  });
  return { engine, artifacts };
}

/**
 * Runs the converter worker through `HarnessRunEngine`.
 * The worker reads a request file because the engine does not attach stdin.
 */
export class HarnessRunSandboxRunner implements SandboxRunner {
  constructor(
    private readonly engine: HarnessRunEngine,
    private readonly artifacts: LocalArtifactManager,
  ) {}

  async runIsolated(request: SandboxRunRequest): Promise<SandboxRunResult> {
    const requestPath = await writeRequest(request.stdin);
    const nodeModules = join(request.cwd, "node_modules");
    const previousMode = existsSync(nodeModules) ? statSync(nodeModules).mode : null;
    try {
      const result = await this.engine.executeSandboxedCommand({
        attemptId: `intake-${requestPath.slice(-12)}`,
        worktreePath: request.cwd,
        cwd: request.cwd,
        command: [request.command, ...request.args.map(filesystemArg), requestPath],
        timeoutMs: request.wallClockMs,
        memoryBytes: request.memoryLimitBytes,
      });
      const body = (await this.artifacts.readRaw(result.artifactId)).toString("utf8");
      const payload = readWorkerPid(body);
      return {
        exitCode: result.exitCode,
        stdout: body,
        stderr: "",
        pid: payload,
        jobAssigned: true,
        timedOut: result.timedOut,
        memoryLimitBytes: request.memoryLimitBytes,
        wallClockMs: request.wallClockMs,
      };
    } finally {
      if (previousMode !== null) chmodSync(nodeModules, previousMode);
    }
  }
}

async function writeRequest(stdin: string): Promise<string> {
  const parsed: unknown = JSON.parse(stdin);
  const inputPath =
    parsed !== null && typeof parsed === "object" && "inputPath" in parsed && typeof parsed.inputPath === "string"
      ? parsed.inputPath
      : "";
  if (!inputPath) throw new ConverterProcessError("Converter request is missing inputPath.");
  const requestPath = join(dirname(inputPath), "converter-request.json");
  await mkdir(dirname(requestPath), { recursive: true });
  await writeFile(requestPath, stdin);
  return requestPath;
}

function filesystemArg(arg: string): string {
  if (arg.startsWith("file:")) return fileURLToPath(arg);
  return arg;
}

function readWorkerPid(stdout: string): number {
  const trimmed = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .at(-1);
  if (!trimmed) return 0;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === "object" && "pid" in parsed && typeof parsed.pid === "number") {
      return parsed.pid;
    }
  } catch {
    return 0;
  }
  return 0;
}
