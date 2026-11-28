import type { LoadedFloorPlan } from "../renderer/types.js";
import type { OfficeWorkerRecord, RoomId } from "./types.js";

export const QA_VERIFICATION_LAB = "qa-verification-lab" as const satisfies RoomId;

/** Pool 2 is drawn as 2–4 glowing test rigs. */
export function clampRigCount(capacity: number | undefined): number {
  const value = capacity ?? 2;
  if (!Number.isFinite(value) || value < 2) return 2;
  if (value > 4) return 4;
  return Math.floor(value);
}

/** Place seat `index` on the room's tiled desk anchor, then a 4-column grid. */
export function deskAnchor(
  plan: LoadedFloorPlan,
  roomId: RoomId,
  index: number,
): { readonly x: number; readonly y: number } {
  const origin = plan.deskAnchors.find((anchor) => anchor.roomId === roomId);
  if (!origin) {
    throw new Error(`floorplan missing desk anchor for ${roomId}`);
  }
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: origin.pixel.x + col * 16, y: origin.pixel.y + row * 18 };
}

const BREAK_ROOM_STATUSES = new Set<OfficeWorkerRecord["status"]>([
  "idle",
  "parked",
  "allowance-waiting",
]);

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
      return QA_VERIFICATION_LAB;
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
