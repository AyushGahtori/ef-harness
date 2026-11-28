import type { BackfillCheckpoint } from "./types.js";

export function adaptiveSleepMs(batchMs: number): number {
  if (batchMs < 50) return 0;
  const span = Math.min(1, (batchMs - 50) / 150);
  return Math.round(100 + span * 400);
}

export function formatBackfillProgress(input: {
  label: string;
  rowsProcessed: number;
  rowsTotal: number;
  batchMs: number;
}): string {
  const percent = input.rowsTotal === 0 ? 100 : Math.round((input.rowsProcessed / input.rowsTotal) * 100);
  const processed = input.rowsProcessed.toLocaleString("en-US");
  const total = input.rowsTotal.toLocaleString("en-US");
  return `Backfilling ${input.label}: ${processed} / ${total} rows (${percent}%) · ${input.batchMs} ms/batch · Pause`;
}

export function nextIntegerPk(lastProcessedPk: string | null): string | null {
  if (lastProcessedPk === null) return null;
  if (!/^-?\d+$/.test(lastProcessedPk)) return null;
  return String(Number(lastProcessedPk) + 1);
}

export function checkpointProgress(checkpoint: BackfillCheckpoint): string {
  return checkpoint.progressText;
}
