export const CANONICAL_VIEWPORTS = [
  { id: "mobile", width: 375, height: 812 },
  { id: "tablet", width: 768, height: 1024 },
  { id: "desktop", width: 1440, height: 900 },
] as const;

export type CanonicalViewportId = (typeof CANONICAL_VIEWPORTS)[number]["id"];

export const MIN_TAP_TARGET_PX = 24;
export const RECOMMENDED_MOBILE_TAP_PX = 44;
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.8;
export const HORIZONTAL_OVERFLOW_TOLERANCE_PX = 1;

export const SCREENSHOT_TOLERANCE = {
  maxDiffPixelRatio: 0.005,
  threshold: 0.15,
} as const;

export const UNAPPROVED_IMAGE_HOSTS = [
  "unsplash.com",
  "imgur.com",
  "picsum.photos",
] as const;

export const STAGE_ORDER = [
  "token_discipline",
  "duplicate_component",
  "three_width_tap_target",
  "axe_accessibility",
  "cross_screen_rhythm",
  "screenshot_regression",
] as const;