import { LocalHarnessRunEngine, type HarnessRunEngine } from "./ports/harness-run.js";
import { environmentFailure, implementationFailure, parseCheck, passing } from "./result.js";
import { CliSurfaceCheckSchema } from "./schemas.js";
import type { SurfaceCheckResult, SurfaceCheckVerifier, SurfaceVerifierContext } from "./types.js";

export interface CliSurfaceDependencies {
  readonly harnessRun?: HarnessRunEngine;
}

export class CliSurfaceVerifier implements SurfaceCheckVerifier {
  readonly id = "cli-surface";
  readonly surface = "cli";

  constructor(private readonly dependencies: CliSurfaceDependencies = {}) {}

  async verify(spec: unknown, context: SurfaceVerifierContext): Promise<readonly SurfaceCheckResult[]> {
    const parsed = parseCheck(CliSurfaceCheckSchema, spec, context);
    if (!parsed.ok) return parsed.results;
    const check = parsed.value;
    const engine = this.dependencies.harnessRun ?? new LocalHarnessRunEngine();
    try {
      const result = await engine.executeSandboxedCommand({
        command: check.command,
        ...(check.cwd ? { cwd: check.cwd } : {}),
      });
      const results: SurfaceCheckResult[] = [];
      const exitId = `${check.checkId}:exit`;
      if (result.timedOut) {
        results.push(environmentFailure(exitId, context, "CLI command timed out"));
      } else if (result.exitCode !== check.expectExitCode) {
        results.push(
          implementationFailure(exitId, context, `exit ${result.exitCode} !== ${check.expectExitCode}`, {
            stdout: result.stdout,
            stderr: result.stderr,
          }),
        );
      } else {
        results.push(passing(exitId, context, `exit code ${result.exitCode}`, { exitCode: result.exitCode }));
      }

      const stdoutId = `${check.checkId}:stdout`;
      if (check.stdout.format === "json") {
        try {
          const parsedStdout = JSON.parse(result.stdout.trim()) as unknown;
          const missing = (check.stdout.jsonRequiredKeys ?? []).filter((key) => {
            return typeof parsedStdout !== "object" || parsedStdout === null || !(key in parsedStdout);
          });
          if (missing.length > 0) {
            results.push(
              implementationFailure(stdoutId, context, `JSON stdout missing ${missing.join(", ")}`, {
                stdout: result.stdout,
              }),
            );
          } else {
            results.push(passing(stdoutId, context, "stdout is strict JSON with no stderr leakage", {
              format: "json",
            }));
          }
        } catch {
          results.push(
            implementationFailure(
              stdoutId,
              context,
              "stdout is not strict JSON; warnings must stay on stderr",
              { stdout: result.stdout, stderr: result.stderr },
            ),
          );
        }
      } else if (result.stdout.length === 0) {
        results.push(implementationFailure(stdoutId, context, "text stdout was empty"));
      } else {
        results.push(passing(stdoutId, context, "stdout captured separately from stderr", { format: "text" }));
      }

      const stderrId = `${check.checkId}:stderr`;
      const lines = result.stderr.split(/\r?\n/).filter((line) => line.length > 0);
      if (lines.length === 0 && check.stderr.allowEmpty === false) {
        results.push(implementationFailure(stderrId, context, "stderr was empty"));
      } else if (check.stderr.linePattern) {
        const pattern = new RegExp(check.stderr.linePattern);
        const bad = lines.filter((line) => !pattern.test(line));
        if (bad.length > 0) {
          results.push(
            implementationFailure(stderrId, context, `stderr lines do not match the contract: ${bad.join(" | ")}`, {
              stderr: result.stderr,
            }),
          );
        } else {
          results.push(passing(stderrId, context, "stderr matches the contracted line format", { lines: lines.length }));
        }
      } else {
        results.push(passing(stderrId, context, "stderr was captured separately from stdout", { lines: lines.length }));
      }
      return results;
    } catch (error) {
      return [environmentFailure(check.checkId, context, error instanceof Error ? error.message : String(error))];
    }
  }
}
