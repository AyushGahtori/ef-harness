import { OFFICE_ROOM_IDS, type OfficeRoomId } from "./constants.js";
import type { TileCoord, WalkableGridSnapshot } from "./types.js";

function key(col: number, row: number): string {
  return `${col},${row}`;
}

/** Deterministic ~60×40 nav grid with all 11 rooms reachable (Task 162 stand-in). */
export function createSyntheticOfficeWalkableGrid(): WalkableGridSnapshot {
  const width = 60;
  const height = 40;
  const walkable = new Set<string>();
  const corridorRow = 20;

  for (let col = 1; col < width - 1; col += 1) {
    walkable.add(key(col, corridorRow));
    walkable.add(key(col, corridorRow - 1));
    walkable.add(key(col, corridorRow + 1));
  }

  const roomDoorways = new Map<OfficeRoomId, TileCoord>();
  const roomDesks = new Map<OfficeRoomId, TileCoord>();
  const spacing = Math.floor((width - 4) / OFFICE_ROOM_IDS.length);

  OFFICE_ROOM_IDS.forEach((roomId, index) => {
    const col = 2 + index * spacing;
    const north = index % 2 === 0;
    const doorway: TileCoord = { col, row: north ? corridorRow - 2 : corridorRow + 2 };
    const desk: TileCoord = { col, row: north ? corridorRow - 5 : corridorRow + 5 };
    roomDoorways.set(roomId, doorway);
    roomDesks.set(roomId, desk);
    walkable.add(key(doorway.col, doorway.row));
    walkable.add(key(desk.col, desk.row));
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const c = desk.col + dc;
        const r = desk.row + dr;
        if (c > 0 && c < width - 1 && r > 0 && r < height - 1) {
          walkable.add(key(c, r));
        }
      }
    }
    const step = north ? -1 : 1;
    for (let row = doorway.row; row !== desk.row; row += step) {
      walkable.add(key(doorway.col, row));
    }
  });

  const blockCol = 30;
  const blockRow = corridorRow;
  walkable.delete(key(blockCol, blockRow));

  return {
    width,
    height,
    walkable,
    roomDoorways,
    roomDesks,
  };
}

export function addDynamicBlock(
  snapshot: WalkableGridSnapshot,
  tile: TileCoord,
): WalkableGridSnapshot {
  const walkable = new Set(snapshot.walkable);
  walkable.delete(key(tile.col, tile.row));
  return { ...snapshot, walkable };
}