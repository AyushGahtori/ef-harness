import type { MediaQueryPort } from "./types.js";

export interface HighContrastGuidance {
  readonly active: boolean;
  readonly boostBorders: boolean;
  readonly boostFocusRings: boolean;
  readonly recommendBoardView: boolean;
  readonly message: string | null;
}

export function detectHighContrastMode(media: MediaQueryPort): HighContrastGuidance {
  const active = media.forcedColorsActive();
  if (!active) {
    return {
      active: false,
      boostBorders: false,
      boostFocusRings: false,
      recommendBoardView: false,
      message: null,
    };
  }
  return {
    active: true,
    boostBorders: true,
    boostFocusRings: true,
    recommendBoardView: false,
    message: "Windows High Contrast is on — borders, icons, and focus rings are boosted.",
  };
}