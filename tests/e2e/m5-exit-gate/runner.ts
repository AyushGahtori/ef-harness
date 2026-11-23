import fs from "node:fs";
import path from "node:path";
import { ResumeChangerBenchmarkVerifier, loadGuidedChangeFixture } from "./brownfield.ts";
import { loadResumeChangerManifest } from "./manifest.ts";
import { OfficeTruthfulnessCertifier } from "./office.ts";
import { benchmarkJsonPath, fixtureJsonPath } from "./paths.ts";
import { M5ExitGateReport } from "./report.ts";
import type { M5Faults } from "./types.ts";
import { resolveFaults } from "./types.ts";
import { M5InteractiveUxE2eSuite } from "./ux.ts";

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
  const brownfield = new ResumeChangerBenchmarkVerifier().verify(manifest, fixture, faults);
  const ux = new M5InteractiveUxE2eSuite().run(faults);
  const office = new OfficeTruthfulnessCertifier().certify(faults);
  const hostElapsedMs = performance.now() - started;
  return M5ExitGateReport.evaluate({ ...brownfield, ...ux, ...office }, hostElapsedMs);
}

export function runLiveCertification(env: Readonly<Record<string, string | undefined>>): M5ExitGateReport {
  const root = env.EF_M5_RESUME_CHANGER_ROOT;
  const seen = typeof root === "string" && root.length > 0 && fs.existsSync(root) && fs.statSync(root).isDirectory();
  if (seen && root) {
    const head = path.join(root, ".git", "HEAD");
    if (fs.existsSync(head)) fs.readFileSync(head, "utf8");
  }
  return M5ExitGateReport.live(seen);
}
