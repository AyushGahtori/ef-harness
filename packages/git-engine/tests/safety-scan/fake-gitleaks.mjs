import fs from "node:fs";

const args = process.argv.slice(2);

function flag(name) {
  const index = args.indexOf(name);
  if (index < 0) return "";
  return args[index + 1] ?? "";
}

const reportPath = flag("--report-path");
const mode = process.env.FAKE_GITLEAKS_MODE ?? "clean";
const argvOut = process.env.FAKE_GITLEAKS_ARGV_OUT;
if (argvOut) fs.writeFileSync(argvOut, JSON.stringify(process.argv));

if (mode === "hang") {
  setInterval(() => {}, 1_000);
} else if (mode === "crash") {
  process.stderr.write("quarantine\n");
  process.exit(2);
} else if (mode === "bad-json") {
  if (reportPath) fs.writeFileSync(reportPath, "{");
  process.exit(1);
} else if (mode === "findings") {
  const secret = process.env.FAKE_GITLEAKS_SECRET ?? "synthetic-secret-value";
  const finding = [
    {
      File: process.env.FAKE_GITLEAKS_FILE ?? "secret.txt",
      StartLine: Number(process.env.FAKE_GITLEAKS_LINE ?? "1"),
      RuleID: "generic-api-key",
      Secret: secret,
      Match: secret,
      Description: secret,
    },
  ];
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(finding));
  process.exit(1);
} else if (reportPath) {
  fs.writeFileSync(reportPath, "[]");
  process.exit(0);
} else {
  process.exit(0);
}
