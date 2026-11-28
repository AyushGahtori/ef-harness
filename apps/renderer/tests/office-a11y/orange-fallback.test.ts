import { describe, expect, it } from "vitest";
import {
  GREEN_RECOVERY_OFFER,
  ORANGE_FALLBACK_BANNER,
  OrangePressureAutoBoardFallback,
} from "../../src/office/a11y/index.js";
import {
  MemoryBoardView,
  MemoryCenterTabs,
  MemoryPixiTicker,
  MemoryPressureMachine,
} from "./fixtures.js";

describe("OrangePressureAutoBoardFallback", () => {
  it("stops Pixi and switches to Board on ORANGE without flickering back until GREEN", () => {
    const pressure = new MemoryPressureMachine();
    const tabs = new MemoryCenterTabs();
    const board = new MemoryBoardView();
    const pixi = new MemoryPixiTicker();
    pixi.frameCount = 12;
    const fallback = new OrangePressureAutoBoardFallback(pressure, tabs, board, pixi);

    fallback.start();
    pressure.shift("ORANGE");

    const stressed = fallback.snapshot();
    expect(tabs.activeTab).toBe("board");
    expect(board.visible).toBe(true);
    expect(pixi.running).toBe(false);
    expect(pixi.frameCount).toBe(0);
    expect(stressed.banner).toBe(ORANGE_FALLBACK_BANNER);

    pressure.shift("YELLOW");
    expect(tabs.activeTab).toBe("board");

    pressure.shift("GREEN");
    const recovered = fallback.snapshot();
    expect(recovered.recoveryOffer).toBe(true);
    expect(recovered.banner).toBeNull();
    expect(tabs.activeTab).toBe("board");
    expect(GREEN_RECOVERY_OFFER).toMatch(/Switch back to Office/);
  });

  it("allows an explicit user override while pressure stays ORANGE", () => {
    const pressure = new MemoryPressureMachine();
    const tabs = new MemoryCenterTabs();
    const pixi = new MemoryPixiTicker();
    const fallback = new OrangePressureAutoBoardFallback(
      pressure,
      tabs,
      new MemoryBoardView(),
      pixi,
    );
    fallback.start();
    pressure.shift("ORANGE");

    const overridden = fallback.setUserOverride(true);

    expect(tabs.activeTab).toBe("office");
    expect(pixi.running).toBe(true);
    expect(overridden.highRamTooltip).toBe(true);
  });
});