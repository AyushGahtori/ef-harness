import { runLiveCertification, runM5Certification } from "./runner.ts";

const invokedDirectly = process.argv[1]?.replaceAll("\\", "/").endsWith("run-m5-suite.ts") === true;

if (invokedDirectly) {
  const live = process.argv.includes("--live");
  if (live) {
    const report = runLiveCertification(process.env);
    process.stdout.write(`${report.toJSON()}\n`);
    process.exitCode = report.exitCode;
  } else {
    const report = await runM5Certification();
    process.stdout.write(`${report.toJSON()}\n`);
    process.exitCode = report.exitCode;
  }
}
