import fs from "node:fs";
import path from "node:path";
import type { HiddenCheckResult } from "./types.ts";

export interface ForensicsInput {
  checks: HiddenCheckResult[];
  screenshot: Buffer | null;
  dbPath: string;
  audit: { staticAuditFailures: number; secretsFound: number; leakedPids: number };
}

export function writeFailureForensics(dir: string, input: ForensicsInput): string[] {
  fs.mkdirSync(dir, { recursive: true });
  const failing = input.checks.filter((check) => !check.pass);
  const written = [
    path.join(dir, "failing-checks.json"),
    path.join(dir, "audit-receipts.json"),
    path.join(dir, "db-snapshot"),
  ];
  fs.writeFileSync(written[0] ?? "", JSON.stringify({ failing }, null, 2));
  fs.writeFileSync(
    written[1] ?? "",
    JSON.stringify(
      {
        staticAuditFailures: input.audit.staticAuditFailures,
        secretsFound: input.audit.secretsFound,
        leakedPids: input.audit.leakedPids,
      },
      null,
      2,
    ),
  );
  fs.mkdirSync(written[2] ?? dir, { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const source = `${input.dbPath}${suffix}`;
    if (!fs.existsSync(source)) continue;
    fs.copyFileSync(source, path.join(written[2] ?? dir, `kitchen.db${suffix}`));
  }
  if (input.screenshot) {
    const shot = path.join(dir, "screenshot.png");
    fs.writeFileSync(shot, input.screenshot);
    written.push(shot);
  }
  return written;
}

export const FORENSICS_DIR = "benchmarks/m2-kitchen-e2e/artifacts";
