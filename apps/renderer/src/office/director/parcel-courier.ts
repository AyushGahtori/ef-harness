import { DIRECTOR_LIMITS } from "./constants.js";
import type { OfficeRoomId } from "./constants.js";
import type { AStarTilePathfinder } from "./a-star-tile-pathfinder.js";
import type { ParcelCourierSnapshot, TileCoord, VirtualClock } from "./types.js";

export interface ParcelHandoffRequest {
  readonly id: string;
  readonly fromRoomId: OfficeRoomId;
  readonly toRoomId: OfficeRoomId;
  readonly requestedAtMs: number;
}

/**
 * Cosmetic paper/parcel transfer along the corridor. Inbox cards commit at t=0 regardless.
 */
interface ActiveParcel {
  id: string;
  fromRoomId: OfficeRoomId;
  toRoomId: OfficeRoomId;
  progress: number;
  cosmeticOnly: true;
  path: TileCoord[];
  cursor: number;
}

export class ParcelCourierAnimator {
  private readonly active = new Map<string, ActiveParcel>();

  constructor(private readonly pathfinder: AStarTilePathfinder) {}

  start(request: ParcelHandoffRequest): ParcelCourierSnapshot {
    const path =
      this.pathfinder.findRoomPath(request.fromRoomId, request.toRoomId).path.length > 1
        ? this.pathfinder.findRoomPath(request.fromRoomId, request.toRoomId).path
        : [];
    const snap: ActiveParcel = {
      id: request.id,
      fromRoomId: request.fromRoomId,
      toRoomId: request.toRoomId,
      progress: 0,
      cosmeticOnly: true,
      path: [...path],
      cursor: 0,
    };
    this.active.set(request.id, snap);
    return snap;
  }

  collapseToLatest(id: string, toRoomId: OfficeRoomId, nowMs: number): ParcelCourierSnapshot | null {
    void nowMs;
    const current = this.active.get(id);
    if (!current) return null;
    const path = this.pathfinder.findRoomPath(current.fromRoomId, toRoomId).path;
    current.toRoomId = toRoomId;
    current.path = [...path];
    current.cursor = path.length > 0 ? path.length - 1 : 0;
    current.progress = 1;
    this.active.set(id, current);
    return current;
  }

  tick(clock: VirtualClock): ParcelCourierSnapshot[] {
    const out: ParcelCourierSnapshot[] = [];
    for (const parcel of this.active.values()) {
      if (parcel.path.length <= 1) {
        parcel.progress = 1;
      } else {
        const advance = Math.max(1, Math.floor((clock.dtMs || 16) / DIRECTOR_LIMITS.walkMsPerTile));
        parcel.cursor = Math.min(parcel.path.length - 1, parcel.cursor + advance);
        parcel.progress = parcel.cursor / (parcel.path.length - 1);
      }
      out.push(parcel);
      if (parcel.progress >= 1) this.active.delete(parcel.id);
    }
    return out;
  }
}