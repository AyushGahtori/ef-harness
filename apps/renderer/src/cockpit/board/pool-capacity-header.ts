import type { ThreePoolCapacitySnapshot } from "./types.js";

function roleCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** `Thinking: 8/12 · Run slots: 2/2 (1 Verifier, 1 Worker · 2 queued) · Merge queue: idle` */
export function formatPoolCapacityHeader(snapshot: ThreePoolCapacitySnapshot): string {
  const merge = snapshot.mergeQueueIdle ? "idle" : snapshot.mergeQueueDetail;
  const slots =
    `${roleCount(snapshot.verifierRunSlots, "Verifier", "Verifiers")}, ` +
    `${roleCount(snapshot.workerRunSlots, "Worker", "Workers")} · ${snapshot.runSlotQueueDepth} queued`;
  return (
    `Thinking: ${snapshot.thinkingUsed}/${snapshot.thinkingCapacity} · ` +
    `Run slots: ${snapshot.runSlotsUsed}/${snapshot.runSlotsCapacity} (${slots}) · ` +
    `Merge queue: ${merge}`
  );
}
