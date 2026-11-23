import os from "node:os";
import { ChaosInvariantOracle } from "./chaos-invariant-oracle.js";
import { emptyCoverageMatrix, recordFaultHit } from "./coverage-matrix.js";
import { FakeDualClock } from "./clock.js";
import { makeEphemeralRoot, removeEphemeralRoot, SimulatedDaemonStack } from "./daemon-stack.js";
import { CrashSignal } from "./crash-signal.js";
import { SeededChaosScenarioMatrix } from "./scenario-matrix.js";
import { hashFaultTrace } from "./trace-hash.js";
import { TxBoundaryCrashInjector } from "./tx-boundary-crash-injector.js";
import type { ChaosRunResult, ChaosSweepResult, FaultCoverageMatrix, FaultEvent } from "./types.js";

export interface ChaosRunOptions {
  readonly seed: number;
  readonly rootDir?: string;
  readonly keepArtifacts?: boolean;
  readonly skipCleanup?: boolean;
  readonly maxFaults?: number;
}

const IN_PLACE_RECOVERY_HOOKS = new Set([
  "before_begin_immediate",
  "before_sqlite_commit",
  "mid_sqlite_wal_write",
]);

export const CI_CHAOS_SEED_COUNT = 50;
export const NIGHTLY_CHAOS_SEED_COUNT = 1_000;

export class FullDaemonFaultSimulator {
  private readonly oracle = new ChaosInvariantOracle();

  runSingle(options: ChaosRunOptions): ChaosRunResult {
    const seed = options.seed;
    if (!Number.isInteger(seed) || seed < 0) {
      throw new Error("seed must be a non-negative integer");
    }
    const rootDir = options.rootDir ?? makeEphemeralRoot(`ef-chaos-${seed}-`);
    const ownedRoot = options.rootDir === undefined;
    const clock = new FakeDualClock(0, 1_700_000_000_000);
    const stack = new SimulatedDaemonStack({ rootDir, clock });
    const schedule = SeededChaosScenarioMatrix.schedule(seed, options.maxFaults ?? 13);
    const events: FaultEvent[] = [];
    let coverage: FaultCoverageMatrix = { ...emptyCoverageMatrix(), totalRuns: 1 };

    try {
      for (const fault of schedule) {
        clock.advance(100);
        let recovered = true;
        try {
          if (fault.class === "tx_crash" && fault.hook) {
            const injector = new TxBoundaryCrashInjector(fault.hook);
            stack.runCandidateAcceptanceTx(injector);
            stack.dispatchEffect(injector);
            coverage = recordFaultHit(coverage, fault.hook, fault.class);
          } else {
            stack.applyFault(fault, null);
            const hook = fault.hook ?? null;
            coverage = recordFaultHit(coverage, hook, fault.class);
          }
        } catch (error) {
          if (error instanceof CrashSignal) {
            if (IN_PLACE_RECOVERY_HOOKS.has(error.point)) {
              stack.coldOpenReconcile();
            } else {
              stack.reopenAfterCrash();
            }
            coverage = recordFaultHit(coverage, error.point, "tx_crash");
          } else {
            recovered = false;
            throw error;
          }
        }
        events.push({
          tick: fault.tick,
          class: fault.class,
          hook: fault.hook ?? null,
          detail: fault.detail,
          recovered,
        });
      }

      stack.runCandidateAcceptanceTx(null);
      stack.dispatchEffect(null);
      stack.finalizeHealthyState();
      const violations = this.oracle.assertAll(stack.snapshot());
      const passed = violations.length === 0;
      stack.close();
      if (ownedRoot && !options.keepArtifacts && !options.skipCleanup) {
        removeEphemeralRoot(rootDir);
      }
      return {
        seed,
        passed,
        invariantViolations: violations,
        faultTrace: events,
        scheduledFaults: schedule,
        coverageMatrix: coverage,
        traceHash: hashFaultTrace(events),
        virtualTimeMs: clock.nowMono(),
        artifactRoot: options.keepArtifacts ? rootDir : null,
      };
    } catch (error) {
      stack.close();
      if (ownedRoot && !options.keepArtifacts && !options.skipCleanup) {
        removeEphemeralRoot(rootDir);
      }
      throw error;
    }
  }

  async runSweep(seedCount: number, startSeed = 0, concurrency = Math.min(32, (os.cpus().length || 4) * 4)): Promise<ChaosSweepResult> {
    const started = Date.now();
    const runs: ChaosRunResult[] = new Array(seedCount);
    let coverage: FaultCoverageMatrix = emptyCoverageMatrix();
    let passed = 0;
    let failed = 0;

    for (let offset = 0; offset < seedCount; offset += concurrency) {
      const batch: Promise<ChaosRunResult>[] = [];
      for (let i = offset; i < Math.min(offset + concurrency, seedCount); i += 1) {
        batch.push(Promise.resolve(this.runSingle({ seed: startSeed + i, skipCleanup: true })));
      }
      const results = await Promise.all(batch);
      for (let j = 0; j < results.length; j += 1) {
        const index = offset + j;
        const result = results[j];
        if (!result) continue;
        runs[index] = result;
        for (const event of result.faultTrace) {
          coverage = recordFaultHit(coverage, event.hook, event.class);
        }
        if (result.passed) passed += 1;
        else failed += 1;
      }
    }

    coverage = { ...coverage, totalRuns: seedCount };
    return {
      seeds: seedCount,
      passed,
      failed,
      elapsedMs: Date.now() - started,
      coverage,
      runs,
    };
  }
}

export function faultTraceIdentical(left: ChaosRunResult, right: ChaosRunResult): boolean {
  if (left.traceHash !== right.traceHash) return false;
  if (left.faultTrace.length !== right.faultTrace.length) return false;
  for (let i = 0; i < left.faultTrace.length; i += 1) {
    const a = left.faultTrace[i];
    const b = right.faultTrace[i];
    if (!a || !b) return false;
    if (a.tick !== b.tick || a.class !== b.class || a.detail !== b.detail || a.hook !== b.hook) {
      return false;
    }
  }
  return true;
}