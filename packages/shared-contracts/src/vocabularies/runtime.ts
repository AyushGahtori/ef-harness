import { z } from "zod";
import { isOneOf } from "./closed-enum.js";
import { HOLD_REASONS } from "./lookups.js";

/** `nodes.status` CHECK list in `schema/state.sql`. */
export const NODE_STATUSES = ["draft", "active", "retired", "superseded"] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];
export const NodeStatusSchema = z.enum(NODE_STATUSES);
export const isNodeStatus = isOneOf(NODE_STATUSES);

/**
 * Extended canonical task hold reasons across `schema/state.sql` (`HOLD_REASONS`)
 * and editor-coexistence overlap holds (`F-051`).
 */
export const TASK_HOLD_REASONS = [...HOLD_REASONS, "editor_overlap"] as const;
export type TaskHoldReason = (typeof TASK_HOLD_REASONS)[number];
export const TaskHoldReasonSchema = z.enum(TASK_HOLD_REASONS);
export const isTaskHoldReason = isOneOf(TASK_HOLD_REASONS);

/**
 * Canonical uppercase hardware governor pressure levels (`F-055`).
 * Downstream adapters normalize UI/legacy labels at ingress without introducing
 * alternative pressure casings into shared contracts.
 */
export const PRESSURE_LEVELS = ["GREEN", "YELLOW", "ORANGE", "RED"] as const;
export const GOVERNOR_PRESSURES = PRESSURE_LEVELS;
export type PressureLevel = (typeof PRESSURE_LEVELS)[number];
export type GovernorPressure = PressureLevel;
export const PressureLevelSchema = z.enum(PRESSURE_LEVELS);
export const GovernorPressureSchema = PressureLevelSchema;
export const isPressureLevel = isOneOf(PRESSURE_LEVELS);
export const isGovernorPressure = isPressureLevel;

/** Canonical project shapes across discovery, planning, Phase 0, and UI verification (`F-040`, `F-052`). */
export const PROJECT_KINDS = [
  "web_saas",
  "web_static",
  "api_service",
  "cli_tool",
  "desktop_electron",
  "mobile_web",
] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];
export const ProjectKindSchema = z.enum(PROJECT_KINDS);
export const isProjectKind = isOneOf(PROJECT_KINDS);

export const UI_PROJECT_KINDS = [
  "web_saas",
  "web_static",
  "desktop_electron",
  "mobile_web",
] as const satisfies readonly ProjectKind[];

export function isUiProjectKind(kind: ProjectKind): boolean {
  return (UI_PROJECT_KINDS as readonly ProjectKind[]).includes(kind);
}

const PROJECT_KIND_ALIASES: Readonly<Record<string, ProjectKind>> = {
  web_saas: "web_saas",
  web_fullstack: "web_saas",
  web_browser: "web_saas",
  web: "web_saas",
  ui: "web_saas",
  web_static: "web_static",
  api_service: "api_service",
  backend_api: "api_service",
  api_only: "api_service",
  api: "api_service",
  openapi: "api_service",
  headless: "api_service",
  cli_tool: "cli_tool",
  headless_cli: "cli_tool",
  cli: "cli_tool",
  desktop_electron: "desktop_electron",
  mobile_web: "mobile_web",
};

export function normalizeProjectKind(value: string): ProjectKind | undefined {
  return PROJECT_KIND_ALIASES[value.trim().toLowerCase()];
}

/** Canonical worker tiers across slicer, planner, roster, and scheduler (`F-039`, `F-040`, `F-045`). */
export const WORKER_TIERS = ["Junior", "Mid", "Senior", "Principal"] as const;
export type WorkerTier = (typeof WORKER_TIERS)[number];
export const WorkerTierSchema = z.enum(WORKER_TIERS);
export const isWorkerTier = isOneOf(WORKER_TIERS);

const WORKER_TIER_ALIASES: Readonly<Record<string, WorkerTier>> = {
  junior: "Junior",
  jr: "Junior",
  mid: "Mid",
  senior: "Senior",
  sr: "Senior",
  principal: "Principal",
  manager: "Principal",
};

export function normalizeWorkerTier(value: string): WorkerTier | undefined {
  return WORKER_TIER_ALIASES[value.trim().toLowerCase()];
}

/** Canonical crew presets from `planning-and-crew.md` (`F-045`). */
export const CREW_PRESETS = ["Fastest", "Balanced", "Cheapest"] as const;
export type CrewPreset = (typeof CREW_PRESETS)[number];
export const CrewPresetSchema = z.enum(CREW_PRESETS);
export const isCrewPreset = isOneOf(CREW_PRESETS);

const CREW_PRESET_ALIASES: Readonly<Record<string, CrewPreset>> = {
  fastest: "Fastest",
  thorough: "Fastest",
  balanced: "Balanced",
  cheapest: "Cheapest",
  budget: "Cheapest",
};

export function normalizeCrewPreset(value: string): CrewPreset | undefined {
  return CREW_PRESET_ALIASES[value.trim().toLowerCase()];
}
