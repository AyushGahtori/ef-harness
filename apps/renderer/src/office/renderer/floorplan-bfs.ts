import type { TileCoord } from "./types.js";

const CARDINAL: ReadonlyArray<TileCoord> = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

function key(x: number, y: number): string {
  return `${x},${y}`;
}

export function isWalkable(
  walkable: ReadonlyArray<number>,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return false;
  }
  return walkable[y * width + x] === 1;
}

/** BFS reachability between two tile coords on the walkable grid. */
export function tilesReachable(
  walkable: ReadonlyArray<number>,
  width: number,
  height: number,
  start: TileCoord,
  goal: TileCoord,
): boolean {
  if (!isWalkable(walkable, width, height, start.x, start.y)) {
    return false;
  }
  if (!isWalkable(walkable, width, height, goal.x, goal.y)) {
    return false;
  }
  if (start.x === goal.x && start.y === goal.y) {
    return true;
  }
  const seen = new Set<string>([key(start.x, start.y)]);
  const queue: TileCoord[] = [start];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) {
      break;
    }
    for (const d of CARDINAL) {
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      if (!isWalkable(walkable, width, height, nx, ny)) {
        continue;
      }
      const k = key(nx, ny);
      if (seen.has(k)) {
        continue;
      }
      if (nx === goal.x && ny === goal.y) {
        return true;
      }
      seen.add(k);
      queue.push({ x: nx, y: ny });
    }
  }
  return false;
}

/** Pick a representative walkable tile inside a room rectangle (center tile, then scan). */
export function representativeWalkableTile(
  walkable: ReadonlyArray<number>,
  mapWidth: number,
  mapHeight: number,
  tileX: number,
  tileY: number,
  tileW: number,
  tileH: number,
): TileCoord | null {
  const cx = tileX + Math.floor(tileW / 2);
  const cy = tileY + Math.floor(tileH / 2);
  if (isWalkable(walkable, mapWidth, mapHeight, cx, cy)) {
    return { x: cx, y: cy };
  }
  for (let y = tileY; y < tileY + tileH; y++) {
    for (let x = tileX; x < tileX + tileW; x++) {
      if (isWalkable(walkable, mapWidth, mapHeight, x, y)) {
        return { x, y };
      }
    }
  }
  return null;
}