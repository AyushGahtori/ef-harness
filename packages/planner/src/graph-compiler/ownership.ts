import { diagnostic } from "./types.js";
import type { CompilationDiagnostic, CompilationInput } from "./types.js";

export function ownershipDiagnostics(input: CompilationInput): CompilationDiagnostic[] {
  const diagnostics: CompilationDiagnostic[] = [];
  const owners = new Set(input.sharedContractOwnerTaskIds);
  const slots = new Map<string, string>();
  for (const task of [...input.tasks].sort((a, b) => a.id.localeCompare(b.id))) {
    if (task.mutatesSharedContract && !owners.has(task.id)) {
      diagnostics.push(
        diagnostic({
          pass: 7,
          code: "shared_contract_owner",
          message: `Task ${task.id} mutates a shared contract but is not the designated contract owner.`,
          taskIds: [task.id],
          details: { owners: [...owners].sort((a, b) => a.localeCompare(b)) },
        }),
      );
    }
    if (!task.createsMigration) continue;
    const slot = task.migrationIntentSlot?.trim() ?? "";
    if (slot === "") {
      diagnostics.push(
        diagnostic({
          pass: 7,
          code: "migration_slot_missing",
          message: `Task ${task.id} creates a migration without a unique migration intent slot.`,
          taskIds: [task.id],
        }),
      );
      continue;
    }
    const prior = slots.get(slot);
    if (prior) {
      diagnostics.push(
        diagnostic({
          pass: 7,
          code: "migration_slot_duplicate",
          message: `Migration intent slot "${slot}" is claimed by both ${prior} and ${task.id}.`,
          taskIds: [prior, task.id],
          details: { slot },
        }),
      );
    } else {
      slots.set(slot, task.id);
    }
  }
  return diagnostics;
}
