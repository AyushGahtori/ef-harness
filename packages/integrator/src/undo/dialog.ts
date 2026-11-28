import { DATA_DROP, DATA_KEEP_DORMANT, LLM_TOKENS, MODE_FAST_PATH, MODE_SURGICAL } from "./constants.js";
import { executionMode } from "./inventory.js";
import type { OwnershipTransfer, UndoInventory, UndoPreview } from "./types.js";

/**
 * Step 2. Plain-English preview only. This class never reads or writes Git.
 */
export class UndoDataRetentionDialog {
  present(inventory: UndoInventory, transfers: readonly OwnershipTransfer[]): UndoPreview {
    const filesToRemove = inventory.exclusive.map((item) => item.path);
    const routesToRemove = [
      ...new Set(
        inventory.exclusive.flatMap((item) => {
          const fromSymbol = item.symbol.split(",").filter((route) => route.startsWith("/"));
          const fromPath = item.path.includes("/routes/") || item.path.includes("/screens/") ? [item.path] : [];
          return [...fromSymbol, ...fromPath];
        }),
      ),
    ];
    const testsToRemove = inventory.exclusive.filter((item) => item.kind === "test").map((item) => item.path);
    const sharedHelpers = inventory.shared.map((item) => item.path);
    const sharedTables = inventory.persistentData.filter((item) => item.kind === "table" || item.kind === "column").map((item) => item.symbol || item.path);
    const mode = inventory.inFlight ? MODE_SURGICAL : executionMode(inventory);
    const dependentChoices = inventory.hardDependents.length
      ? [`Undo ${[inventory.featureId, ...inventory.hardDependents].join(" + ")} together`, "Cancel undo"]
      : [];
    const lines = [
      `Undo ${inventory.featureId} ${inventory.title}`.trim(),
      `Remove   ${filesToRemove.length} files${routesToRemove.length ? ` · routes ${routesToRemove.join(", ")}` : ""}${testsToRemove.length ? ` · tests ${testsToRemove.join(", ")}` : ""}`,
    ];
    if (sharedHelpers.length === 0 && sharedTables.length === 0) {
      lines.push("Keep     no shared helpers");
    }
    for (const transfer of transfers) {
      lines.push(`Keep     ${transfer.path} · ${transfer.reason}`);
    }
    if (inventory.persistentData.length === 0) {
      lines.push("Data     no database tables or columns");
    } else {
      lines.push(
        `Data     ${sharedTables.join(", ") || inventory.persistentData.map((item) => item.path).join(", ")}`,
      );
      lines.push("Keep schema/data dormant (Safe default — expand-then-contract)");
      lines.push("Drop table/column in new additive-safe down-migration");
    }
    if (inventory.externalEffects.length > 0) {
      lines.push(`Can't undo  ${inventory.externalEffects.join(", ")}`);
    }
    lines.push(
      mode === MODE_FAST_PATH
        ? "Mode     Fast-Path Clean Merge Revert"
        : "Mode     Planned Surgical Removal",
    );
    if (inventory.hardDependents.length > 0) {
      lines.push(`Dependents  ${inventory.hardDependents.join(", ")}`);
      lines.push(dependentChoices.join("  OR  "));
    }
    lines.push("Full regression for every feature that remains");
    return {
      featureId: inventory.featureId,
      plainEnglish: lines.join("\n"),
      filesToRemove,
      routesToRemove,
      testsToRemove,
      sharedHelpers,
      sharedTables,
      transfers,
      dataChoiceDefault: DATA_KEEP_DORMANT,
      dataOptions: [DATA_KEEP_DORMANT, DATA_DROP],
      executionMode: mode === MODE_FAST_PATH ? MODE_FAST_PATH : MODE_SURGICAL,
      hardDependents: inventory.hardDependents,
      dependentChoices,
      externalEffects: inventory.externalEffects,
      llmTokens: LLM_TOKENS,
    };
  }
}
