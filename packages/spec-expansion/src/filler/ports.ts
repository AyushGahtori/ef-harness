import type {
  ChosenForYouEntry,
  ChosenForYouPort,
  ContradictionRecheckInput,
  ContradictionRecheckPort,
  ContradictionRecheckResult,
} from "./types.js";

/** In-memory port for Task 081 until the contradiction engine is on this base. */
export class RecordingContradictionRecheck implements ContradictionRecheckPort {
  readonly calls: ContradictionRecheckInput[] = [];

  recheck(input: ContradictionRecheckInput): ContradictionRecheckResult {
    this.calls.push(input);
    return { flagged: input.pairs.length };
  }
}

/** In-memory port for Task 073 `ChosenForYouLedger`. */
export class MemoryChosenForYou implements ChosenForYouPort {
  private readonly entries: ChosenForYouEntry[] = [];

  record(entry: ChosenForYouEntry): void {
    this.entries.push(entry);
  }

  list(): readonly ChosenForYouEntry[] {
    return this.entries;
  }
}
