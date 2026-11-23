import fs from "node:fs";
import path from "node:path";
import { runAreaA } from "./area-a.js";
import { runAreaB } from "./area-b.js";
import { runAreaC } from "./area-c.js";
import { runAreaD } from "./area-d.js";
import { runAreaE } from "./area-e.js";
import { runAreaF } from "./area-f.js";
import { runAreaG } from "./area-g.js";
import { runAreaH } from "./area-h.js";
import { runAreaI } from "./area-i.js";
import { runAreaJ } from "./area-j.js";
import { assertSettledCorpus } from "./corpus.js";
import { type EvidenceReceipt, type ReviewTrialsCertificationReport, writeReport } from "./report.js";
import { createContext, reviewTrialsDir, type TrialContext } from "./runtime.js";
import { scanDirectory } from "./skip-scan.js";
import { runTrial1, runTrial2, runTrial3, runTrial4, runTrial5, runTrial6 } from "./trials.js";

const RUNNERS: readonly {
  id: string;
  kind: "area" | "trial";
  title: string;
  file: string;
  run: (ctx: TrialContext) => Promise<readonly string[]>;
}[] = [
  { id: "A", kind: "area", title: "Storage, single-writer SQLite and crash safety", file: "area-a.test.ts", run: runAreaA },
  { id: "B", kind: "area", title: "Honest discovery, exact-quote grounding and acyclic entailment", file: "area-b.test.ts", run: runAreaB },
  { id: "C", kind: "area", title: "Context slicing, closed 28 tags and pull-to-push", file: "area-c.test.ts", run: runAreaC },
  { id: "D", kind: "area", title: "Clean verification, step 3b oracles and anti-gaming", file: "area-d.test.ts", run: runAreaD },
  { id: "E", kind: "area", title: "Parallel feature isolation, merge queue and CCR", file: "area-e.test.ts", run: runAreaE },
  { id: "F", kind: "area", title: "Mid-build steering, holds and calm inbox", file: "area-f.test.ts", run: runAreaF },
  { id: "G", kind: "area", title: "Windows sandbox, supply chain and secrets", file: "area-g.test.ts", run: runAreaG },
  { id: "H", kind: "area", title: "Provider plans, terms and conformance", file: "area-h.test.ts", run: runAreaH },
  { id: "I", kind: "area", title: "Interactive UX, brownfield and editor coexistence", file: "area-i.test.ts", run: runAreaI },
  { id: "J", kind: "area", title: "Ship safety, investigations and portability", file: "area-j.test.ts", run: runAreaJ },
  { id: "1", kind: "trial", title: "Clean-copy verification isolation", file: "trial-1.test.ts", run: runTrial1 },
  { id: "2", kind: "trial", title: "Blind oracle independence and zero leakage", file: "trial-2.test.ts", run: runTrial2 },
  { id: "3", kind: "trial", title: "Windows sandbox and proxy escape resistance", file: "trial-3.test.ts", run: runTrial3 },
  { id: "4", kind: "trial", title: "Supply chain and secret hygiene", file: "trial-4.test.ts", run: runTrial4 },
  { id: "5", kind: "trial", title: "Real-app multi-surface behavior", file: "trial-5.test.ts", run: runTrial5 },
  { id: "6", kind: "trial", title: "Crash, hold and rollback resilience", file: "trial-6.test.ts", run: runTrial6 },
];

function receipt(item: (typeof RUNNERS)[number], evidence: readonly string[], durationMs: number): EvidenceReceipt {
  const testFile = `tests/e2e/review-trials/${item.file}`;
  if (!fs.existsSync(path.join(reviewTrialsDir(), item.file))) throw new Error(`missing ${testFile}`);
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    testFile,
    passed: true,
    skipped: 0,
    durationMs,
    evidence,
  };
}

export class ArchitectureReviewTrialsSuite {
  static async run(options?: { reportDir?: string }): Promise<ReviewTrialsCertificationReport> {
    const hits = scanDirectory(reviewTrialsDir());
    if (hits.length > 0) {
      const first = hits[0];
      throw new Error(`skip marker ${first?.marker ?? ""} in ${first?.file ?? "review-trials"}`);
    }
    const settledDecisions = assertSettledCorpus();
    const ctx = createContext();
    const started = performance.now();
    try {
      const areas: EvidenceReceipt[] = [];
      const trials: EvidenceReceipt[] = [];
      for (const item of RUNNERS) {
        const itemStarted = performance.now();
        const evidence = await item.run(ctx);
        const row = receipt(item, evidence, Math.max(0, Math.round(performance.now() - itemStarted)));
        if (item.kind === "area") areas.push(row);
        else trials.push(row);
      }
      const durationMs = Math.max(0, Math.round(performance.now() - started));
      if (areas.length !== 10 || trials.length !== 6) throw new Error("suite did not execute 16 trials");
      if (durationMs >= 90_000) throw new Error(`suite took ${durationMs}ms`);
      const report: ReviewTrialsCertificationReport = {
        version: "review-trials-certification/1",
        suite: "ArchitectureReviewTrialsSuite",
        executed: 16,
        passed: 16,
        skipped: 0,
        durationMs,
        leakedPids: 0,
        leakedTempDirs: 0,
        offline: true,
        portStrategy: "ephemeral-loopback",
        settledDecisions,
        ports: [...ctx.ports.leases],
        areas,
        trials,
      };
      if (options?.reportDir) writeReport(options.reportDir, report);
      return report;
    } finally {
      const leaks = await ctx.close();
      if (leaks.leakedPids.length > 0 || leaks.leakedTemps.length > 0) {
        throw new Error(`cleanup leaked pids=${leaks.leakedPids.join(",")} temps=${leaks.leakedTemps.join(",")}`);
      }
    }
  }
}

export type { ReviewTrialsCertificationReport };
