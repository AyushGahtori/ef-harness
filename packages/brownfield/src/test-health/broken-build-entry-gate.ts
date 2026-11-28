import type { BrokenBuildChoice, BrokenBuildGateResult, CommandReceipt } from "./types.js";

const DEFAULT_CHOICES: readonly BrokenBuildChoice[] = [
  "fix_baseline_first",
  "inspect_environment",
  "proceed_scoped_anyway",
];

/**
 * Stops feature work when the untouched baseline cannot compile, build, or typecheck.
 */
export class BrokenBuildEntryGate {
  evaluate(preFlight: readonly CommandReceipt[]): BrokenBuildGateResult {
    const order: CommandReceipt["commandId"][] = ["typecheck", "build", "lint"];
    for (const commandId of order) {
      const receipt = preFlight.find((r) => r.commandId === commandId);
      if (!receipt) continue;
      if (receipt.exitCode !== 0) {
        const compilerErrors = extractCompilerErrors(receipt.reporterOutput ?? "");
        return {
          blocked: true,
          failedCommand: receipt,
          choices: DEFAULT_CHOICES,
          compilerErrors,
        };
      }
    }
    return { blocked: false, failedCommand: null, choices: [], compilerErrors: [] };
  }
}

function extractCompilerErrors(output: string): string[] {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errors = lines.filter(
    (l) =>
      /error TS\d+:/i.test(l) ||
      /^error:/i.test(l) ||
      /SyntaxError:/i.test(l) ||
      /Cannot find module/i.test(l),
  );
  return errors.length > 0 ? errors.slice(0, 12) : lines.slice(0, 8);
}