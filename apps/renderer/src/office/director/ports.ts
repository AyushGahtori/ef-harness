import type { CastProjection, OfficeCastProjectorPort, WalkableGridPort, WalkableGridSnapshot } from "./types.js";
import { createSyntheticOfficeWalkableGrid } from "./synthetic-walkable-grid.js";

export class LocalWalkableGridPort implements WalkableGridPort {
  constructor(private state: WalkableGridSnapshot = createSyntheticOfficeWalkableGrid()) {}

  snapshot(): WalkableGridSnapshot {
    return this.state;
  }

  replace(snapshot: WalkableGridSnapshot): void {
    this.state = snapshot;
  }
}

export class InMemoryOfficeCastProjector implements OfficeCastProjectorPort {
  private readonly projections = new Map<string, CastProjection>();

  seed(projection: CastProjection): void {
    this.projections.set(projection.agentId, projection);
  }

  push(agentId: string, patch: Partial<CastProjection> & { stateTimestampMs: number }): CastProjection {
    const prior = this.projections.get(agentId);
    const next: CastProjection = {
      agentId,
      truthfulRoomId: patch.truthfulRoomId ?? prior?.truthfulRoomId ?? "engineering-bullpen",
      statusIcon: patch.statusIcon ?? prior?.statusIcon ?? "idle",
      health: patch.health ?? prior?.health ?? "ok",
      stateTimestampMs: patch.stateTimestampMs,
      urgent: patch.urgent ?? prior?.urgent ?? false,
    };
    this.projections.set(agentId, next);
    return next;
  }

  project(agentId: string): CastProjection | null {
    return this.projections.get(agentId) ?? null;
  }

  listActiveAgentIds(): readonly string[] {
    return [...this.projections.keys()];
  }
}

export interface AnimationDirectorPort {
  readonly continuousMotionCount: number;
  setMotionEnabled(enabled: boolean): void;
  seatAllAtDesks(): void;
}