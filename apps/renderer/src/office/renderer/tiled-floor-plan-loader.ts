import fs from "node:fs";

import { ROOM_IDS, type OfficeRoomId } from "./room-ids.js";
import { floorPlanAssetPath } from "./asset-paths.js";
import { representativeWalkableTile, tilesReachable } from "./floorplan-bfs.js";
import type { DeskAnchor, LoadedFloorPlan, RoomBounds } from "./types.js";

type TiledProperty = { readonly name: string; readonly value: string | number | boolean };

type TiledObject = {
  readonly name?: string;
  readonly type?: string;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  readonly point?: boolean;
  readonly properties?: ReadonlyArray<TiledProperty>;
};

type TiledLayer =
  | { readonly type: "tilelayer"; readonly name: string; readonly data: ReadonlyArray<number> }
  | { readonly type: "objectgroup"; readonly name: string; readonly objects: ReadonlyArray<TiledObject> };

type TiledMap = {
  readonly width: number;
  readonly height: number;
  readonly tilewidth: number;
  readonly tileheight: number;
  readonly layers: ReadonlyArray<TiledLayer>;
};

function prop(object: TiledObject, name: string): string | undefined {
  const hit = object.properties?.find((p) => p.name === name);
  if (!hit) {
    return undefined;
  }
  return String(hit.value);
}

function isRoomId(value: string): value is OfficeRoomId {
  return (ROOM_IDS as ReadonlyArray<string>).includes(value);
}

export class TiledFloorPlanLoader {
  static readonly floorPlanFileName = "floorplan-v1.tmj";

  loadFromPath(filePath: string = floorPlanAssetPath()): LoadedFloorPlan {
    const raw = fs.readFileSync(filePath, "utf8");
    const map = JSON.parse(raw) as TiledMap;
    const walkLayer = map.layers.find((l) => l.type === "tilelayer" && l.name === "walkable");
    const anchorLayer = map.layers.find((l) => l.type === "objectgroup" && l.name === "anchors");
    if (!walkLayer || walkLayer.type !== "tilelayer") {
      throw new Error("floorplan missing walkable layer");
    }
    if (!anchorLayer || anchorLayer.type !== "objectgroup") {
      throw new Error("floorplan missing anchors object layer");
    }

    const tileSize = map.tilewidth;
    const rooms: RoomBounds[] = [];
    const deskAnchors: DeskAnchor[] = [];

    for (const obj of anchorLayer.objects) {
      const roomIdRaw = prop(obj, "roomId") ?? obj.name ?? "";
      if (!isRoomId(roomIdRaw)) {
        continue;
      }
      if (obj.type === "room" && obj.width != null && obj.height != null) {
        const tileX = Math.floor(obj.x / tileSize);
        const tileY = Math.floor(obj.y / tileSize);
        const tileW = Math.max(1, Math.floor(obj.width / tileSize));
        const tileH = Math.max(1, Math.floor(obj.height / tileSize));
        rooms.push({
          roomId: roomIdRaw,
          tile: { x: tileX, y: tileY, w: tileW, h: tileH },
          pixel: { x: obj.x, y: obj.y, w: obj.width, h: obj.height },
        });
      }
      if (obj.type === "desk" && prop(obj, "anchorType") === "desk") {
        const tileX = Math.floor(obj.x / tileSize);
        const tileY = Math.floor(obj.y / tileSize);
        deskAnchors.push({
          roomId: roomIdRaw,
          tile: { x: tileX, y: tileY },
          pixel: { x: obj.x, y: obj.y },
        });
      }
    }

    this.assertElevenRooms(rooms);
    this.assertDeskAnchors(deskAnchors);
    return {
      width: map.width,
      height: map.height,
      tileSize,
      walkable: walkLayer.data,
      rooms,
      deskAnchors,
    };
  }

  /** Verify every pair of rooms is connected via walkable tiles (BFS). */
  verifyRoomConnectivity(plan: LoadedFloorPlan): boolean {
    const tiles = new Map<OfficeRoomId, { x: number; y: number }>();
    for (const room of plan.rooms) {
      const rep = representativeWalkableTile(
        plan.walkable,
        plan.width,
        plan.height,
        room.tile.x,
        room.tile.y,
        room.tile.w,
        room.tile.h,
      );
      if (!rep) {
        return false;
      }
      tiles.set(room.roomId, rep);
    }
    for (let i = 0; i < ROOM_IDS.length; i++) {
      for (let j = i + 1; j < ROOM_IDS.length; j++) {
        const a = tiles.get(ROOM_IDS[i]!);
        const b = tiles.get(ROOM_IDS[j]!);
        if (!a || !b) {
          return false;
        }
        if (!tilesReachable(plan.walkable, plan.width, plan.height, a, b)) {
          return false;
        }
      }
    }
    return true;
  }

  private assertElevenRooms(rooms: ReadonlyArray<RoomBounds>): void {
    const found = new Set(rooms.map((r) => r.roomId));
    for (const id of ROOM_IDS) {
      if (!found.has(id)) {
        throw new Error(`floorplan missing room ${id}`);
      }
    }
    if (found.size !== ROOM_IDS.length) {
      throw new Error(`floorplan has duplicate or unknown room ids (${found.size})`);
    }
  }

  private assertDeskAnchors(deskAnchors: ReadonlyArray<DeskAnchor>): void {
    const byRoom = new Map<OfficeRoomId, number>();
    for (const anchor of deskAnchors) {
      byRoom.set(anchor.roomId, (byRoom.get(anchor.roomId) ?? 0) + 1);
    }
    for (const id of ROOM_IDS) {
      if ((byRoom.get(id) ?? 0) < 1) {
        throw new Error(`floorplan missing desk anchor for ${id}`);
      }
    }
  }
}