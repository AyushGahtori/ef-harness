import { CHANNEL0_MAX_FRAME_BYTES, MAX_EVENT_BATCH_EVENTS } from "./constants.js";
import { utf8Size } from "./byte-size.js";
import { notify } from "./jsonrpc.js";
import type { DomainEvent } from "./ports.js";

export interface EventsBatch {
  readonly from_seq: number;
  readonly to_seq: number;
  readonly events: readonly DomainEvent[];
}

export function topicOf(event: DomainEvent): string {
  return event.topic ?? event.type;
}

export function matchesTopic(event: DomainEvent, topics: readonly string[]): boolean {
  if (topics.length === 0) return true;
  return topics.includes(topicOf(event));
}

export function dedupeSort(events: readonly DomainEvent[]): DomainEvent[] {
  const bySeq = new Map<number, DomainEvent>();
  for (const event of events) {
    if (!bySeq.has(event.seq)) bySeq.set(event.seq, event);
  }
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
}

/**
 * from_seq/to_seq cover every scanned outbox seq, including topic misses, so
 * the client can tell a filter skip from a transport gap.
 */
export function buildEnvelope(
  previousSeq: number,
  rows: readonly DomainEvent[],
  topics: readonly string[],
): EventsBatch | null {
  const ordered = dedupeSort(rows);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  if (!first || !last) return null;
  const fromSeq = first.seq === previousSeq + 1 ? previousSeq + 1 : first.seq;
  const events = ordered.filter(
    (event) => event.seq >= fromSeq && event.seq <= last.seq && matchesTopic(event, topics),
  );
  return { from_seq: fromSeq, to_seq: last.seq, events };
}

export function notificationBytes(method: string, params: unknown): number {
  return utf8Size(notify(method, params));
}

export function splitEnvelopes(
  previousSeq: number,
  rows: readonly DomainEvent[],
  topics: readonly string[],
): EventsBatch[] {
  const ordered = dedupeSort(rows);
  const batches: EventsBatch[] = [];
  let cursor = previousSeq;
  let index = 0;
  while (index < ordered.length) {
    const chunk: DomainEvent[] = [];
    while (index < ordered.length && chunk.length < MAX_EVENT_BATCH_EVENTS) {
      const next = ordered[index];
      if (!next) break;
      const trial = chunk.concat([next]);
      const envelope = buildEnvelope(cursor, trial, topics);
      if (
        envelope &&
        notificationBytes("events.batch", envelope) > CHANNEL0_MAX_FRAME_BYTES &&
        chunk.length > 0
      ) {
        break;
      }
      chunk.push(next);
      index += 1;
    }
    const envelope = buildEnvelope(cursor, chunk, topics);
    if (!envelope) break;
    batches.push(envelope);
    if (envelope.to_seq <= cursor) break;
    cursor = envelope.to_seq;
  }
  return batches;
}
