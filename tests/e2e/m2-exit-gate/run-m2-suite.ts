import { releaseSpecExpansionZ3 } from "@ef-harness/spec-expansion";
import { runCertifiedReplay, runLiveCertification } from "./runner.js";
import { renderReport } from "./report.js";

async function main(): Promise<number> {
  try {
    if (process.argv.includes("--live")) {
      const live = await runLiveCertification();
      process.stdout.write(`${JSON.stringify(live)}\n`);
      return live.claimedCertification ? 0 : 2;
    }
    const report = await runCertifiedReplay();
    process.stdout.write(`${renderReport(report)}\n`);
    return report.gate.exitCode;
  } finally {
    await releaseSpecExpansionZ3();
  }
}

main().then((code) => {
  process.exit(code);
}).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
