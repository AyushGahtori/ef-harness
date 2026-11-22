import { describe, expect, it } from "vitest";
import {
  DisconnectedMonitorBoundsGuard,
  InMemoryScreenPort,
  MIN_VISIBLE_HEIGHT,
  MIN_VISIBLE_WIDTH,
  intersectionSize,
  isTopBarStopVisible,
  type ConnectedDisplay,
  type DipRect,
  type SavedWindowPlacement,
} from "../../src/windows/index.js";

function display(input: {
  id: number;
  primary: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}): ConnectedDisplay {
  const area: DipRect = { x: input.x, y: input.y, width: input.width, height: input.height };
  return {
    id: input.id,
    primary: input.primary,
    scaleFactor: input.scaleFactor,
    bounds: area,
    workArea: area,
  };
}

function laptop(scaleFactor = 1): ConnectedDisplay {
  const width = scaleFactor === 1.5 ? 1280 : 1920;
  const height = scaleFactor === 1.5 ? 720 : 1080;
  return display({
    id: 1,
    primary: true,
    x: 0,
    y: 0,
    width,
    height,
    scaleFactor,
  });
}

function external(): ConnectedDisplay {
  return display({
    id: 2,
    primary: false,
    x: 2560,
    y: 0,
    width: 3840,
    height: 2160,
    scaleFactor: 1,
  });
}

function expectOnScreen(bounds: DipRect, displays: readonly ConnectedDisplay[]): void {
  expect(isTopBarStopVisible(bounds, displays)).toBe(true);
  const visible = displays.some((item) => {
    const hit = intersectionSize(bounds, item.workArea);
    return hit !== null && hit.width >= MIN_VISIBLE_WIDTH && hit.height >= MIN_VISIBLE_HEIGHT;
  });
  expect(visible).toBe(true);
  const host = displays.find((item) => {
    const hit = intersectionSize(bounds, item.workArea);
    return hit !== null && hit.width >= MIN_VISIBLE_WIDTH && hit.height >= MIN_VISIBLE_HEIGHT;
  });
  expect(host).toBeDefined();
  if (!host) return;
  expect(bounds.width).toBeLessThanOrEqual(host.workArea.width);
  expect(bounds.height).toBeLessThanOrEqual(host.workArea.height);
}

describe("DisconnectedMonitorBoundsGuard", () => {
  it("centers a window saved on an unplugged 4K monitor onto the built-in display", () => {
    const builtIn = laptop();
    const guard = new DisconnectedMonitorBoundsGuard(new InMemoryScreenPort([builtIn]));
    const saved: SavedWindowPlacement = {
      x: 2560,
      y: 100,
      width: 1600,
      height: 900,
      displayId: 2,
    };

    const recovery = guard.recover(saved, "startup");

    expect(recovery.rescued).toBe(true);
    expect(recovery.centeredOnPrimary).toBe(true);
    expect(recovery.reason).toBe("offscreen-monitor");
    expect(recovery.displayId).toBe(1);
    expect(recovery.bounds).toEqual({ x: 160, y: 90, width: 1600, height: 900 });
    expect(recovery.widthWithinWorkArea).toBe(true);
    expect(recovery.heightWithinWorkArea).toBe(true);
    expect(recovery.topBarStopVisible).toBe(true);
    expectOnScreen(recovery.bounds, [builtIn]);
  });

  it("clamps a full external-monitor window so it still fits the built-in work area", () => {
    const builtIn = laptop();
    const guard = new DisconnectedMonitorBoundsGuard(new InMemoryScreenPort([builtIn]));
    const recovery = guard.recover(
      { x: 2560, y: 0, width: 3840, height: 2160, displayId: 2 },
      "startup",
    );

    expect(recovery.bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(recovery.bounds.width).toBeLessThanOrEqual(builtIn.workArea.width);
    expect(recovery.bounds.height).toBeLessThanOrEqual(builtIn.workArea.height);
    expectOnScreen(recovery.bounds, [builtIn]);
  });

  it("slides a DPI-changed window so the top-bar Stop button stays on screen", () => {
    const scaled = laptop(1.5);
    const guard = new DisconnectedMonitorBoundsGuard(new InMemoryScreenPort([scaled]));
    const saved: SavedWindowPlacement = {
      x: 0,
      y: -20,
      width: 1920,
      height: 1080,
      displayId: 1,
    };

    const recovery = guard.recover(saved, "display-metrics-changed");

    expect(recovery.reason).toBe("dpi-reflow");
    expect(recovery.destinationScaleFactor).toBe(1.5);
    expect(recovery.bounds).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
    expect(recovery.topBarStopVisible).toBe(true);
    expect(recovery.centeredOnPrimary).toBe(false);
    expectOnScreen(recovery.bounds, [scaled]);
  });

  it("leaves a window alone when it already intersects a connected work area", () => {
    const displays = [laptop(), external()];
    const guard = new DisconnectedMonitorBoundsGuard(new InMemoryScreenPort(displays));
    const saved: SavedWindowPlacement = {
      x: 2560,
      y: 80,
      width: 1600,
      height: 900,
      displayId: 2,
    };

    const recovery = guard.recover(saved, "startup");

    expect(recovery.reason).toBe("already-visible");
    expect(recovery.rescued).toBe(false);
    expect(recovery.bounds).toEqual({ x: 2560, y: 80, width: 1600, height: 900 });
    expectOnScreen(recovery.bounds, displays);
  });

  it("rescues a window whose visible strip is under 120 by 80", () => {
    const builtIn = laptop();
    const guard = new DisconnectedMonitorBoundsGuard(new InMemoryScreenPort([builtIn]));
    const recovery = guard.recover(
      { x: 1801, y: 0, width: 119, height: 400, displayId: 1 },
      "startup",
    );

    expect(recovery.reason).toBe("insufficient-intersection");
    expect(recovery.centeredOnPrimary).toBe(true);
    expect(recovery.bounds.width).toBeGreaterThanOrEqual(MIN_VISIBLE_WIDTH);
    expect(recovery.bounds.height).toBeGreaterThanOrEqual(MIN_VISIBLE_HEIGHT);
    expectOnScreen(recovery.bounds, [builtIn]);
  });

  it("pulls a clipped Stop button back inside the work area", () => {
    const builtIn = laptop();
    const guard = new DisconnectedMonitorBoundsGuard(new InMemoryScreenPort([builtIn]));
    const recovery = guard.recover(
      { x: 1800, y: 0, width: 400, height: 300, displayId: 1 },
      "display-metrics-changed",
    );

    expect(recovery.reason).toBe("dpi-reflow");
    expect(recovery.bounds).toEqual({ x: 1520, y: 0, width: 400, height: 300 });
    expect(recovery.topBarStopVisible).toBe(true);
    expectOnScreen(recovery.bounds, [builtIn]);
  });
});
