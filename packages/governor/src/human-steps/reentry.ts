import type { HumanStepProbeRegistry } from "./registry.js";
import type { HumanStepStateStore } from "./store.js";
import type { ProbeResult } from "./types.js";

export interface ReprobeReport {
  readonly checked: readonly { readonly stepId: string; readonly result: ProbeResult }[];
  readonly skipped: readonly string[];
}

/**
 * Cold-open and focus-return hook for Task 130. Pending and failed steps are
 * probed again before a welcome-back screen would finish rendering.
 */
export class HumanStepReentryHook {
  constructor(
    private readonly store: HumanStepStateStore,
    private readonly registry: HumanStepProbeRegistry,
  ) {}

  onColdOpen(): Promise<ReprobeReport> {
    return this.reprobeOutstanding();
  }

  onFocusReturn(): Promise<ReprobeReport> {
    return this.reprobeOutstanding();
  }

  private async reprobeOutstanding(): Promise<ReprobeReport> {
    const outstanding = this.store.listOutstanding();
    const checked: { stepId: string; result: ProbeResult }[] = [];
    const skipped: string[] = [];
    for (const step of outstanding) {
      if (step.probeSpec.kind === "unprobeable") {
        skipped.push(step.stepId);
        continue;
      }
      const result = await this.registry.checkAgain(step.stepId);
      checked.push({ stepId: step.stepId, result });
    }
    return { checked, skipped };
  }
}
