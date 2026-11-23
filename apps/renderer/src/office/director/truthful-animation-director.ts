import { DIRECTOR_LIMITS } from "./constants.js";
import type { OfficeRoomId } from "./constants.js";
import { AStarTilePathfinder } from "./a-star-tile-pathfinder.js";
import { BurstCollapseEventQueue } from "./burst-collapse-event-queue.js";
import { OfficeFrameBudgetMonitor } from "./office-frame-budget-monitor.js";
import { ParcelCourierAnimator } from "./parcel-courier.js";
import type { AnimationDirectorPort } from "./ports.js";
import type {
  CastProjection,
  CharacterMotionSnapshot,
  DirectorTelemetry,
  OfficeCastProjectorPort,
  TileCoord,
  VirtualClock,
  WalkableGridPort,
} from "./types.js";

interface CharacterRuntime {
  readonly queue: BurstCollapseEventQueue;
  truthfulRoomId: OfficeRoomId;
  visualRoomId: OfficeRoomId;
  visualTile: TileCoord;
  statusIcon: CastProjection["statusIcon"];
  health: CastProjection["health"];
  latestStateMs: number;
  walking: boolean;
  path: TileCoord[];
  pathCursor: number;
  dwellUntilMs: number;
  laneOffset: number;
  walkStartMs: number;
}

export interface TruthfulAnimationDirectorOptions {
  readonly cast: OfficeCastProjectorPort;
  readonly grid: WalkableGridPort;
  readonly pathfinder?: AStarTilePathfinder;
  readonly budget?: OfficeFrameBudgetMonitor;
  readonly parcels?: ParcelCourierAnimator;
}

export class TruthfulAnimationDirector implements AnimationDirectorPort {
  private readonly pathfinder: AStarTilePathfinder;
  private readonly budget: OfficeFrameBudgetMonitor;
  private readonly parcels: ParcelCourierAnimator;
  private readonly characters = new Map<string, CharacterRuntime>();
  private motionEnabled = true;
  private officeTabVisible = true;
  private clockMs = 0;
  continuousMotionCount = 0;

  constructor(private readonly options: TruthfulAnimationDirectorOptions) {
    const grid = options.grid.snapshot();
    this.pathfinder = options.pathfinder ?? new AStarTilePathfinder(grid);
    this.budget = options.budget ?? new OfficeFrameBudgetMonitor();
    this.parcels = options.parcels ?? new ParcelCourierAnimator(this.pathfinder);
    for (const agentId of options.cast.listActiveAgentIds()) {
      this.ensureCharacter(agentId);
    }
  }

  setMotionEnabled(enabled: boolean): void {
    this.motionEnabled = enabled;
    this.budget.setReducedMotion(!enabled);
    if (!enabled) {
      this.seatAllAtDesks();
    }
  }

  seatAllAtDesks(): void {
    for (const runtime of this.characters.values()) {
      runtime.queue.clear();
      runtime.walking = false;
      runtime.path = [];
      runtime.pathCursor = 0;
      runtime.visualRoomId = runtime.truthfulRoomId;
      const desk = this.options.grid.snapshot().roomDesks.get(runtime.truthfulRoomId);
      if (desk) runtime.visualTile = desk;
    }
    this.continuousMotionCount = 0;
  }

  setOfficeTabVisible(visible: boolean): void {
    this.officeTabVisible = visible;
    this.budget.setVisibility(visible ? "active" : "hidden");
    if (!visible) {
      this.seatAllAtDesks();
    }
  }

  ingestProjection(projection: CastProjection, nowMs = projection.stateTimestampMs): CharacterMotionSnapshot {
    this.clockMs = nowMs;
    const runtime = this.ensureCharacter(projection.agentId);
    runtime.statusIcon = projection.statusIcon;
    runtime.health = projection.health;
    runtime.latestStateMs = projection.stateTimestampMs;
    const roomChanged = runtime.truthfulRoomId !== projection.truthfulRoomId;
    runtime.truthfulRoomId = projection.truthfulRoomId;
    if (roomChanged) {
      const collapse = runtime.queue.enqueue(
        projection.truthfulRoomId,
        projection.stateTimestampMs,
        projection.stateTimestampMs,
      );
      if (projection.urgent) {
        runtime.dwellUntilMs = 0;
        runtime.queue.clear();
        runtime.queue.enqueue(projection.truthfulRoomId, projection.stateTimestampMs, projection.stateTimestampMs);
      } else if (!collapse.collapsed && runtime.dwellUntilMs > projection.stateTimestampMs) {
        return this.snapshot(projection.agentId, nowMs, true);
      }
      this.tryStartWalk(runtime, nowMs);
    }
    return this.snapshot(projection.agentId, nowMs, true);
  }

