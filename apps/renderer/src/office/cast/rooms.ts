import type { OfficeWorkerRecord, RoomId } from "./types.js";

/** Local stand-in for Task 162 desk anchors until the tiled floor plan is wired. */
export const ROOM_ORIGIN: Record<RoomId, { readonly x: number; readonly y: number }> = {
  "ceo-office": { x: 24, y: 24 },
  "front-desk": { x: 24, y: 180 },
  "discovery-lounge": { x: 220, y: 24 },
  "research-library": { x: 420, y: 24 },
  "architecture-studio": { x: 620, y: 24 },
  "planning-war-room": { x: 820, y: 24 },
  "engineering-bullpen": { x: 220, y: 200 },
  "qa-lab": { x: 820, y: 200 },
  "integration-merge-bay": { x: 220, y: 420 },
  "shipping-dock": { x: 520, y: 420 },
  "break-room": { x: 820, y: 420 },
};

const BREAK_ROOM_STATUSES = new Set<OfficeWorkerRecord["status"]>([
  "idle",
  "parked",
  "allowance-waiting",
]);

/** Pool 2 is drawn as 2–4 glowing test rigs. */
export function clampRigCount(capacity: number | undefined): number {
  const value = capacity ?? 2;
  if (!Number.isFinite(value) || value < 2) return 2;
  if (value > 4) return 4;
  return Math.floor(value);
}

export function deskAnchor(roomId: RoomId, index: number): { readonly x: number; readonly y: number } {
  const origin = ROOM_ORIGIN[roomId];
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: origin.x + col * 16, y: origin.y + row * 18 };
}

/**
 * Seat a canonical worker. Idle, parked, and allowance-waiting workers sit in
 * the Break Room. Every other role keeps its lifecycle room. CEO Office and
 * Front Desk are not worker seats.
 */
export function roomForWorker(worker: OfficeWorkerRecord): RoomId {
  if (BREAK_ROOM_STATUSES.has(worker.status)) return "break-room";
  switch (worker.role) {
    case "discovery":
    case "spec":
      return "discovery-lounge";
    case "researcher":
      return "research-library";
    case "architect":
      return "architecture-studio";
    case "planner":
      return "planning-war-room";
    case "coder":
      return "engineering-bullpen";
    case "verifier":
      return "qa-lab";
    case "integrator":
      return "integration-merge-bay";
    case "ship":
    case "ci":
      return "shipping-dock";
    default: {
      const unexpected: never = worker.role;
      throw new Error(`Unhandled worker role ${String(unexpected)}`);
    }
  }
}
