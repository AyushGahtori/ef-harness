import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finalizeCertification } from "./scorecard.ts";
import { certifySlo1WorkersDb, certifySlo2Board } from "./ports/db-board.ts";
import { certifySlo3Export } from "./ports/export-graph.ts";
import { certifySlo4Migration } from "./ports/migration-200mb.ts";
import { certifySlo5Ui } from "./ports/ui-laptop.ts";
import { certifySlo6StartupIpc } from "./ports/startup-ipc.ts";
import type { CertificationResult, SloMetric } from "./types.ts";

export interface PerformanceAndScaleCertifierOptions {
  readonly branch?: string;
  readonly tempRoot?: string;
  readonly skipHeavyMigration?: boolean;
}

export class PerformanceAndScaleCertifier {
  private readonly branch: string;
  private readonly tempRoot: string;
  private readonly skipHeavyMigration: boolean;

  constructor(options: PerformanceAndScaleCertifierOptions = {}) {
    this.branch = options.branch ?? process.env.EF_TASK_BRANCH ?? "task/198-performance-scale-cert";
    this.tempRoot = options.tempRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), "ef-perf-scale-cert-"));
    this.skipHeavyMigration = options.skipHeavyMigration ?? process.env.EF_PERF_SKIP_200MB === "1";
  }

  cleanup(): void {
    fs.rmSync(this.tempRoot, { recursive: true, force: true });
  }

  async runAll(): Promise<CertificationResult> {
    const metrics: SloMetric[] = [];
    try {
      const dbPath = path.join(this.tempRoot, "telemetry.db");
      const statePath = path.join(this.tempRoot, "state.db");
      const slo1 = await certifySlo1WorkersDb(dbPath);
      metrics.push({
        sloId: "slo-1-50-workers-db",
        label: "SLO 1 — 50 workers DB write",
        p50: slo1.p50,
        p95: slo1.p95,
        p99: slo1.p99,
        peakRamMb: slo1.peakRssMb,
        threshold: "p99 < 50 ms, 0 busy, RSS < 250 MB",
        passFail: slo1.pass ? "pass" : "fail",
        detail: slo1.detail,
        extras: { busy: slo1.busy, walStalls: slo1.walStalls },
      });
      const slo2 = certifySlo2Board();
      metrics.push({
        sloId: "slo-2-board-500-tasks",
        label: "SLO 2 — 500-task board cockpit",
        p50: slo2.p50,
        p95: slo2.p95,
        p99: slo2.p95,
        peakRamMb: null,
        threshold: "median & p95 frame update < 10 ms",
        passFail: slo2.pass ? "pass" : "fail",
        detail: slo2.detail,
        extras: { tasks: slo2.tasks, requirements: slo2.requirements },
      });
      const slo3 = certifySlo3Export(statePath, this.tempRoot);
      metrics.push({
        sloId: "slo-3-300-entity-export",
        label: "SLO 3 — 300-entity export graph",
        p50: slo3.incrementalViewsExportMs,
        p95: slo3.harnessStateIncrementalMs,
        p99: slo3.impactWalkMs,
        peakRamMb: null,
        threshold: "views < 500/150 ms, harness-state < 150/2000 ms, impact_walk < 15 ms, compile < 100 ms",
        passFail: slo3.pass ? "pass" : "fail",
        detail: slo3.detail,
        extras: {
          fullViewsExportMs: slo3.fullViewsExportMs,
          graphCompileMs: slo3.graphCompileMs,
        },
      });
      if (!this.skipHeavyMigration) {
        const slo4 = certifySlo4Migration(path.join(this.tempRoot, "migration"));
        metrics.push({
          sloId: "slo-4-200mb-migration",
          label: "SLO 4 — 200 MB migration",
          p50: slo4.migrationMs,
          p95: slo4.migrationMs,
          p99: slo4.migrationMs,
          peakRamMb: slo4.peakRamMb,
          threshold: "< 15 s, peak RSS < 400 MB, integrity ok",
          passFail: slo4.pass ? "pass" : "fail",
          detail: slo4.detail,
          extras: { lostRows: slo4.lostRows, integrityOk: slo4.integrityOk },
        });
      }
      const slo5 = certifySlo5Ui();
      metrics.push({
        sloId: "slo-5-16gb-laptop-ui",
        label: "SLO 5 — 16 GB laptop UI",
        p50: slo5.uiLatencyP95,
        p95: slo5.uiLatencyP95,
        p99: slo5.uiLatencyP95,
        peakRamMb: Math.round(slo5.inspectorHeapDeltaMb),
        threshold: "UI p95 < 50 ms; Office idle < 5%; inspector heap delta < 25 MB",
        passFail: slo5.pass ? "pass" : "fail",
        detail: slo5.detail,
        extras: {
          officeIdleCpuPct: slo5.officeIdleCpuPct,
          officeTickMs: slo5.officeTickMs,
        },
      });
      const slo6 = await certifySlo6StartupIpc();
      metrics.push({
        sloId: "slo-6-startup-ipc",
        label: "SLO 6 — cold start & IPC",
        p50: slo6.coldBootMs,
        p95: slo6.pipeP99Ms,
        p99: slo6.pipeP99Ms,
        peakRamMb: null,
        threshold: "boot < 800 ms; pipe p99 < 5 ms; stream >= 50 MB/s",
        passFail: slo6.pass ? "pass" : "fail",
        detail: slo6.detail,
        extras: { streamThroughputMbps: slo6.streamThroughputMbps },
      });
      return finalizeCertification(metrics, this.branch);
    } finally {
      this.cleanup();
    }
  }
}