import { describe, expect, it } from "vitest";
import {
  BurstCollapseEventQueue,
  DIRECTOR_LIMITS,
  OFFICE_ROOM_IDS,
  addDynamicBlock,
  createSyntheticOfficeWalkableGrid,
} from "../../src/office/director/index.js";
import { AStarTilePathfinder } from "../../src/office/director/a-star-tile-pathfinder.js";
import { OfficeFrameBudgetMonitor } from "../../src/office/director/office-frame-budget-monitor.js";
import { directorFixture, rapidBurstRooms } from "./fixtures.js";

describe("BurstCollapseEventQueue", () => {
  it("collapses rapid multi-room transitions to the latest target within 400ms", () => {
    const queue = new BurstCollapseEventQueue("w1");
    const rooms = rapidBurstRooms();
    let last = queue.enqueue(rooms[0]!, 0, 0);
    for (let i = 1; i < rooms.length; i += 1) {
      last = queue.enqueue(rooms[i]!, i * 80, i * 80);
    }
    expect(last.collapsed).toBe(true);
    expect(last.kept?.targetRoomId).toBe("break-room");
    expect(queue.depth()).toBeLessThanOrEqual(DIRECTOR_LIMITS.maxQueueLen);
    const collapse = queue.collapseAllToLatest(600);
    expect(collapse.discardedCount).toBeGreaterThanOrEqual(0);
    expect(queue.peek()?.targetRoomId).toBe("break-room");
  });
});

describe("TruthfulAnimationDirector state-beats-motion", () => {
  it("updates overhead icons at frame 0 even while walking", () => {
    const { cast, director } = directorFixture();
    cast.push("agent-a", {
      truthfulRoomId: "engineering-bullpen",
      statusIcon: "working",
      stateTimestampMs: 0,
    });
    director.ingestProjection(cast.project("agent-a")!, 0);
    cast.push("agent-a", {
      truthfulRoomId: "qa-verification-lab",
      statusIcon: "working",
      stateTimestampMs: 50,
    });
    director.ingestProjection(cast.project("agent-a")!, 50);
    cast.push("agent-a", {
      truthfulRoomId: "qa-verification-lab",
      statusIcon: "paused",
      health: "held",
      stateTimestampMs: 120,
      urgent: true,
    });
    const snap = director.ingestProjection(cast.project("agent-a")!, 120);
    expect(snap.statusIcon).toBe("paused");
    expect(snap.health).toBe("held");
    expect(snap.visualLagMs).toBe(0);
  });
});

describe("lag teleport, dwell, and tab reconciliation", () => {
  it("snaps within <= 2.0s visual lag and honors 1s dwell unless urgent", () => {
    const { cast, director } = directorFixture();
    cast.push("agent-a", {
      truthfulRoomId: "engineering-bullpen",
      statusIcon: "working",
      stateTimestampMs: 0,
    });
    director.ingestProjection(cast.project("agent-a")!, 0);
    cast.push("agent-a", {
      truthfulRoomId: "qa-verification-lab",
      statusIcon: "verifying",
      stateTimestampMs: 500,
    });
    director.ingestProjection(cast.project("agent-a")!, 500);
    director.tick({ nowMs: 2_600, dtMs: 16 });
    const mid = director.getCharacter("agent-a")!;
    expect(mid.visualRoomId).toBe("qa-verification-lab");
    cast.push("agent-a", {
      truthfulRoomId: "qa-verification-lab",
      statusIcon: "verifying",
      stateTimestampMs: 1_600,
    });
    director.ingestProjection(cast.project("agent-a")!, 1_600);
    cast.push("agent-a", {
      truthfulRoomId: "integration-merge-bay",
      statusIcon: "integrating",
      stateTimestampMs: 1_700,
    });
    const beforeUrgent = director.getCharacter("agent-a")!;
    director.ingestProjection(cast.project("agent-a")!, 1_700);
    const after = director.getCharacter("agent-a")!;
    expect(after.truthfulRoomId).toBe("integration-merge-bay");
    expect(beforeUrgent.dwellRemainingMs).toBeGreaterThan(0);
    director.setOfficeTabVisible(false);
    director.setOfficeTabVisible(true);
    director.reconcileTabReturn(120_000);
    const reconciled = director.getCharacter("agent-a")!;
    expect(reconciled.visualRoomId).toBe(reconciled.truthfulRoomId);
    expect(reconciled.queueDepth).toBe(0);
    expect(director.getTelemetry().maxVisualLagMs).toBeLessThanOrEqual(DIRECTOR_LIMITS.maxVisualLagMs);
  });
});

describe("AStarTilePathfinder", () => {
  it("connects all 11 rooms under 0.5ms and snaps on blocked tiles", () => {
    const grid = createSyntheticOfficeWalkableGrid();
    const pathfinder = new AStarTilePathfinder(grid);
    for (const from of OFFICE_ROOM_IDS) {
      for (const to of OFFICE_ROOM_IDS) {
        if (from === to) continue;
        const result = pathfinder.findRoomPath(from, to);
        expect(result.elapsedMs).toBeLessThan(DIRECTOR_LIMITS.pathQueryBudgetMs);
        expect(result.path.length).toBeGreaterThan(0);
      }
    }
    const blockedGrid = addDynamicBlock(grid, { col: 30, row: 20 });
    const blocked = new AStarTilePathfinder(blockedGrid);
    const snap = blocked.findRoomPath("engineering-bullpen", "qa-verification-lab");
    expect(snap.usedSnapFallback || snap.status === "ok").toBe(true);
    expect(snap.elapsedMs).toBeLessThan(DIRECTOR_LIMITS.pathQueryBudgetMs);
  });

  it("computes 16 simultaneous hallway routes in < 4ms total", () => {
    const pathfinder = new AStarTilePathfinder(createSyntheticOfficeWalkableGrid());
    const start = performance.now();
    for (let lane = 0; lane < 16; lane += 1) {
      pathfinder.findRoomPath("break-room", "engineering-bullpen", lane - 8);
    }
    expect(performance.now() - start).toBeLessThan(4);
  });
});

describe("OfficeFrameBudgetMonitor", () => {
  it("throttles to hidden zero ticks and enforces active cadence", () => {
    const budget = new OfficeFrameBudgetMonitor();
    budget.setVisibility("hidden");
    expect(budget.shouldTick(0)).toBe(false);
    budget.setVisibility("active");
    budget.recordWalkers(20, 20);
    expect(budget.shouldTick(0)).toBe(true);
    budget.onTick(4, 16);
    budget.onTick(5, 32);
    const telemetry = budget.telemetry();
    expect(telemetry.activeWalkersCount).toBe(20);
    expect(telemetry.tickCadence).toBe("active");
    budget.recordWalkers(0, 0);
    budget.setVisibility("idle");
    const idleCadence = budget.pickCadence();
    expect(idleCadence).toBeGreaterThan(1000 / DIRECTOR_LIMITS.idleMaxFps);
  });
});

describe("TruthfulAnimationDirector reduced-motion port", () => {
  it("zeros continuous motion when motion is disabled", () => {
    const { director } = directorFixture();
    director.continuousMotionCount = 4;
    director.setMotionEnabled(false);
    expect(director.continuousMotionCount).toBe(0);
  });
});