  syncAllFromCast(nowMs: number): CharacterMotionSnapshot[] {
    const out: CharacterMotionSnapshot[] = [];
    for (const agentId of this.options.cast.listActiveAgentIds()) {
      const projection = this.options.cast.project(agentId);
      if (!projection) continue;
      out.push(this.ingestProjection({ ...projection, stateTimestampMs: projection.stateTimestampMs || nowMs }));
    }
    return out;
  }

  reconcileTabReturn(nowMs: number): CharacterMotionSnapshot[] {
    this.seatAllAtDesks();
    this.budget.resetMaxVisualLag();
    return this.syncAllFromCast(nowMs);
  }

  tick(clock: VirtualClock): DirectorTelemetry {
    this.clockMs = clock.nowMs;
    const tickStart = performance.now();
    if (!this.motionEnabled || !this.officeTabVisible) {
      return this.budget.telemetry();
    }
    if (!this.budget.shouldTick(clock.nowMs)) {
      return this.budget.telemetry();
    }
    let walkers = 0;
    let continuous = 0;
    let maxLag = 0;
    for (const runtime of this.characters.values()) {
      maxLag = Math.max(maxLag, this.measurePositionLag(runtime, clock.nowMs));
      if (runtime.walking) {
        this.advanceWalk(runtime, clock);
        walkers += 1;
        continuous += 1;
      }
      if (this.shouldSnap(runtime, clock.nowMs)) {
        this.snapToTruth(runtime);
      } else if (!runtime.walking && (!runtime.dwellUntilMs || clock.nowMs >= runtime.dwellUntilMs)) {
        this.tryStartWalk(runtime, clock.nowMs);
        if (runtime.walking) {
          walkers += 1;
          continuous += 1;
        }
      }
    }
    this.budget.recordLag(maxLag);
    this.budget.recordWalkers(walkers, continuous);
    this.continuousMotionCount = continuous;
    const tickMs = performance.now() - tickStart;
    this.budget.onTick(tickMs, clock.nowMs);
    this.parcels.tick(clock);
    return this.budget.telemetry();
  }

  getTelemetry(): DirectorTelemetry {
    return this.budget.telemetry();
  }

  getCharacter(agentId: string): CharacterMotionSnapshot | null {
    if (!this.characters.has(agentId)) return null;
    return this.snapshot(agentId, this.clockMs, false);
  }

  private ensureCharacter(agentId: string): CharacterRuntime {
    const existing = this.characters.get(agentId);
    if (existing) return existing;
    const projection = this.options.cast.project(agentId);
    const roomId = projection?.truthfulRoomId ?? "engineering-bullpen";
    const desk = this.options.grid.snapshot().roomDesks.get(roomId) ?? { col: 1, row: 1 };
    const runtime: CharacterRuntime = {
      queue: new BurstCollapseEventQueue(agentId),
      truthfulRoomId: roomId,
      visualRoomId: roomId,
      visualTile: desk,
      statusIcon: projection?.statusIcon ?? "idle",
      health: projection?.health ?? "ok",
      latestStateMs: projection?.stateTimestampMs ?? 0,
      walking: false,
      path: [],
      pathCursor: 0,
      dwellUntilMs: 0,
      laneOffset: this.pickLaneOffset(agentId),
      walkStartMs: 0,
    };
    this.characters.set(agentId, runtime);
    return runtime;
  }

  private pickLaneOffset(agentId: string): number {
    let hash = 0;
    for (let i = 0; i < agentId.length; i += 1) hash = (hash + agentId.charCodeAt(i) * (i + 1)) % 5;
    return hash - 2;
  }

