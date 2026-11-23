import { describe, expect, it } from "vitest";
import { OfficeReducedMotionAdapter } from "../../src/office/a11y/index.js";
import {
  MemoryAnimationDirector,
  MemoryMediaQuery,
  MemoryPhasePreset,
} from "./fixtures.js";

describe("OfficeReducedMotionAdapter", () => {
  it("disables all continuous motion when prefers-reduced-motion is reduce", () => {
    const media = new MemoryMediaQuery();
    media.setReducedMotion(true);
    const director = new MemoryAnimationDirector();
    director.continuousMotionCount = 6;
    const preset = new MemoryPhasePreset();
    const adapter = new OfficeReducedMotionAdapter(media, director, preset);

    const snap = adapter.observeOsPreference();

    expect(snap.active).toBe(true);
    expect(snap.staticSeatedMode).toBe(true);
    expect(snap.suggestedDefaultTab).toBe("board");
    expect(director.motionEnabled).toBe(false);
    expect(director.continuousMotionCount).toBe(0);
    expect(director.seated).toBe(true);
  });

  it("honors the in-app Static Office toggle independently of the OS setting", () => {
    const media = new MemoryMediaQuery();
    const director = new MemoryAnimationDirector();
    director.continuousMotionCount = 3;
    const adapter = new OfficeReducedMotionAdapter(media, director, new MemoryPhasePreset());

    adapter.setUserToggle(true);

    expect(director.motionEnabled).toBe(false);
    expect(director.continuousMotionCount).toBe(0);
  });
});