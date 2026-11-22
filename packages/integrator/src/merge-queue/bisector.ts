import type { FailingCheck, QueuedFeature } from "./types.js";

export interface BisectProbe {
  readonly ok: boolean;
  readonly trace: string;
  readonly failingChecks: readonly FailingCheck[];
  readonly kind: "gate" | "contract_clash";
}

export interface BisectPorts {
  readonly probe: (features: readonly QueuedFeature[]) => Promise<BisectProbe>;
  readonly land: (features: readonly QueuedFeature[]) => Promise<void>;
  readonly evict: (
    feature: QueuedFeature,
    trace: string,
    failingChecks: readonly FailingCheck[],
    kind: "gate" | "contract_clash" | "done_refused",
  ) => void;
  readonly interact: (features: readonly QueuedFeature[], probe: BisectProbe) => Promise<void>;
}

/**
 * Deterministic batch bisection. A failing batch splits as `[F-1]` versus `[F-2, F-3]`.
 * Passing halves land immediately. A half that fails is split again.
 * When every half passes alone and the combination fails, the whole set is an interaction.
 */
export class MergeBatchBisector {
  constructor(private readonly ports: BisectPorts) {}

  async resolve(batch: readonly QueuedFeature[]): Promise<void> {
    await this.isolate(batch);
  }

  private async isolate(batch: readonly QueuedFeature[]): Promise<void> {
    if (batch.length === 0) return;
    const probed = await this.ports.probe(batch);
    if (probed.ok) {
      await this.ports.land(batch);
      return;
    }
    const only = batch[0];
    if (batch.length === 1 && only) {
      this.ports.evict(only, probed.trace, probed.failingChecks, probed.kind);
      return;
    }
    const mid = Math.floor(batch.length / 2);
    const left = batch.slice(0, mid);
    const right = batch.slice(mid);
    const leftProbe = await this.ports.probe(left);
    const rightProbe = await this.ports.probe(right);
    if (leftProbe.ok && rightProbe.ok) {
      await this.ports.interact(batch, probed);
      return;
    }
    if (leftProbe.ok) await this.ports.land(left);
    else await this.isolate(left);
    if (rightProbe.ok) await this.ports.land(right);
    else await this.isolate(right);
  }
}
