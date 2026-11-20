import { MICRO_USD_PER_DELTA_TASK, type ChangeClass, type ImpactPreviewInput } from "./types.js";

export class RevisionImpactPreviewer {
  readonly llmCalls = 0 as const;

  format(input: ImpactPreviewInput): string {
    const contractNoun = input.contractCount === 1 ? "contract" : "contracts";
    const activeNoun = input.activeTasks.length === 1 ? "active task" : "active tasks";
    const names = input.activeTasks.map((task) => `'${task.title.replaceAll("'", "")}'`).join(", ");
    const pauses =
      input.activeTasks.length > 0
        ? `pauses ${input.activeTasks.length} ${activeNoun} (${names})`
        : "pauses 0 active tasks";
    const finishedNoun = input.finishedTaskCount === 1 ? "task" : "tasks";
    const otherNoun = input.untouchedTaskCount === 1 ? "task" : "tasks";
    const deltaNoun = input.deltaTasks === 1 ? "task" : "tasks";
    return `Touches ${input.contractCount} ${contractNoun}, ${pauses}, re-checks ${input.finishedTaskCount} finished ${finishedNoun}, leaves ${input.untouchedTaskCount} other ${otherNoun} untouched · Est. delta: +${input.deltaTasks} ${deltaNoun}, ~${formatUsd(input.deltaCostMicroUsd)}`;
  }
}

export function estimateDelta(input: {
  readonly changeClass: ChangeClass;
  readonly additiveCount: number;
  readonly finishedTaskCount: number;
  readonly microUsdPerDeltaTask?: number;
}): { readonly deltaTasks: number; readonly deltaCostMicroUsd: number } {
  const rate = input.microUsdPerDeltaTask ?? MICRO_USD_PER_DELTA_TASK;
  let deltaTasks = 0;
  if (input.changeClass === "compatible") deltaTasks = input.additiveCount;
  else if (input.changeClass === "breaking") deltaTasks = input.finishedTaskCount;
  return { deltaTasks, deltaCostMicroUsd: deltaTasks * rate };
}

export function formatUsd(microUsd: number): string {
  const negative = microUsd < 0;
  const centsTotal = Math.round(Math.abs(Math.trunc(microUsd)) / 10_000);
  const dollars = Math.floor(centsTotal / 100);
  const cents = centsTotal % 100;
  return `${negative ? "-" : ""}$${dollars}.${cents.toString().padStart(2, "0")}`;
}
