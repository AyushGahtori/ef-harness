import { Xoshiro256ssRng } from "./rng.js";
import { FAULT_CLASSES, TX_BOUNDARY_HOOKS, type FaultClass, type ScheduledFault, type TxBoundaryHook } from "./types.js";

const PROVIDER_FAULTS = [
  "http_429",
  "http_500",
  "sse_reset",
  "malformed_json",
  "usage_limit",
  "oauth_401",
  "route_revoked",
] as const;

const GIT_FAULTS = ["cas_race", "merge_conflict", "ebusy_rename", "stale_index_lock"] as const;

const DISK_STEPS_GB = [16, 14, 4.5, 1.8] as const;

/** Deterministic multi-fault schedule from a single uint64 seed. */
export class SeededChaosScenarioMatrix {
  static schedule(seed: number, maxFaults = 12): ScheduledFault[] {
    const rng = new Xoshiro256ssRng(seed);
    const faults: ScheduledFault[] = [];
    const usedHooks = new Set<TxBoundaryHook>();
    let tick = 0;

    for (const hook of TX_BOUNDARY_HOOKS) {
      tick += rng.nextInt(1, 4);
      faults.push({
        tick,
        class: "tx_crash",
        hook,
        detail: `sigkill_at_${hook}`,
      });
      usedHooks.add(hook);
    }

    for (const faultClass of FAULT_CLASSES) {
      if (faultClass === "tx_crash") continue;
      tick += rng.nextInt(2, 6);
      faults.push({
        tick,
        class: faultClass,
        detail: SeededChaosScenarioMatrix.detailForClass(faultClass, rng),
      });
    }

    while (faults.length < maxFaults) {
      tick += rng.nextInt(1, 8);
      const cls = rng.pick(FAULT_CLASSES);
      if (cls === "tx_crash") {
        const hook = rng.pick(TX_BOUNDARY_HOOKS);
        faults.push({
          tick,
          class: cls,
          hook,
          detail: SeededChaosScenarioMatrix.detailForClass(cls, rng, hook),
        });
      } else {
        faults.push({
          tick,
          class: cls,
          detail: SeededChaosScenarioMatrix.detailForClass(cls, rng),
        });
      }
    }

    faults.sort((a, b) => a.tick - b.tick || a.class.localeCompare(b.class));
    const minForClassCoverage = TX_BOUNDARY_HOOKS.length + (FAULT_CLASSES.length - 1);
    const cap =
      maxFaults < minForClassCoverage ? maxFaults : Math.max(maxFaults, minForClassCoverage);
    return faults.slice(0, cap);
  }

  private static detailForClass(cls: FaultClass, rng: Xoshiro256ssRng, hook?: TxBoundaryHook): string {
    switch (cls) {
      case "tx_crash":
        return `sigkill_at_${hook ?? rng.pick(TX_BOUNDARY_HOOKS)}`;
      case "provider_network":
        return rng.pick(PROVIDER_FAULTS);
      case "git_worktree":
        return rng.pick(GIT_FAULTS);
      case "disk_ram":
        return `disk_gb_${rng.pick(DISK_STEPS_GB)}`;
      case "sandbox_subprocess":
        return rng.pick(["tier_setup_fail", "memory_hog", "sigint_ignore", "av_quarantine"] as const);
      case "foreign_cli":
        return rng.pick(["codex_step3", "claude_step3", "acp_step3", "exit_137"] as const);
      case "human_interference":
        return rng.pick(["vscode_edit", "lockfile_edit", "git_amend", "rapid_stop"] as const);
      default:
        return cls;
    }
  }

  static assertHookCoverage(hits: Readonly<Record<TxBoundaryHook, number>>): string[] {
    const missing: string[] = [];
    for (const hook of TX_BOUNDARY_HOOKS) {
      if ((hits[hook] ?? 0) <= 0) {
        missing.push(`0 hits on ${hook}`);
      }
    }
    return missing;
  }
}