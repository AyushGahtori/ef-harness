import { runLiveCertification, runM4Certification } from "./runner.js";

const live = process.argv.includes("--live");
if (live) {
  const result = runLiveCertification();
  process.stderr.write(`${result.reason}\n`);
  process.exit(result.exitCode);
}

const report = await runM4Certification();
process.stdout.write(`${report.toJSON()}\n`);
process.stdout.write(`${report.renderScorecard()}\n`);
process.exit(report.exitCode);
