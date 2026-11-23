import type { InventoryScanResult } from "./variant-expanded-reference-inventory.js";
import type { ReferenceHit } from "./types.js";
import { VariantExpandedReferenceInventory } from "./variant-expanded-reference-inventory.js";
import type { InventoryScanOptions } from "./variant-expanded-reference-inventory.js";

export type LeftoverScanOptions = InventoryScanOptions & {
  readonly renamedFrom: string;
  readonly zone2AccountedVariants?: readonly string[];
  readonly immutablePaths?: readonly string[];
};

export type LeftoverScanResult = {
  readonly unaccountedZone1Leftovers: readonly ReferenceHit[];
  readonly accountedZone2: readonly ReferenceHit[];
  readonly passed: boolean;
};

export class SweepLeftoverScanner {
  private readonly inventory = new VariantExpandedReferenceInventory();

  scanAfterSweep(options: LeftoverScanOptions): LeftoverScanResult {
    const inventory = this.inventory.scan({
      repoRoot: options.repoRoot,
      targetSymbol: options.renamedFrom,
      ...(options.maxFileBytes === undefined ? {} : { maxFileBytes: options.maxFileBytes }),
    });
    return this.analyze(inventory, options);
  }

  analyze(
    inventory: InventoryScanResult,
    options: Pick<LeftoverScanOptions, "zone2AccountedVariants" | "immutablePaths">,
  ): LeftoverScanResult {
    const accounted = new Set(options.zone2AccountedVariants ?? []);
    const immutable = new Set(options.immutablePaths ?? []);

    const unaccountedZone1Leftovers: ReferenceHit[] = [];
    const accountedZone2: ReferenceHit[] = [];

    for (const hit of inventory.hits) {
      if (hit.zone === "immutable_migration" || immutable.has(hit.filePath)) {
        accountedZone2.push(hit);
        continue;
      }
      if (hit.zone === "zone2_persisted" || accounted.has(hit.variant) || accounted.has(hit.matchedText)) {
        accountedZone2.push(hit);
        continue;
      }
      if (hit.zone === "zone1_internal") {
        unaccountedZone1Leftovers.push(hit);
      }
    }

    return {
      unaccountedZone1Leftovers,
      accountedZone2,
      passed: unaccountedZone1Leftovers.length === 0,
    };
  }
}