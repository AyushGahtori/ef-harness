import { describe, expect, it } from "vitest";

import { TiledFloorPlanLoader } from "../../src/office/renderer/tiled-floor-plan-loader.js";
import { ROOM_IDS } from "../../src/office/renderer/room-ids.js";
import { CozyPixelSpriteAtlasEngine } from "../../src/office/renderer/cozy-pixel-sprite-atlas-engine.js";

describe("office-renderer floorplan", () => {
  it("loads floorplan-v1.tmj with all 11 rooms, desk anchors, and full connectivity", () => {
    const loader = new TiledFloorPlanLoader();
    const plan = loader.loadFromPath();
    expect(plan.rooms).toHaveLength(ROOM_IDS.length);
    expect(plan.deskAnchors).toHaveLength(ROOM_IDS.length);
    for (const id of ROOM_IDS) {
      expect(plan.rooms.some((r) => r.roomId === id)).toBe(true);
      expect(plan.deskAnchors.some((d) => d.roomId === id)).toBe(true);
    }
    expect(loader.verifyRoomConnectivity(plan)).toBe(true);
  });
});

describe("office-renderer atlas", () => {
  it("validates Aseprite frames, nearest 16-px sizing, depth order, and < 24 MB budget", () => {
    const atlas = new CozyPixelSpriteAtlasEngine();
    atlas.loadFromDisk();
    const frames = atlas.listFrames();
    expect(frames.length).toBeGreaterThan(10);
    expect(atlas.withinBudget()).toBe(true);
    expect(atlas.estimateGpuBytes()).toBeLessThan(24 * 1024 * 1024);
    for (const frame of frames) {
      expect(frame.frame.w).toBe(16);
      expect(frame.frame.h).toBe(16);
    }
    const depths = new Set(frames.map((f) => f.depth));
    expect(depths.has("floor")).toBe(true);
    expect(depths.has("characters")).toBe(true);
    expect(depths.has("labels")).toBe(true);
  });
});