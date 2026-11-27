import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HarnessRunEngine } from "@ef-harness/sandbox";

/** A sandboxed command engine with a private telemetry file so parallel tests do not share one database. */
export function openHarnessRunEngine(): HarnessRunEngine {
  const root = mkdtempSync(path.join(tmpdir(), "ef-run-"));
  return new HarnessRunEngine({
    telemetryDbPath: path.join(root, "telemetry.db"),
    artifactRoot: path.join(root, "artifacts"),
  });
}
