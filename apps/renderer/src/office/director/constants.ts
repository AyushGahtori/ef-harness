/** Canonical 11 office rooms (Task 162 `ROOM_IDS` contract). */
export const OFFICE_ROOM_IDS = [
  "ceo-office",
  "front-desk",
  "discovery-lounge",
  "research-library",
  "architecture-studio",
  "planning-war-room",
  "engineering-bullpen",
  "qa-verification-lab",
  "integration-merge-bay",
  "shipping-dock",
  "break-room",
] as const;

export type OfficeRoomId = (typeof OFFICE_ROOM_IDS)[number];

export const DIRECTOR_LIMITS = {
  maxQueueLen: 2,
  burstWindowMs: 400,
  maxVisualLagMs: 2_000,
  minDwellMs: 1_000,
  walkMsPerTile: 90,
  activeFrameBudgetMs: 8,
  activeTargetFps: 60,
  idleMinFps: 12,
  idleMaxFps: 15,
  pathQueryBudgetMs: 0.5,
} as const;