import { SupervisionError } from "./errors.js";
import { assertAgentRuntimeAdapter, type AgentRuntimeAdapter } from "./interface.js";
import type { AdapterTrustState, ForeignRuntimeId } from "./types.js";
import { isForeignRuntimeId } from "./types.js";

const TRUST_RANK: Readonly<Record<AdapterTrustState, number>> = {
  conformance_verified: 2,
  observe_only: 1,
  disabled: 0,
};

export interface RegistryEntry {
  readonly runtime: ForeignRuntimeId;
  readonly trust: AdapterTrustState;
  readonly reason: string;
  readonly adapter: AgentRuntimeAdapter;
}

/**
 * Live trust for foreign runtimes. Only `conformance_verified` adapters can
 * receive coding tasks. Conformance failures downgrade immediately.
 */
export class AdapterRegistry {
  private readonly entries = new Map<ForeignRuntimeId, RegistryEntry>();

  register(adapter: AgentRuntimeAdapter, trust: AdapterTrustState, reason = "registered"): void {
    assertAgentRuntimeAdapter(adapter);
    if (!isForeignRuntimeId(adapter.runtime)) {
      throw new SupervisionError("unknown_runtime", `Unknown runtime ${adapter.runtime}`);
    }
    this.entries.set(adapter.runtime, { runtime: adapter.runtime, trust, reason, adapter });
  }

  get(runtime: ForeignRuntimeId): RegistryEntry {
    const entry = this.entries.get(runtime);
    if (!entry) throw new SupervisionError("unknown_runtime", `Runtime ${runtime} is not registered`);
    return entry;
  }

  trustOf(runtime: ForeignRuntimeId): AdapterTrustState {
    return this.get(runtime).trust;
  }

  setTrust(runtime: ForeignRuntimeId, trust: AdapterTrustState, reason: string): void {
    const entry = this.get(runtime);
    this.entries.set(runtime, { ...entry, trust, reason });
  }

  downgrade(runtime: ForeignRuntimeId, trust: "observe_only" | "disabled", reason: string): void {
    const entry = this.get(runtime);
    if (TRUST_RANK[trust] < TRUST_RANK[entry.trust]) this.setTrust(runtime, trust, reason);
  }

  assignCodingTask(runtime: ForeignRuntimeId): AgentRuntimeAdapter {
    const entry = this.get(runtime);
    if (entry.trust !== "conformance_verified") {
      throw new SupervisionError(
        "adapter_not_dispatchable",
        `${runtime} is ${entry.trust} and cannot receive coding tasks`,
      );
    }
    return entry.adapter;
  }
}

/** Records a blocked connection that happened after a DENY and downgrades trust. */
export class EgressBreachMonitor {
  constructor(private readonly registry: AdapterRegistry) {}

  blockedAfterDeny(input: { readonly runtime: ForeignRuntimeId; readonly target: string }): void {
    this.registry.downgrade(
      input.runtime,
      "observe_only",
      `Ignored a DENY and was blocked reaching ${input.target}`,
    );
  }
}
