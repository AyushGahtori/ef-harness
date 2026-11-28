import { describe, expect, it } from "vitest";
import {
  BULLPEN_VISIBLE_DESK_CAP,
  HotDeskOverflowAggregator,
  OptionalSoftChimesController,
} from "../../src/office/a11y/index.js";
import { MemoryFocusMode, makeBullpenWave } from "./fixtures.js";

describe("HotDeskOverflowAggregator", () => {
  it("caps bullpen sprites at 28 and surfaces +22 more on a 50-worker wave", () => {
    const aggregator = new HotDeskOverflowAggregator();
    const snapshot = aggregator.aggregate(makeBullpenWave(50));

    const bullpenSeated = snapshot.seated.filter(
      (placement) => placement.worker.roomId === "engineering_bullpen",
    );
    expect(bullpenSeated.length).toBe(BULLPEN_VISIBLE_DESK_CAP);
    expect(snapshot.overflowCount).toBe(22);
    expect(snapshot.overflowLabel).toBe("+22 more agents working in background — View all on Board");
  });
});

describe("OptionalSoftChimesController", () => {
  it("defaults OFF and mutes while Focus Mode is active", () => {
    const focusMode = new MemoryFocusMode();
    const chimes = new OptionalSoftChimesController(focusMode);

    expect(chimes.settings().enabled).toBe(false);
    expect(chimes.play("feature_done", 1)).toBeNull();

    chimes.setEnabled(true);
    focusMode.active = true;
    expect(chimes.play("needs_you", 2)).toBeNull();

    focusMode.active = false;
    const played = chimes.play("build_complete", 3);
    expect(played?.cue).toBe("build_complete");
  });
});