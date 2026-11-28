import type { OfficeRoomId } from "./room-ids.js";

export type TileCoord = { readonly x: number; readonly y: number };

export type DeskAnchor = {
  readonly roomId: OfficeRoomId;
  readonly tile: TileCoord;
  readonly pixel: { readonly x: number; readonly y: number };
};

export type RoomBounds = {
  readonly roomId: OfficeRoomId;
  readonly tile: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly pixel: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
};

export type LoadedFloorPlan = {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly walkable: ReadonlyArray<number>;
  readonly rooms: ReadonlyArray<RoomBounds>;
  readonly deskAnchors: ReadonlyArray<DeskAnchor>;
};

export type OfficeThemeMode = "light" | "dark";

export type OfficePalette = {
  readonly ambient: number;
  readonly lampGlow: number;
  readonly floorTint: number;
};

export type CameraViewport = {
  readonly offsetX: number;
  readonly offsetY: number;
  /** Integer zoom step 1–4. */
  readonly zoomStep: 1 | 2 | 3 | 4;
};

export type AsepriteFrame = {
  readonly frame: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly sourceSize: { readonly w: number; readonly h: number };
};

export type SpriteDepthLayer =
  | "floor"
  | "rugs"
  | "furniture"
  | "characters"
  | "desk-props"
  | "status-icons"
  | "labels";