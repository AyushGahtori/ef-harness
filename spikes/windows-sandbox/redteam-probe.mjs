import { runSpike } from "./src/spike.mjs";

const fileCountFlag = process.argv.indexOf("--file-count");
const fileCount = fileCountFlag >= 0 ? Number(process.argv[fileCountFlag + 1]) : 10000;
const allowElevatedTierB = process.argv.includes("--allow-elevated-tier-b-test");
const report = await runSpike({
  fileCount,
  allowElevatedTierB,
  writeReport: true,
});
process.stdout.write(`${JSON.stringify(report.redteam, null, 2)}\n`);
const failed = report.redteam.some((row) => !String(row.detail).startsWith("not_run") && row.actuallyBlocked !== row.expectedBlocked);
process.exitCode = failed ? 1 : 0;
