export interface DomainEvent<T = unknown> {
  readonly seq: number;
  readonly payload: T;
}

export interface SyncApply<T> {
  readonly applied: readonly DomainEvent<T>[];
  readonly ignored: number;
  readonly gap: boolean;
}

/**
 * Local port for Task 032 `ClientStateSyncer`.
 * Apply an event only when `seq === lastApplied + 1`. Lower seqs are duplicates. A higher seq is a gap.
 */
export function createClientStateSyncer<T = unknown>(): {
  lastApplied(): number;
  reset(seq: number): void;
  apply(events: readonly DomainEvent<T>[]): SyncApply<T>;
} {
  let last = 0;
  return {
    lastApplied: () => last,
    reset(seq: number) {
      last = seq;
    },
    apply(events: readonly DomainEvent<T>[]): SyncApply<T> {
      const applied: DomainEvent<T>[] = [];
      let ignored = 0;
      for (const event of events) {
        if (event.seq <= last) {
          ignored += 1;
          continue;
        }
        if (event.seq !== last + 1) return { applied, ignored, gap: true };
        last = event.seq;
        applied.push(event);
      }
      return { applied, ignored, gap: false };
    },
  };
}
