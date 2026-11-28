import {
  AStarTilePathfinder,
  DIRECTOR_LIMITS,
  OFFICE_ROOM_IDS,
  InMemoryOfficeCastProjector,
  LocalWalkableGridPort,
  TruthfulAnimationDirector,
  createSyntheticOfficeWalkableGrid,
  type OfficeRoomId,
} from "../../src/office/director/index.js";

export function directorFixture(agentIds: string[] = ["agent-a"]) {
  const cast = new InMemoryOfficeCastProjector();
  const grid = new LocalWalkableGridPort();
  for (const agentId of agentIds) {
    cast.seed({
      agentId,
      truthfulRoomId: "engineering-bullpen",
      statusIcon: "idle",
      health: "ok",
      stateTimestampMs: 0,
      urgent: false,
    });
  }
  const director = new TruthfulAnimationDirector({ cast, grid });
  return { cast, grid, director, pathfinder: new AStarTilePathfinder(grid.snapshot()) };
}

export function rapidBurstRooms(): OfficeRoomId[] {
  return [
    "engineering-bullpen",
    "qa-verification-lab",
    "integration-merge-bay",
    "shipping-dock",
    "break-room",
  ];
}

export { DIRECTOR_LIMITS, OFFICE_ROOM_IDS, createSyntheticOfficeWalkableGrid };