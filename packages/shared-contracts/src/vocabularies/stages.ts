import { z } from "zod";
import { isOneOf } from "./closed-enum.js";

export const PROJECT_STAGES = ["prototype", "mvp", "production"] as const;
export const MODEL_LEVELS = ["Junior", "Mid", "Senior", "Manager"] as const;
export const SANDBOX_TIERS = ["A", "B", "C", "D", "E"] as const;
export const RUNTIME_MODES = ["wrapped", "stripped", "own_loop"] as const;
export const RUNTIME_COST_CLASSES = ["light", "session_process"] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number];
export type ModelLevel = (typeof MODEL_LEVELS)[number];
export type SandboxTier = (typeof SANDBOX_TIERS)[number];
export type RuntimeMode = (typeof RUNTIME_MODES)[number];
export type RuntimeCostClass = (typeof RUNTIME_COST_CLASSES)[number];

export const ProjectStageSchema = z.enum(PROJECT_STAGES);
export const ModelLevelSchema = z.enum(MODEL_LEVELS);
export const SandboxTierSchema = z.enum(SANDBOX_TIERS);
export const RuntimeModeSchema = z.enum(RUNTIME_MODES);
export const RuntimeCostClassSchema = z.enum(RUNTIME_COST_CLASSES);

export const isProjectStage = isOneOf(PROJECT_STAGES);
export const isModelLevel = isOneOf(MODEL_LEVELS);
export const isSandboxTier = isOneOf(SANDBOX_TIERS);
export const isRuntimeMode = isOneOf(RUNTIME_MODES);
export const isRuntimeCostClass = isOneOf(RUNTIME_COST_CLASSES);
