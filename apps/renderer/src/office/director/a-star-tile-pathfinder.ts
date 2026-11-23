import { DIRECTOR_LIMITS } from "./constants.js";
import type { OfficeRoomId } from "./constants.js";
import type { MovementMode, PathQueryResult, TileCoord, WalkableGridSnapshot } from "./types.js";

function key(tile: TileCoord): string {
  return `${tile.col},${tile.row}`;
}

class MinHeap {
  private readonly nodes: Array<{ key: string; score: number }> = [];

  push(node: { key: string; score: number }): void {
    this.nodes.push(node);
    this.bubbleUp(this.nodes.length - 1);
  }

  pop(): string | undefined {
    if (this.nodes.length === 0) return undefined;
    const top = this.nodes[0]!.key;
    const last = this.nodes.pop();
    if (this.nodes.length > 0 && last) {
      this.nodes[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  get size(): number {
    return this.nodes.length;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.nodes[parent]!.score <= this.nodes[index]!.score) break;
      [this.nodes[parent], this.nodes[index]] = [this.nodes[index]!, this.nodes[parent]!];
      index = parent;
    }
  }

  private bubbleDown(index: number): void {
    const length = this.nodes.length;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < length && this.nodes[left]!.score < this.nodes[smallest]!.score) smallest = left;
      if (right < length && this.nodes[right]!.score < this.nodes[smallest]!.score) smallest = right;
      if (smallest === index) break;
      [this.nodes[smallest], this.nodes[index]] = [this.nodes[index]!, this.nodes[smallest]!];
      index = smallest;
    }
  }
}

function manhattan(a: TileCoord, b: TileCoord): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

const FOUR_WAY: readonly TileCoord[] = [
  { col: 1, row: 0 },
  { col: -1, row: 0 },
  { col: 0, row: 1 },
  { col: 0, row: -1 },
];

const EIGHT_WAY: readonly TileCoord[] = [
  ...FOUR_WAY,
  { col: 1, row: 1 },
  { col: 1, row: -1 },
  { col: -1, row: 1 },
  { col: -1, row: -1 },
];

function neighbors(tile: TileCoord, mode: MovementMode): TileCoord[] {
  const deltas = mode === "eight_way" ? EIGHT_WAY : FOUR_WAY;
  return deltas.map((delta) => ({ col: tile.col + delta.col, row: tile.row + delta.row }));
}

function cornerSafe(from: TileCoord, to: TileCoord, walkable: ReadonlySet<string>): boolean {
  if (from.col === to.col || from.row === to.row) return true;
  const a = key({ col: to.col, row: from.row });
  const b = key({ col: from.col, row: to.row });
  return walkable.has(a) && walkable.has(b);
}

export class AStarTilePathfinder {
  private readonly doorwayCache = new Map<string, readonly TileCoord[]>();

  constructor(
    private readonly grid: WalkableGridSnapshot,
    private readonly mode: MovementMode = "eight_way",
  ) {
    this.warmRoomCache();
  }

  private warmRoomCache(): void {
    for (const from of this.grid.roomDoorways.keys()) {
      for (const to of this.grid.roomDoorways.keys()) {
        if (from === to) continue;
        const cacheKey = `${from}->${to}`;
        const path = this.computePath(from, to, 0);
        if (path.status === "ok") {
          this.doorwayCache.set(cacheKey, path.path);
        } else {
          const toDesk = this.grid.roomDesks.get(to) ?? this.grid.roomDoorways.get(to);
          if (toDesk) this.doorwayCache.set(cacheKey, [toDesk]);
        }
      }
    }
  }

  findRoomPath(fromRoomId: OfficeRoomId, toRoomId: OfficeRoomId, laneOffset = 0): PathQueryResult {
    const started = performance.now();
    const cacheKey = `${fromRoomId}->${toRoomId}`;
    const cached = this.doorwayCache.get(cacheKey);
    if (cached) {
      const path = this.applyLaneOffset(cached, laneOffset);
      return {
        status: "ok",
        path,
        elapsedMs: performance.now() - started,
        usedSnapFallback: false,
      };
    }
    return this.computePath(fromRoomId, toRoomId, laneOffset, started);
  }

  findTilePath(from: TileCoord, to: TileCoord, laneOffset = 0): PathQueryResult {
    const started = performance.now();
    return this.searchTiles(from, to, laneOffset, started);
  }

  private computePath(
    fromRoomId: OfficeRoomId,
    toRoomId: OfficeRoomId,
    laneOffset: number,
    started = performance.now(),
  ): PathQueryResult {
    const from = this.grid.roomDoorways.get(fromRoomId);
    const to = this.grid.roomDesks.get(toRoomId) ?? this.grid.roomDoorways.get(toRoomId);
    if (!from || !to) {
      return {
        status: "no_path",
        path: [to ?? from ?? { col: 0, row: 0 }],
        elapsedMs: performance.now() - started,
        usedSnapFallback: true,
      };
    }
    const corridor = this.buildCorridorPath(from, to);
    if (corridor) {
      return {
        status: "ok",
        path: this.applyLaneOffset(corridor, laneOffset),
        elapsedMs: performance.now() - started,
        usedSnapFallback: false,
      };
    }
    return {
      status: "no_path",
      path: [to],
      elapsedMs: performance.now() - started,
      usedSnapFallback: true,
    };
  }

