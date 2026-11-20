import { CrewLevelsError } from "./errors.js";
import type { GraphCompilerTaskPort } from "./ports.js";
import {
  type CompiledTaskFeatures,
  type CrewRole,
  type FileRankSignal,
  type MigrationKind,
  type RiskTag,
  isCrewRole,
  isRiskTag,
} from "./types.js";

const TOUCH_TO_RISK: Readonly<Record<string, RiskTag>> = {
  authn: "auth",
  authz: "auth",
  session: "auth",
  credentials: "auth",
  money: "payments",
  concurrent_edit: "concurrency",
  realtime: "concurrency",
  migration: "migrations",
  destructive_write: "migrations",
  personal_data: "security",
  logging: "security",
};

function pushTag(tags: RiskTag[], tag: RiskTag): void {
  if (!tags.includes(tag)) tags.push(tag);
}

function migrationKindOf(task: GraphCompilerTaskPort, touches: readonly string[]): MigrationKind {
  const slot = (task.migrationIntentSlot ?? "").toLowerCase();
  const destructive =
    touches.includes("destructive_write") ||
    slot.includes("drop") ||
    slot.includes("destructive");
  const expand = slot.includes("expand") || slot.includes("contract");
  if (task.createsMigration === true && destructive) return "destructive";
  if (destructive && touches.includes("migration")) return "destructive";
  if (expand) return "expand-contract";
  if (task.createsMigration === true || touches.includes("migration")) return "additive";
  return "none";
}

export function featuresFromGraphTask(
  task: GraphCompilerTaskPort,
  fileRanks: readonly FileRankSignal[] = [],
  language = "und",
): CompiledTaskFeatures {
  if (task.id.trim().length === 0) {
    throw new CrewLevelsError("bad-task", "compiled task id is required");
  }
  const touches = task.touches ?? [];
  const tags: RiskTag[] = [];
  for (const touch of touches) {
    const mapped = TOUCH_TO_RISK[touch];
    if (mapped !== undefined) pushTag(tags, mapped);
    if (isRiskTag(touch)) pushTag(tags, touch);
  }
  const migrationKind = migrationKindOf(task, touches);
  if (migrationKind !== "none") pushTag(tags, "migrations");
  const roleId: CrewRole | null =
    task.roleId != null && isCrewRole(task.roleId) ? task.roleId : null;
  const conflict =
    task.mutatesSharedContract === true && task.taskKind === "integration";
  return {
    taskId: task.id,
    fileCount: task.primaryFiles?.length ?? 0,
    mustBandTokens: task.mustBandTokens ?? 0,
    riskTags: tags,
    contractFanIn: (task.implements?.length ?? 0) + (task.obeys?.length ?? 0),
    fileRanks,
    priorFailedAttempts: 0,
    roleId,
    migrationKind,
    crossFeatureConflictMerge: conflict,
    language,
  };
}
