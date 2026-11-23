import { describe, expect, it } from "vitest";

import { TiledFloorPlanLoader } from "../../src/office/renderer/tiled-floor-plan-loader.js";
import { OfficeCameraController } from "../../src/office/renderer/office-camera-controller.js";
import { OfficeVisibilityController, type TickerLike } from "../../src/office/renderer/office-visibility-controller.js";
import { paletteForTheme } from "../../src/office/renderer/office-theme-palette.js";
import { OfficePixiViewport } from "../../src/office/renderer/office-pixi-viewport.js";
import { MemoryShellThemePort } from "../../src/office/renderer/local-ports.js";
import { INTEGER_ZOOM_STEPS } from "../../src/office/renderer/office-pixi-viewport.js";

function cameraHarness(): OfficeCameraController {
  const plan = new TiledFloorPlanLoader().loadFromPath();
  return new OfficeCameraController({ viewportWidthPx: 960, viewportHeightPx: 640, plan });
}

describe("office-renderer camera", () => {
  it("uses crisp integer zoom steps and room-jump framing", () => {
    const camera = cameraHarness();
    expect(INTEGER_ZOOM_STEPS).toEqual([1, 2, 3, 4]);
    camera.zoomIn();
    camera.zoomIn();
    expect(camera.snapshot().zoomStep).toBe(3);
    camera.jumpToRoom("engineering-bullpen");
    const after = camera.snapshot();
    expect(after.zoomStep).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(after.offsetX)).toBe(true);
    expect(Number.isInteger(after.offsetY)).toBe(true);
    camera.doubleClickRoomAt(26 * 16 + 80, 12 * 16 + 64);
    expect(camera.snapshot().zoomStep).toBe(3);
  });

  it("switches cozy light/dark palettes", () => {
    const light = paletteForTheme("light");
    const dark = paletteForTheme("dark");
    expect(light.ambient).not.toBe(dark.ambient);
    expect(light.floorTint).not.toBe(dark.floorTint);
  });
});

describe("office-renderer visibility", () => {
  it("stops ticker when tab inactive or hidden (zero render frames)", () => {
    const visibility = new OfficeVisibilityController();
    let started = false;
    const ticker: TickerLike = {
      started: false,
      start: () => {
        started = true;
        ticker.started = true;
      },
      stop: () => {
        started = false;
        ticker.started = false;
      },
      add: (fn) => {
        for (let i = 0; i < 5; i++) {
          fn();
        }
      },
    };
    visibility.bindTicker(ticker);
    expect(started).toBe(true);
    visibility.setTabActive(false);
    expect(started).toBe(false);
    visibility.onTickerFrame();
    visibility.onTickerFrame();
    expect(visibility.framesRenderedWhilePaused()).toBeGreaterThan(0);
    visibility.setTabActive(true);
    expect(started).toBe(true);
  });

  it("recovers from simulated webglcontextlost via viewport hooks", () => {
    const theme = new MemoryShellThemePort();
    const viewport = new OfficePixiViewport({ shellTheme: theme, width: 800, height: 600 });
    viewport.simulateContextLost();
    expect(viewport.isContextLost()).toBe(true);
    viewport.simulateContextRestored();
    expect(viewport.isContextLost()).toBe(false);
  });
});