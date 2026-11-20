import type { DomainEvent } from "./ports.js";
import type { EventsBatch } from "./envelopes.js";

export interface SyncCursor {
  readonly lastApplied: number;
  readonly applied: readonly DomainEvent[];
}

export type ReduceAction = "applied" | "duplicate" | "gap";

/**
 * Apply a domain batch only when it continues lastApplied + 1.
 * Envelopes may skip seqs inside [from_seq, to_seq] for topic filters.
 * A from_seq past lastApplied + 1 is a real gap and leaves state untouched.
 */
export function reduceBatch(
  cursor: SyncCursor,
  batch: EventsBatch,
): { readonly cursor: SyncCursor; readonly action: ReduceAction } {
  if (batch.to_seq < batch.from_seq) return { cursor, action: "gap" };
  if (batch.from_seq > cursor.lastApplied + 1) return { cursor, action: "gap" };
  if (batch.to_seq <= cursor.lastApplied) return { cursor, action: "duplicate" };
  const covered = batch.from_seq <= cursor.lastApplied + 1;
  let seq = cursor.lastApplied;
  const applied = cursor.applied.slice();
  const events = [...batch.events].sort((left, right) => left.seq - right.seq);
  for (const event of events) {
    if (event.seq <= seq || event.seq > batch.to_seq) continue;
    if (event.seq !== seq + 1) {
      if (!covered || event.seq < batch.from_seq) return { cursor, action: "gap" };
      seq = event.seq - 1;
    }
    if (event.seq !== seq + 1) return { cursor, action: "gap" };
    applied.push(event);
    seq = event.seq;
  }
  if (covered && batch.to_seq > seq) seq = batch.to_seq;
  if (seq === cursor.lastApplied) return { cursor, action: "duplicate" };
  return { cursor: { lastApplied: seq, applied }, action: "applied" };
}