  private buildCorridorPath(from: TileCoord, to: TileCoord): TileCoord[] | null {
    const path: TileCoord[] = [{ col: from.col, row: from.row }];
    let cursor = { col: from.col, row: from.row };
    const anchorRow = Math.round((from.row + to.row) / 2);
    if (!this.pushStep(path, cursor, { col: cursor.col, row: anchorRow })) return null;
    cursor = path[path.length - 1]!;
    if (!this.pushStep(path, cursor, { col: to.col, row: anchorRow })) return null;
    cursor = path[path.length - 1]!;
    if (!this.pushStep(path, cursor, to)) return null;
    return path;
  }

  private pushStep(path: TileCoord[], from: TileCoord, to: TileCoord): boolean {
    let { col, row } = from;
    while (col !== to.col || row !== to.row) {
      if (col !== to.col) col += col < to.col ? 1 : -1;
      else if (row !== to.row) row += row < to.row ? 1 : -1;
      const tile = { col, row };
      if (!this.grid.walkable.has(key(tile))) return false;
      path.push(tile);
    }
    return true;
  }

  private searchTiles(
    from: TileCoord,
    to: TileCoord,
    laneOffset: number,
    started: number,
  ): PathQueryResult {
    if (!this.grid.walkable.has(key(from)) || !this.grid.walkable.has(key(to))) {
      return {
        status: "no_path",
        path: [to],
        elapsedMs: performance.now() - started,
        usedSnapFallback: true,
      };
    }
    const fromKey = key(from);
    const open = new MinHeap();
    const openSet = new Set<string>([fromKey]);
    open.push({ key: fromKey, score: manhattan(from, to) });
    const cameFrom = new Map<string, string>();
    const g = new Map<string, number>([[fromKey, 0]]);
    const f = new Map<string, number>([[fromKey, manhattan(from, to)]]);
    let iterations = 0;
    while (open.size > 0 && iterations < 10_000) {
      iterations += 1;
      const currentKey = open.pop();
      if (!currentKey || !openSet.has(currentKey)) continue;
      openSet.delete(currentKey);
      const [col, row] = currentKey.split(",").map(Number) as [number, number];
      const current = { col, row };
      if (current.col === to.col && current.row === to.row) {
        const path = this.reconstruct(cameFrom, currentKey, from);
        const offsetPath = this.applyLaneOffset(path, laneOffset);
        return {
          status: "ok",
          path: offsetPath,
          elapsedMs: performance.now() - started,
          usedSnapFallback: false,
        };
      }
      for (const next of neighbors(current, this.mode)) {
        if (next.col < 0 || next.row < 0 || next.col >= this.grid.width || next.row >= this.grid.height) continue;
        const nextKey = key(next);
        if (!this.grid.walkable.has(nextKey)) continue;
        if (!cornerSafe(current, next, this.grid.walkable)) continue;
        const tentative = (g.get(currentKey) ?? Number.POSITIVE_INFINITY) + 1;
        if (tentative >= (g.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
        cameFrom.set(nextKey, currentKey);
        g.set(nextKey, tentative);
        const nextScore = tentative + manhattan(next, to);
        f.set(nextKey, nextScore);
        if (!openSet.has(nextKey)) {
          openSet.add(nextKey);
          open.push({ key: nextKey, score: nextScore });
        }
      }
    }
    return {
      status: "no_path",
      path: [to],
      elapsedMs: performance.now() - started,
      usedSnapFallback: true,
    };
  }

  private reconstruct(cameFrom: Map<string, string>, currentKey: string, start: TileCoord): TileCoord[] {
    const path: TileCoord[] = [];
    let cursor: string | undefined = currentKey;
    while (cursor) {
      const [col, row] = cursor.split(",").map(Number) as [number, number];
      path.push({ col, row });
      cursor = cameFrom.get(cursor);
    }
    path.reverse();
    if (path.length === 0) return [start];
    return path;
  }

  private applyLaneOffset(path: readonly TileCoord[], laneOffset: number): TileCoord[] {
    if (laneOffset === 0) return [...path];
    const shift = laneOffset > 0 ? 1 : -1;
    return path.map((tile) => {
      const candidate = { col: tile.col + shift, row: tile.row };
      return this.grid.walkable.has(key(candidate)) ? candidate : tile;
    });
  }

  assertQueryBudget(result: PathQueryResult): void {
    if (result.elapsedMs > DIRECTOR_LIMITS.pathQueryBudgetMs) {
      throw new Error(`A* query exceeded ${DIRECTOR_LIMITS.pathQueryBudgetMs}ms budget (${result.elapsedMs})`);
    }
  }
}