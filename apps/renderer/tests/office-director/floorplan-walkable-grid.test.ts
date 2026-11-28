import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { OfficeCastProjector } from "../../src/office/cast/office-cast-projector.js";
import { OfficeCastProjectorPortAdapter } from "../../src/office/director/cast-projector-adapter.js";
import { AStarTilePathfinder } from "../../src/office/director/a-star-tile-pathfinder.js";
import { FloorPlanWalkableGridPort } from "../../src/office/director/floor-plan-walkable-grid.js";
import { createSyntheticOfficeWalkableGrid } from "../../src/office/director/synthetic-walkable-grid.js";
import { ROOM_IDS } from "../../src/office/renderer/room-ids.js";
import { TiledFloorPlanLoader } from "../../src/office/renderer/tiled-floor-plan-loader.js";
import { makeSnapshot, makeWorker } from "../office-cast/fixtures.js";

function loadPlan() {
  const raw = readFileSync(new URL("../../assets/office/floorplan-v1.tmj", import.meta.url), "utf8");
  return new TiledFloorPlanLoader().loadFromText(raw);
}

describe("floorplan walkable grid", () => {
  it("derives the 11-room grid from floorplan-v1.tmj instead of the synthetic stand-in", () => {
    const plan = loadPlan();
    const grid = new FloorPlanWalkableGridPort(plan).snapshot();
    const synthetic = createSyntheticOfficeWalkableGrid();
    expect(grid.width).toBe(plan.width);
    expect(grid.height).toBe(plan.height);
    expect(grid.walkable.size).toBe(plan.walkable.filter((cell) => cell === 1).length);
    expect(grid.roomDoorways.size).toBe(ROOM_IDS.length);
    expect(grid.roomDesks.size).toBe(ROOM_IDS.length);
    const sameCells =
      grid.walkable.size === synthetic.walkable.size &&
      [...grid.walkable].every((cell) => synthetic.walkable.has(cell));
    expect(sameCells).toBe(false);
    const path = new AStarTilePathfinder(grid).findRoomPath("ceo-office", "qa-verification-lab");
    expect(path.status).toBe("ok");
    expect(path.path.length).toBeGreaterThan(1);
  });

  it("adapts OfficeCastProjector.project onto the director cast port", () => {
    const plan = loadPlan();
    const adapter = new OfficeCastProjectorPortAdapter(new OfficeCastProjector(plan));
    adapter.publish(
      makeSnapshot([makeWorker({ role: "verifier", agentId: "A0014", taskId: "T-14" })]),
      1_000,
    );
    expect(adapter.project("A0014")?.truthfulRoomId).toBe("qa-verification-lab");
    expect(adapter.listActiveAgentIds()).toEqual(["A0014"]);
  });
});
