import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSecurityAudit, writeCertificationArtifacts } from "./runner.ts";

const dir =
  process.argv.includes("--write")
    ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "artifacts")
    : undefined;

const report = await runSecurityAudit();
if (dir) writeCertificationArtifacts(dir, report);
process.stdout.write(`${report.scorecardMarkdown}\n`);
process.exit(report.exitCode);