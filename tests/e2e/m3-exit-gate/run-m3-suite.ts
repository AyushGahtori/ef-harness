import { M3ParallelBenchmarkRunner, runLiveCertification } from "./runner.js";

const live = process.argv.includes("--live");
if (live) {
  const result = runLiveCertification();
  process.stderr.write(`${result.reason}\n`);
  process.exit(result.claimedCertification ? 0 : 2);
}

const report = await new M3ParallelBenchmarkRunner().run();
process.stdout.write(
  `${JSON.stringify({ exitCode: report.gate.exitCode, speedupRatio: report.speedupRatio, passRateDelta: report.passRateDelta })}\n`,
);
process.exit(report.gate.exitCode);
