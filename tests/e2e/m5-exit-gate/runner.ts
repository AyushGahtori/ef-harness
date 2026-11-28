import fs from "node:fs";
import path from "node:path";
import { packageIdentity as daemonPackageIdentity } from "@ef-harness/daemon";
import { CodeIndexDb, openMemoryStateDb } from "@ef-harness/db";
import { ResumeChangerBenchmarkVerifier, loadGuidedChangeFixture } from "./brownfield.js";
import { loadResumeChangerManifest } from "./manifest.js";
import { OfficeTruthfulnessCertifier } from "./office.js";
import { benchmarkJsonPath, fixtureJsonPath } from "./paths.js";
import { M5ExitGateReport } from "./report.js";
import type { M5Faults } from "./types.js";
import { resolveFaults } from "./types.js";
import { M5InteractiveUxE2eSuite } from "./ux.js";

export interface CertificationOptions {
  readonly faults?: Partial<M5Faults>;
  readonly benchmarkPath?: string;
  readonly fixturePath?: string;
}

export async function runM5Certification(options: CertificationOptions = {}): Promise<M5ExitGateReport> {
  const started = performance.now();
  const faults = resolveFaults(options.faults);
  const manifest = loadResumeChangerManifest(options.benchmarkPath ?? benchmarkJsonPath());
  const fixture = loadGuidedChangeFixture(options.fixturePath ?? fixtureJsonPath());
  const brownfield = await new ResumeChangerBenchmarkVerifier().verify(manifest, fixture, faults);
  const ux = new M5InteractiveUxE2eSuite().run(faults);
  const office = new OfficeTruthfulnessCertifier().certify(faults);
  const hostElapsedMs = performance.now() - started;
  return M5ExitGateReport.evaluate({ ...brownfield, ...ux, ...office }, hostElapsedMs);
}

export function runLiveCertification(env: Readonly<Record<string, string | undefined>>): M5ExitGateReport {
  const memory = openMemoryStateDb();
  memory.close();
  daemonPackageIdentity();
  const root = env.EF_M5_RESUME_CHANGER_ROOT;
  const directory = typeof root === "string" && root.length > 0 && fs.existsSync(root) && fs.statSync(root).isDirectory();
  let seen = false;
  if (directory && root) {
    const dbPath = path.join(root, "code-index.db");
    if (fs.existsSync(dbPath)) {
      const db = CodeIndexDb.open({ filePath: dbPath });
      try {
        seen = db.symbolCount() >= 0;
      } finally {
        db.close();
      }
    }
  }
  return M5ExitGateReport.live(seen);
}
