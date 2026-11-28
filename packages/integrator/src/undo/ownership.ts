import { PHASE0_SHARED } from "./constants.js";
import type { ClassifiedArtifact, OwnershipTransfer, UndoInventory } from "./types.js";

/**
 * Reassigns shared helpers and tables to the consuming feature, or to
 * `phase0-shared` when more than one active feature still uses the piece.
 * Exclusive files are removed instead of transferred. Later-edit overlaps
 * (a nav line beside a sibling edit) stay with the file's current owner.
 */
export class SharedOwnershipTransferPlanner {
  plan(inventory: UndoInventory): OwnershipTransfer[] {
    const transfers: OwnershipTransfer[] = [];
    const pieces = [...inventory.shared, ...inventory.persistentData];
    for (const piece of pieces) {
      const transfer = transferFor(inventory.featureId, piece);
      if (transfer) transfers.push(transfer);
    }
    return transfers;
  }
}

function transferFor(featureId: string, piece: ClassifiedArtifact): OwnershipTransfer | null {
  if (piece.reasons.length === 1 && piece.reasons[0] === "later_edit") return null;
  const consumers = piece.referencedBy.filter((id) => id !== featureId);
  if (piece.bucket === "shared" && consumers.length === 0 && !piece.reasons.includes("import") && !piece.reasons.includes("graph")) {
    return null;
  }
  const toFeatureId = consumers.length === 1 ? (consumers[0] ?? PHASE0_SHARED) : PHASE0_SHARED;
  const reason =
    consumers.length === 1
      ? `shared ownership moves to ${toFeatureId}`
      : `shared ownership moves to ${PHASE0_SHARED}`;
  return {
    path: piece.path,
    fromFeatureId: featureId,
    toFeatureId,
    reason,
  };
}
