import type { InventoryScanResult } from "./variant-expanded-reference-inventory.js";
import type { PersistedNameGateResult, PersistedNameKind, ReferenceHit, Zone2Decision } from "./types.js";

export type PersistedNameApproval = {
  readonly kinds: readonly PersistedNameKind[];
  readonly decision: Zone2Decision;
};

export class PersistedNameBoundaryGate {
  private readonly approved = new Map<PersistedNameKind, Zone2Decision>();

  /**
   * Default: every Zone 2 hit is preserved (wire/DB compatibility).
   */
  evaluate(scan: Pick<InventoryScanResult, "hitsByZone">): PersistedNameGateResult {
    const zone2Hits = [...(scan.hitsByZone.zone2_persisted ?? [])];
  const requiresExplicitApproval = zone2Hits.length > 0;
    return {
      zone2Hits,
      defaultDecision: "preserve",
      approvedRenames: [],
      requiresExplicitApproval,
    };
  }

  /**
   * User explicitly approves expand-then-contract migration for selected persisted kinds.
   */
  approvePersistedRename(approval: PersistedNameApproval): void {
    for (const kind of approval.kinds) {
      this.approved.set(kind, approval.decision);
    }
  }

  isRenameAllowed(hit: ReferenceHit): boolean {
    if (hit.zone !== "zone2_persisted") return true;
    if (!hit.persistedKind) return false;
    return this.approved.get(hit.persistedKind) === "rename_with_migration";
  }

  partitionForCodemod(scan: InventoryScanResult): {
    readonly codemodTargets: readonly ReferenceHit[];
    readonly preserved: readonly ReferenceHit[];
    readonly immutable: readonly ReferenceHit[];
  } {
    const codemodTargets: ReferenceHit[] = [];
    const preserved: ReferenceHit[] = [];
    const immutable = [...(scan.hitsByZone.immutable_migration ?? [])];

    for (const hit of scan.hits) {
      if (hit.zone === "immutable_migration") continue;
      if (hit.zone === "zone2_persisted") {
        if (this.isRenameAllowed(hit)) {
          codemodTargets.push(hit);
        } else {
          preserved.push(hit);
        }
      } else {
        codemodTargets.push(hit);
      }
    }

    return { codemodTargets, preserved, immutable };
  }

  formatConsentPrompt(symbol: string, zone2Count: number): string {
    return (
      `Rename sweep targets "${symbol}" across ${zone2Count} persisted wire/DB name(s). ` +
      `Default: KEEP EXTERNAL/PERSISTED NAMES UNCHANGED. ` +
      `Also rename persisted DB table / API JSON key via Expand-Then-Contract migration?`
    );
  }
}