import { isWalkable, representativeWalkableTile } from "../renderer/floorplan-bfs.js";
import { ROOM_IDS, type OfficeRoomId } from "../renderer/room-ids.js";
import type { DeskAnchor, LoadedFloorPlan, RoomBounds } from "../renderer/types.js";
import type { TileCoord, WalkableGridPort, WalkableGridSnapshot } from "./types.js";

function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

function deskTile(plan: LoadedFloorPlan, anchor: DeskAnchor): TileCoord {
  if (isWalkable(plan.walkable, plan.width, plan.height, anchor.tile.x, anchor.tile.y)) {
    return { col: anchor.tile.x, row: anchor.tile.y };
  }
  const room = plan.rooms.find((entry) => entry.roomId === anchor.roomId);
  if (room) {
    const tile = representativeWalkableTile(
      plan.walkable,
      plan.width,
      plan.height,
      room.tile.x,
      room.tile.y,
      room.tile.w,
      room.tile.h,
    );
    if (tile) return { col: tile.x, row: tile.y };
  }
  return { col: anchor.tile.x, row: anchor.tile.y };
}

function doorwayTile(plan: LoadedFloorPlan, room: RoomBounds, desk: TileCoord): TileCoord {
  const { x, y, w, h } = room.tile;
  let best: { readonly col: number; readonly row: number; readonly score: number } | null = null;
  for (let row = y; row < y + h; row += 1) {
    for (let col = x; col < x + w; col += 1) {
      if (!isWalkable(plan.walkable, plan.width, plan.height, col, row)) continue;
      const opensOutside = [
        [col + 1, row],
        [col - 1, row],
        [col, row + 1],
        [col, row - 1],
      ].some(([nextCol, nextRow]) => {
        if (nextCol === undefined || nextRow === undefined) return false;
        const outside = nextCol < x || nextRow < y || nextCol >= x + w || nextRow >= y + h;
        return outside && isWalkable(plan.walkable, plan.width, plan.height, nextCol, nextRow);
      });
      if (!opensOutside) continue;
      const score = Math.abs(col - desk.col) + Math.abs(row - desk.row);
      if (!best || score < best.score) best = { col, row, score };
    }
  }
  return best ?? desk;
}

/** Walkable cells, doorways, and desks taken from `floorplan-v1.tmj`, not the synthetic grid. */
export function walkableGridFromFloorPlan(plan: LoadedFloorPlan): WalkableGridSnapshot {
  const walkable = new Set<string>();
  for (let row = 0; row < plan.height; row += 1) {
    for (let col = 0; col < plan.width; col += 1) {
      if (plan.walkable[row * plan.width + col] === 1) walkable.add(cellKey(col, row));
    }
  }
  const roomDoorways = new Map<OfficeRoomId, TileCoord>();
  const roomDesks = new Map<OfficeRoomId, TileCoord>();
  for (const roomId of ROOM_IDS) {
    const room = plan.rooms.find((entry) => entry.roomId === roomId);
    const anchor = plan.deskAnchors.find((entry) => entry.roomId === roomId);
    if (!room || !anchor) {
      throw new Error(`floor plan is missing room ${roomId}`);
    }
    const desk = deskTile(plan, anchor);
    roomDesks.set(roomId, desk);
    roomDoorways.set(roomId, doorwayTile(plan, room, desk));
  }
  return {
    width: plan.width,
    height: plan.height,
    walkable,
    roomDoorways,
    roomDesks,
  };
}

export class FloorPlanWalkableGridPort implements WalkableGridPort {
  private state: WalkableGridSnapshot;

  constructor(plan: LoadedFloorPlan) {
    this.state = walkableGridFromFloorPlan(plan);
  }

  snapshot(): WalkableGridSnapshot {
    return this.state;
  }

  replace(plan: LoadedFloorPlan): void {
    this.state = walkableGridFromFloorPlan(plan);
  }
}
