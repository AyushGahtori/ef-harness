import { canonicalJson } from "./normalize.js";
import type { CheckObservation, HandoffNote, WorkingMemory } from "./types.js";

export interface HandoffNoteInput {
  briefVersion: number;
  workingMemory: WorkingMemory;
  changedFiles: readonly string[];
  lastCheckResults: readonly CheckObservation[];
}

export function generateHandoffNote(input: HandoffNoteInput): string {
  const completed = Object.keys(input.workingMemory.doneByMustId)
    .sort()
    .map((id) => `${id}: ${input.workingMemory.doneByMustId[id] ?? ""}`);
  const doneValues = new Set(Object.values(input.workingMemory.doneByMustId));
  const remaining = input.workingMemory.planSteps.filter((step) => !doneValues.has(step));
  let lastFailingCheck: string | null = null;
  for (const result of input.lastCheckResults) {
    if (result.status === "fail") lastFailingCheck = result.id;
  }
  const note: HandoffNote = {
    briefVersion: input.briefVersion,
    stepsCompleted: completed,
    stepsRemaining: remaining,
    changedFiles: [...new Set(input.changedFiles)].sort(),
    lastCheckResults: input.lastCheckResults.map((result) => ({
      id: result.id,
      status: result.status,
    })),
    lastFailingCheck,
    generatedBy: "code",
    llmTokens: 0,
  };
  return canonicalJson(note);
}
