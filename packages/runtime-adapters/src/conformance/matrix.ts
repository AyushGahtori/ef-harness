import { createConformanceStack } from "./runner.js";
import type { ConformanceStack } from "./runner.js";
import {
  DISABLED_ROGUES,
  FOREIGN_ADAPTERS,
  STRIPPED_ROGUES,
  compliantBehavior,
  rogueBehavior,
} from "./profiles.js";
import type { ConformanceReport } from "./types.js";

export interface MatrixResult {
  readonly reports: readonly ConformanceReport[];
  readonly allTenOfTen: boolean;
  readonly durationMs: number;
}

export interface RogueGauntletResult {
  readonly stripped: readonly ConformanceReport[];
  readonly disabled: readonly ConformanceReport[];
}

export interface ConformanceCliResult {
  readonly exitCode: number;
  readonly matrix: MatrixResult;
  readonly rogues: RogueGauntletResult;
}

/** Runs all 7 foreign adapters through the same 10-probe suite. */
export async function runConformanceMatrix(stack: ConformanceStack = createConformanceStack()): Promise<MatrixResult> {
  const started = performance.now();
  const reports = [];
  for (const profile of FOREIGN_ADAPTERS) {
    reports.push(
      await stack.runner.run({
        behavior: compliantBehavior(profile),
        trigger: "first_enable",
        driver: "synthetic",
        sandboxTier: "A",
      }),
    );
  }
  return {
    reports,
    allTenOfTen: reports.every(
      (report) =>
        report.trust === "conformance_verified" &&
        report.mode === "wrapped" &&
        report.nativeResumeSupported &&
        report.probes.length === 10 &&
        report.probes.every((probe) => probe.status === "pass"),
    ),
    durationMs: performance.now() - started,
  };
}

/** Four hook/process rogues downgrade to stripped. Four that still escape downgrade to disabled. */
export async function runRogueGauntlet(stack: ConformanceStack = createConformanceStack()): Promise<RogueGauntletResult> {
  const [stripped, disabled] = await Promise.all([
    Promise.all(
      STRIPPED_ROGUES.map((profile) =>
        stack.runner.run({
          behavior: rogueBehavior(profile),
          trigger: "cli_version_change",
          driver: "synthetic",
          sandboxTier: "A",
        }),
      ),
    ),
    Promise.all(
      DISABLED_ROGUES.map((profile) =>
        stack.runner.run({
          behavior: rogueBehavior(profile),
          trigger: "cli_version_change",
          driver: "synthetic",
          sandboxTier: "A",
        }),
      ),
    ),
  ]);
  return { stripped, disabled };
}

/**
 * In-process entry for `pnpm test:conformance`.
 * The package script is frozen with the foundation package.json, so the
 * integrator wires the script name. `pnpm --filter @ef-harness/runtime-adapters test -- conformance`
 * already executes this suite.
 */
export async function runConformanceCli(stack?: ConformanceStack): Promise<ConformanceCliResult> {
  const shared = stack ?? createConformanceStack();
  const matrix = await runConformanceMatrix(shared);
  const rogues = await runRogueGauntlet(shared);
  const strippedOk = rogues.stripped.every(
    (report) => report.trust === "conformance_verified" && report.mode === "stripped" && report.probes.every((probe) => probe.status === "pass"),
  );
  const disabledOk = rogues.disabled.every((report) => report.trust === "disabled");
  const exitCode = matrix.allTenOfTen && strippedOk && disabledOk ? 0 : 1;
  return { exitCode, matrix, rogues };
}
