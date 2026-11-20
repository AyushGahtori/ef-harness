import { runSpike } from "./src/spike.mjs";

const fileCountFlag = process.argv.indexOf("--file-count");
const fileCount = fileCountFlag >= 0 ? Number(process.argv[fileCountFlag + 1]) : 10000;
const report = await runSpike({
  fileCount,
  allowElevatedTierB: process.argv.includes("--allow-elevated-tier-b-test"),
  writeReport: true,
});
process.stdout.write(`wrote spikes/windows-sandbox/report.json for build ${report.host.osBuild}\n`);
process.stdout.write(`job close ${report.job.close.elapsedMs}ms, tier C ran ${report.tierC.ran}\n`);
