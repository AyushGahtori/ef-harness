import {
  BULLPEN_VISIBLE_DESK_CAP,
  OFFICE_ROOM_LABEL,
  type HotDeskOverflowSnapshot,
  type OfficeWorkerRecord,
  type SeatedWorkerPlacement,
} from "./types.js";

export function rankWorkersForBullpen(workers: readonly OfficeWorkerRecord[]): OfficeWorkerRecord[] {
  return [...workers].sort((left, right) => {
    const flaggedDelta = Number(right.flagged === true) - Number(left.flagged === true);
    if (flaggedDelta !== 0) return flaggedDelta;
    const inboxDelta = Number(right.inboxItem === true) - Number(left.inboxItem === true);
    if (inboxDelta !== 0) return inboxDelta;
    return right.priority - left.priority || left.agentId.localeCompare(right.agentId);
  });
}

export function hotDeskOverflowLabel(overflowCount: number): string {
  if (overflowCount <= 0) return "";
  return `+${overflowCount} more agents working in background — View all on Board`;
}

/**
 * Keeps at most 28 bullpen workers visible; overflow aggregates to the hot-desk counter.
 */
export class HotDeskOverflowAggregator {
  aggregate(workers: readonly OfficeWorkerRecord[]): HotDeskOverflowSnapshot {
    const bullpen = workers.filter((worker) => worker.roomId === "engineering_bullpen");
    const other = workers.filter((worker) => worker.roomId !== "engineering_bullpen");
    const ranked = rankWorkersForBullpen(bullpen);
    const seatedBullpen = ranked.slice(0, BULLPEN_VISIBLE_DESK_CAP);
    const overflow = ranked.length - seatedBullpen.length;
    const seated: SeatedWorkerPlacement[] = [
      ...other.map((worker, deskIndex) => ({
        worker,
        deskIndex,
        seated: true,
      })),
      ...seatedBullpen.map((worker, deskIndex) => ({
        worker,
        deskIndex,
        seated: true,
      })),
    ];
    return {
      seated,
      overflowCount: Math.max(0, overflow),
      overflowLabel: hotDeskOverflowLabel(Math.max(0, overflow)),
    };
  }

  roomHeading(roomId: keyof typeof OFFICE_ROOM_LABEL, inboxCount: number): string {
    if (roomId === "ceo_office") {
      return `${OFFICE_ROOM_LABEL.ceo_office} (${inboxCount} inbox items)`;
    }
    if (roomId === "engineering_bullpen") {
      return `${OFFICE_ROOM_LABEL.engineering_bullpen} (grouped by Feature)`;
    }
    return OFFICE_ROOM_LABEL[roomId];
  }
}