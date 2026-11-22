import type { ModelMicroUsdRates } from "./api-key-types.js";

export type RosterCurrency = "micro_usd" | "ppm" | "local_slots";

export interface RosterModelDescriptor {
  readonly modelId: string;
  readonly provider: string;
  readonly currency: RosterCurrency;
  readonly rates?: ModelMicroUsdRates;
}

/**
 * Local stand-in for Task 106 `VersionedModelRoster`.
 * Currency is authoritative. Rates fill gaps the price table does not list.
 */
export interface VersionedModelRosterPort {
  describe(modelId: string): RosterModelDescriptor | undefined;
}

export class LocalVersionedModelRoster implements VersionedModelRosterPort {
  private readonly models: ReadonlyMap<string, RosterModelDescriptor>;

  constructor(models: readonly RosterModelDescriptor[]) {
    this.models = new Map(models.map((model) => [model.modelId, model]));
  }

  describe(modelId: string): RosterModelDescriptor | undefined {
    return this.models.get(modelId);
  }
}

export interface PolicyPriceTable {
  readonly version: string;
  readonly models: readonly ModelMicroUsdRates[];
}

/**
 * Local stand-in for Task 135 `SignedProviderPolicyEngine` price refresh.
 * Integration swaps this for the signed policy snapshot.
 */
export interface SignedProviderPolicyEnginePort {
  currentPriceTable(): PolicyPriceTable | undefined;
}

export class LocalSignedProviderPolicyEngine implements SignedProviderPolicyEnginePort {
  constructor(private readonly table: PolicyPriceTable | undefined) {}

  currentPriceTable(): PolicyPriceTable | undefined {
    if (!this.table) return undefined;
    return {
      version: this.table.version,
      models: this.table.models.map((row) => ({ ...row })),
    };
  }
}
