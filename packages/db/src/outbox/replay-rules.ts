/** Default outbox retention. `created_at` is Unix epoch milliseconds. */
export const DEFAULT_OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const DEFAULT_REPLAY_LIMIT = 500;

export const DEFAULT_LAG_PENDING_THRESHOLD = 100;

/** First retry waits this long, then doubles, capped by {@link DELIVERY_BACKOFF_MAX_MS}. */
export const DELIVERY_BACKOFF_BASE_MS = 50;

export const DELIVERY_BACKOFF_MAX_MS = 1_000;

export const DEFAULT_DELIVERY_ATTEMPTS = 8;

export function deliveryKey(eventId: string, consumer: string): string {
  return `${eventId}:${consumer}`;
}

export function deliveryBackoffMs(
  failedAttempt: number,
  baseDelayMs: number = DELIVERY_BACKOFF_BASE_MS,
  maxDelayMs: number = DELIVERY_BACKOFF_MAX_MS,
): number {
  const exponent = Math.max(0, failedAttempt - 1);
  const raw = baseDelayMs * 2 ** exponent;
  if (!Number.isFinite(raw)) return maxDelayMs;
  return Math.min(maxDelayMs, raw);
}

/**
 * `since_seq` fell behind retained history.
 * `since_seq === 0` and `minRetainedSeq === 1` replays from seq 1.
 * A client caught up with a fully pruned prefix (`sinceSeq >= highWaterSeq`) does not resync.
 */
export function retainedHistoryRequiresResync(input: {
  readonly sinceSeq: number;
  readonly minRetainedSeq: number | null;
  readonly highWaterSeq: number;
}): boolean {
  const { sinceSeq, minRetainedSeq, highWaterSeq } = input;
  if (minRetainedSeq === null) {
    if (highWaterSeq === 0) return false;
    return sinceSeq < highWaterSeq;
  }
  if (sinceSeq === 0 && minRetainedSeq === 1) return false;
  return minRetainedSeq > sinceSeq + 1;
}

/** Task 032 compares the client's last epoch with `meta.stream_epoch`. */
export function streamEpochRequiresResync(
  current: string | null,
  observedByClient: string | null,
): boolean {
  if (current === null || observedByClient === null) return false;
  return current !== observedByClient;
}

export function takeGapFreePrefix<T extends { readonly seq: number }>(
  events: readonly T[],
  sinceSeq: number,
): { readonly page: T[]; readonly hole: boolean } {
  const page: T[] = [];
  let expected = sinceSeq + 1;
  for (const event of events) {
    if (event.seq !== expected) return { page, hole: true };
    page.push(event);
    expected += 1;
  }
  return { page, hole: false };
}
