import type { OfficeRoomId } from "./constants.js";

export type OfficeStatusIcon =
  | "idle"
  | "typing"
  | "working"
  | "verifying"
  | "integrating"
  | "done"
  | "paused"
  | "error"
  | "hold"
  | "question"
  | "checkmark";

export type HealthSignal = "ok" | "stuck" | "loop" | "held" | "waiting_on_you";

export interface TileCoord {
  readonly col: number;
  readonly row: number;
}

export interface WalkableGridSnapshot {
  readonly width: number;
  readonly height: number;
  readonly walkable: ReadonlySet<string>;
  readonly roomDoorways: ReadonlyMap<OfficeRoomId, TileCoord>;
  readonly roomDesks: ReadonlyMap<OfficeRoomId, TileCoord>;
}

export interface WalkableGridPort {
  snapshot(): WalkableGridSnapshot;
}

export interface CastProjection {
  readonly agentId: string;
  readonly truthfulRoomId: OfficeRoomId;
  readonly statusIcon: OfficeStatusIcon;
  readonly health: HealthSignal;
  readonly stateTimestampMs: number;
  readonly urgent: boolean;
}

export interface OfficeCastProjectorPort {
  project(agentId: string): CastProjection | null;
  listActiveAgentIds(): readonly string[];
}

export interface MotionEnqueue {
  readonly agentId: string;
  readonly targetRoomId: OfficeRoomId;
  readonly enqueuedAtMs: number;
  readonly authoritativeStateMs: number;
}

export interface PathQueryResult {
  readonly status: "ok" | "no_path";
  readonly path: readonly TileCoord[];
  readonly elapsedMs: number;
  readonly usedSnapFallback: boolean;
}

export interface CharacterMotionSnapshot {
  readonly agentId: string;
  readonly visualRoomId: OfficeRoomId;
  readonly truthfulRoomId: OfficeRoomId;
  readonly visualTile: TileCoord;
  readonly statusIcon: OfficeStatusIcon;
  readonly health: HealthSignal;
  readonly walking: boolean;
  readonly visualLagMs: number;
  readonly queueDepth: number;
  readonly dwellRemainingMs: number;
}

export interface DirectorTelemetry {
  readonly currentFps: number;
  readonly avgTickMs: number;
  readonly maxVisualLagMs: number;
  readonly activeWalkersCount: number;
  readonly continuousMotionCount: number;
  readonly tickCadence: "active" | "idle" | "hidden";
}

export interface ParcelCourierSnapshot {
  readonly id: string;
  readonly fromRoomId: OfficeRoomId;
  readonly toRoomId: OfficeRoomId;
  readonly progress: number;
  readonly cosmeticOnly: true;
}

export interface VirtualClock {
  readonly nowMs: number;
  readonly dtMs: number;
}

export type MovementMode = "eight_way" | "four_way";