import { dockerFailureCode, dockerFailureDiagnosis } from "./diagnosis.js";
import type { CommandRunner, ProbeLogger } from "./ports.js";
import { PROBE_TIMEOUT_DIAGNOSIS, type ProbeResult } from "./types.js";

export const DOCKER_INFO_ARGS = ["info", "--format", "{{.ServerVersion}}"] as const;

export async function probeDocker(input: {
  readonly runner: CommandRunner;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly now: () => number;
  readonly logger: ProbeLogger;
}): Promise<ProbeResult> {
  const started = input.now();
  input.logger.write("docker_probe", { command: "docker info", readOnly: true });
  const result = await input.runner.run({
    file: "docker",
    args: DOCKER_INFO_ARGS,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  });
  const text = `${result.stdout}\n${result.stderr}`;
  if (result.timedOut || result.errorCode === "TIMEOUT" || result.errorCode === "ABORTED") {
    return done(input.now, started, "timeout", "PROBE_TIMEOUT", PROBE_TIMEOUT_DIAGNOSIS, { readOnly: true });
  }
  const version = result.stdout.trim();
  if (result.exitCode === 0 && version.length > 0) {
    return done(input.now, started, "pass", "RUNNING", `Docker Desktop is running (${version})`, {
      serverVersion: version,
      readOnly: true,
    });
  }
  const code = dockerFailureCode(text, result.errorCode);
  return done(input.now, started, "fail", code, dockerFailureDiagnosis(code), { readOnly: true });
}

function done(
  now: () => number,
  started: number,
  outcome: ProbeResult["outcome"],
  code: string,
  diagnosis: string,
  evidence: Record<string, string | number | boolean>,
): ProbeResult {
  return {
    outcome,
    code,
    diagnosis,
    durationMs: Math.max(0, now() - started),
    checkedAt: now(),
    evidence,
  };
}
