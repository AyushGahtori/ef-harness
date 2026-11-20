import { runCertifiedReplay, runLiveCertification } from "./runner.ts";
import { renderReport } from "./report.ts";

async function main(): Promise<number> {
  if (process.argv.includes("--live")) {
    const live = await runLiveCertification();
    process.stdout.write(`${JSON.stringify(live)}\n`);
    return live.claimedCertification ? 0 : 2;
  }
  const report = await runCertifiedReplay();
  process.stdout.write(`${renderReport(report)}\n`);
  return report.gate.exitCode;
}

main().then((code) => {
  process.exit(code);
}).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
