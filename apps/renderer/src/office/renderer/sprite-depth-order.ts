import type { SpriteDepthLayer } from "./types.js";

/** Y-sorted depth bands for cozy 16-px layered sprites. */
export const SPRITE_DEPTH_ORDER: ReadonlyArray<SpriteDepthLayer> = [
  "floor",
  "rugs",
  "furniture",
  "characters",
  "desk-props",
  "status-icons",
  "labels",
];

export function depthIndex(layer: SpriteDepthLayer): number {
  return SPRITE_DEPTH_ORDER.indexOf(layer);
}

/** Sort drawables by depth layer then ascending Y (painter's algorithm). */
export function sortByDepthAndY<T extends { depth: SpriteDepthLayer; y: number }>(items: ReadonlyArray<T>): T[] {
  return [...items].sort((a, b) => {
    const da = depthIndex(a.depth);
    const db = depthIndex(b.depth);
    if (da !== db) {
      return da - db;
    }
    return a.y - b.y;
  });
}