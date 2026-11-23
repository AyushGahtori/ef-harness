import type { CodemodBackendPort, SandboxedRunnerPort } from "./ports.js";
import type { CodemodPlanStep, CodemodRunResult } from "./types.js";
import { CODEMOD_SANDBOX_TIMEOUT_MS } from "./types.js";

export type DeterministicCodemodRunnerOptions = {
  readonly sandbox: SandboxedRunnerPort;
  readonly codemods: CodemodBackendPort;
  readonly timeoutMs?: number;
};

export type TsMorphRenameInput = {
  readonly projectRoot: string;
  readonly oldName: string;
  readonly newName: string;
  readonly fileGlobs: readonly string[];
  readonly dryRun: boolean;
};

export class DeterministicCodemodRunner {
  private readonly sandbox: SandboxedRunnerPort;
  private readonly codemods: CodemodBackendPort;
  private readonly timeoutMs: number;

  constructor(options: DeterministicCodemodRunnerOptions) {
    this.sandbox = options.sandbox;
    this.codemods = options.codemods;
    this.timeoutMs = options.timeoutMs ?? CODEMOD_SANDBOX_TIMEOUT_MS;
  }

  async runStep(projectRoot: string, step: CodemodPlanStep): Promise<CodemodRunResult> {
    if (step.engine === "ts-morph") {
      const rename = parseTsMorphRenameRule(step);
      return this.withSandbox(() =>
        this.codemods.runTsMorphRename({
          projectRoot,
          oldName: rename.oldName,
          newName: rename.newName,
          fileGlobs: step.scopeGlobs,
          dryRun: step.dryRun,
        }),
      );
    }
    if (step.engine === "ast-grep") {
      return this.withSandbox(() =>
        this.codemods.runAstGrepRule({
          projectRoot,
          ruleYaml: step.scopeGlobs[0] ?? "",
          dryRun: step.dryRun,
        }),
      );
    }
    return this.withSandbox(async () => {
      const script = step.scopeGlobs[0] ?? "noop.js";
      const result = await this.sandbox.run(
        projectRoot,
        "node",
        [script],
        this.timeoutMs,
      );
      if (result.exitCode !== 0) {
        return {
          ok: false,
          reason: "syntax_error",
          detail: result.stderr || result.stdout || `exit ${result.exitCode}`,
        };
      }
      return {
        ok: true,
        preview: { filesChanged: 0, linesAdded: 0, linesRemoved: 0, samplePaths: [] },
        applied: !step.dryRun,
      };
    });
  }

  async runTsMorphRename(input: TsMorphRenameInput): Promise<CodemodRunResult> {
    return this.withSandbox(() => this.codemods.runTsMorphRename(input));
  }

  private async withSandbox(fn: () => Promise<CodemodRunResult>): Promise<CodemodRunResult> {
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
    }, this.timeoutMs);
    try {
      const result = await fn();
      if (timedOut) {
        return { ok: false, reason: "timeout", detail: "codemod sandbox timeout" };
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: "sandbox_error", detail: message };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseTsMorphRenameRule(step: CodemodPlanStep): { oldName: string; newName: string } {
  const meta = step.scopeGlobs.find((g) => g.startsWith("rename:"));
  if (!meta) {
    throw new Error("ts-morph step requires rename:old->new metadata glob");
  }
  const body = meta.slice("rename:".length);
  const arrow = body.indexOf("->");
  if (arrow < 0) {
    throw new Error("ts-morph rename metadata must look like rename:Old->New");
  }
  return { oldName: body.slice(0, arrow), newName: body.slice(arrow + 2) };
}