  private tryStartWalk(runtime: CharacterRuntime, nowMs: number): void {
    if (!this.motionEnabled || runtime.walking) return;
    if (runtime.dwellUntilMs > nowMs && runtime.visualRoomId === runtime.truthfulRoomId) return;
    const next = runtime.queue.peek();
    const targetRoom = next?.targetRoomId ?? runtime.truthfulRoomId;
    if (runtime.visualRoomId === targetRoom && runtime.visualRoomId === runtime.truthfulRoomId) return;
    const pathResult = this.pathfinder.findRoomPath(runtime.visualRoomId, targetRoom, runtime.laneOffset);
    if (pathResult.status === "no_path" || pathResult.usedSnapFallback) {
      this.snapToRoom(runtime, targetRoom);
      runtime.queue.shift();
      return;
    }
    runtime.path = [...pathResult.path];
    runtime.pathCursor = 0;
    runtime.walking = true;
    runtime.walkStartMs = nowMs;
  }

  private advanceWalk(runtime: CharacterRuntime, clock: VirtualClock): void {
    if (runtime.path.length === 0) {
      runtime.walking = false;
      return;
    }
    const tilesFromStart = Math.floor((clock.nowMs - runtime.walkStartMs) / DIRECTOR_LIMITS.walkMsPerTile);
    const stepDelta = Math.max(1, Math.floor((clock.dtMs || 16) / DIRECTOR_LIMITS.walkMsPerTile));
    const targetCursor = Math.min(runtime.path.length - 1, Math.max(runtime.pathCursor + stepDelta, tilesFromStart));
    runtime.pathCursor = targetCursor;
    runtime.visualTile = runtime.path[runtime.pathCursor] ?? runtime.visualTile;
    if (runtime.pathCursor >= runtime.path.length - 1) {
      runtime.walking = false;
      runtime.visualRoomId = runtime.truthfulRoomId;
      runtime.queue.shift();
      runtime.dwellUntilMs = clock.nowMs + DIRECTOR_LIMITS.minDwellMs;
    }
  }

  private shouldSnap(runtime: CharacterRuntime, nowMs: number): boolean {
    if (runtime.visualRoomId === runtime.truthfulRoomId && !runtime.walking) {
      return false;
    }
    const lag = nowMs - runtime.latestStateMs;
    if (!runtime.walking || runtime.path.length === 0) {
      return runtime.visualRoomId !== runtime.truthfulRoomId && lag > DIRECTOR_LIMITS.maxVisualLagMs;
    }
    const remainingTiles = runtime.path.length - 1 - runtime.pathCursor;
    const remainingMs = remainingTiles * DIRECTOR_LIMITS.walkMsPerTile;
    return lag + remainingMs > DIRECTOR_LIMITS.maxVisualLagMs;
  }

  private snapToTruth(runtime: CharacterRuntime): void {
    runtime.queue.clear();
    this.snapToRoom(runtime, runtime.truthfulRoomId);
    runtime.walking = false;
    runtime.dwellUntilMs = 0;
  }

  private snapToRoom(runtime: CharacterRuntime, roomId: OfficeRoomId): void {
    const desk = this.options.grid.snapshot().roomDesks.get(roomId);
    if (desk) runtime.visualTile = desk;
    runtime.visualRoomId = roomId;
    runtime.path = [];
    runtime.pathCursor = 0;
  }

  private measurePositionLag(runtime: CharacterRuntime, nowMs: number): number {
    if (runtime.visualRoomId === runtime.truthfulRoomId && !runtime.walking) {
      return 0;
    }
    const stateAge = Math.max(0, nowMs - runtime.latestStateMs);
    if (!runtime.walking || runtime.path.length === 0) {
      return runtime.visualRoomId !== runtime.truthfulRoomId ? stateAge : 0;
    }
    const remainingTiles = runtime.path.length - 1 - runtime.pathCursor;
    return stateAge + remainingTiles * DIRECTOR_LIMITS.walkMsPerTile;
  }

  private snapshot(agentId: string, nowMs: number, statusFrameZero: boolean): CharacterMotionSnapshot {
    const runtime = this.characters.get(agentId);
    if (!runtime) {
      throw new Error(`unknown agent ${agentId}`);
    }
    const positionLag = this.measurePositionLag(runtime, nowMs);
    return {
      agentId,
      visualRoomId: runtime.visualRoomId,
      truthfulRoomId: runtime.truthfulRoomId,
      visualTile: runtime.visualTile,
      statusIcon: runtime.statusIcon,
      health: runtime.health,
      walking: runtime.walking,
      visualLagMs: statusFrameZero ? 0 : positionLag,
      queueDepth: runtime.queue.depth(),
      dwellRemainingMs: Math.max(0, runtime.dwellUntilMs - nowMs),
    };
  }
}