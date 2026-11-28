import { partitionWip, signSteeringNote } from "./format.js";
import type { WorkerSessionPort } from "./ports.js";
import type { CheckpointView, CompiledBrief, DeltaKind, SignedSteeringNote } from "./types.js";

export interface DeltaInspection {
  readonly kind: DeltaKind;
  readonly note: SignedSteeringNote | null;
  readonly salvagedWip: readonly { readonly path: string; readonly label: string }[];
  readonly discardedWip: readonly string[];
}

export interface ResumeApplied {
  readonly kind: DeltaKind;
  readonly sessionRef: string;
  readonly note: SignedSteeringNote | null;
  readonly salvagedWip: readonly { readonly path: string; readonly label: string }[];
  readonly discardedWip: readonly string[];
  readonly previousSessionAppended: boolean;
}

const SWAP_PAIRS: readonly (readonly [string, string])[] = [
  ["rest", "graphql"],
  ["sqlite", "postgres"],
  ["11:00", "10:00"],
];

/**
 * When every hold on a task has cleared, compare the pinned checkpoint brief
 * with the newly compiled brief and choose a resume strategy.
 * Contradictory deltas never append onto the existing session.
 */
export class AdditiveVsContradictoryResumer {
  constructor(private readonly worker: WorkerSessionPort) {}

  inspect(pinned: CheckpointView, next: CompiledBrief): DeltaInspection {
    const kind = classifyDelta(pinned, next);
    if (kind === "additive") {
      return {
        kind,
        note: signSteeringNote(next.deltaNote),
        salvagedWip: [],
        discardedWip: [],
      };
    }
    if (kind === "contradictory") {
      const split = partitionWip(pinned.wipFiles, next.contradictedTokens);
      return { kind, note: null, salvagedWip: split.kept, discardedWip: split.discarded };
    }
    return { kind: "none", note: null, salvagedWip: [], discardedWip: [] };
  }

  apply(pinned: CheckpointView, next: CompiledBrief): ResumeApplied {
    const inspection = this.inspect(pinned, next);
    if (inspection.kind === "none") {
      const resumed = this.worker.resumeExistingCheckpoint({
        taskId: pinned.taskId,
        sessionRef: pinned.sessionRef,
      });
      return {
        kind: "none",
        sessionRef: resumed.sessionRef,
        note: null,
        salvagedWip: [],
        discardedWip: [],
        previousSessionAppended: false,
      };
    }
    if (inspection.kind === "additive") {
      const note = inspection.note;
      if (!note) throw new Error("additive resume is missing its steering note");
      const resumed = this.worker.resumeWithSignedNote({
        taskId: pinned.taskId,
        sessionRef: pinned.sessionRef,
        note,
        wipFiles: pinned.wipFiles,
      });
      return {
        kind: "additive",
        sessionRef: resumed.sessionRef,
        note,
        salvagedWip: [],
        discardedWip: [],
        previousSessionAppended: true,
      };
    }
    const fresh = this.worker.reconstructFreshSession({
      taskId: pinned.taskId,
      previousSessionRef: pinned.sessionRef,
      brief: next,
      salvagedWip: inspection.salvagedWip,
      discardedWip: inspection.discardedWip,
    });
    return {
      kind: "contradictory",
      sessionRef: fresh.sessionRef,
      note: null,
      salvagedWip: inspection.salvagedWip,
      discardedWip: inspection.discardedWip,
      previousSessionAppended: fresh.previousSessionAppended,
    };
  }
}

export function classifyDelta(pinned: CheckpointView, next: CompiledBrief): DeltaKind {
  if (next.sliceSha256 === pinned.sliceSha256) return "none";
  if (next.changeKind === "contradictory") return "contradictory";
  if (removedRequirement(pinned.requirements, next.requirements)) return "contradictory";
  if (tokenSwap(pinned.briefText, next.text)) return "contradictory";
  if (next.changeKind === "additive") return "additive";
  if (isStrictExtension(pinned.briefText, pinned.requirements, next.text, next.requirements)) return "additive";
  return "contradictory";
}

function removedRequirement(before: readonly string[], after: readonly string[]): boolean {
  const next = new Set(after);
  return before.some((item) => !next.has(item));
}

function tokenSwap(before: string, after: string): boolean {
  const left = before.toLowerCase();
  const right = after.toLowerCase();
  return SWAP_PAIRS.some(([from, to]) => {
    const forward = left.includes(from) && right.includes(to) && !right.includes(from);
    const backward = left.includes(to) && right.includes(from) && !right.includes(to);
    return forward || backward;
  });
}

function isStrictExtension(
  beforeText: string,
  beforeRequirements: readonly string[],
  afterText: string,
  afterRequirements: readonly string[],
): boolean {
  if (!afterText.startsWith(beforeText)) return false;
  const next = new Set(afterRequirements);
  return beforeRequirements.every((item) => next.has(item));
}
