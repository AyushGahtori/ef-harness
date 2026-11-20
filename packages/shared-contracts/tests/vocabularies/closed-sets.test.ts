import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CHANGE_CLASSES,
  EDGE_TYPES,
  EFFECT_STATES,
  FEATURE_STATES,
  HOLD_REASONS,
  INBOX_KINDS,
  MODEL_LEVELS,
  NAME_KINDS,
  NODE_KINDS,
  PRIORITY_CLASSES,
  PROJECT_STAGES,
  PROJECT_STATES,
  RETENTION_CLASSES,
  RUNTIME_COST_CLASSES,
  RUNTIME_MODES,
  SANDBOX_TIERS,
  SETTLED_BASES,
  TASK_STATES,
  TOUCHES_TAGS,
  assertNever,
  isChangeClass,
  isEdgeType,
  isEffectState,
  isFeatureState,
  isHoldReason,
  isInboxKind,
  isModelLevel,
  isNameKind,
  isNodeKind,
  isPriorityClass,
  isProjectStage,
  isProjectState,
  isRetentionClass,
  isRuntimeCostClass,
  isRuntimeMode,
  isSandboxTier,
  isTaskState,
  vocabularyCounts,
  vocabularyInvariantsSatisfied,
} from "../../src/vocabularies/index.js";

const SOURCE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/vocabularies",
);

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

function invertCase(value: string): string {
  return value === value.toUpperCase() ? value.toLowerCase() : value.toUpperCase();
}

describe("closed lookup sets", () => {
  it("keeps the compile-time vocabulary counts", () => {
    expect(vocabularyInvariantsSatisfied).toBe(true);
    expect(vocabularyCounts).toEqual({
      nodeKinds: 17,
      edgeTypes: 14,
      taskStates: 15,
      featureStates: 13,
      projectStates: 10,
      changeClasses: 6,
      holdReasons: 5,
      inboxKinds: 6,
      effectStates: 6,
      retentionClasses: 4,
      priorityClasses: 4,
      settledBases: 6,
      criterionStatuses: 8,
      touchesTags: 28,
      touchesGroups: 7,
      nameKinds: 17,
      projectStages: 3,
      modelLevels: 4,
      sandboxTiers: 5,
      runtimeModes: 3,
      runtimeCostClasses: 2,
    });
  });

  it("uses exact casing for states, kinds, bases, and tags", () => {
    const upper = [
      ...TASK_STATES.map((row) => row.state),
      ...FEATURE_STATES.map((row) => row.state),
      ...PROJECT_STATES,
    ];
    const lower = [
      ...NODE_KINDS.map((row) => row.kind),
      ...EDGE_TYPES.map((row) => row.type),
      ...CHANGE_CLASSES,
      ...HOLD_REASONS,
      ...INBOX_KINDS,
      ...EFFECT_STATES,
      ...RETENTION_CLASSES,
      ...PRIORITY_CLASSES,
      ...SETTLED_BASES,
      ...TOUCHES_TAGS,
      ...NAME_KINDS,
      ...PROJECT_STAGES,
      ...RUNTIME_MODES,
      ...RUNTIME_COST_CLASSES,
    ];
    for (const value of upper) {
      expect(value).toMatch(/^[A-Z][A-Z0-9_]*$/u);
      expect(
        isTaskState(invertCase(value)) ||
          isFeatureState(invertCase(value)) ||
          isProjectState(invertCase(value)),
      ).toBe(false);
    }
    for (const value of lower) {
      expect(value).toMatch(/^[a-z][a-z0-9_]*$/u);
      const flipped = invertCase(value);
      expect(isNodeKind(flipped)).toBe(false);
      expect(isEdgeType(flipped)).toBe(false);
      expect(isChangeClass(flipped)).toBe(false);
      expect(isHoldReason(flipped)).toBe(false);
      expect(isInboxKind(flipped)).toBe(false);
      expect(isEffectState(flipped)).toBe(false);
      expect(isRetentionClass(flipped)).toBe(false);
      expect(isPriorityClass(flipped)).toBe(false);
      expect(isNameKind(flipped)).toBe(false);
      expect(isProjectStage(flipped)).toBe(false);
      expect(isRuntimeMode(flipped)).toBe(false);
      expect(isRuntimeCostClass(flipped)).toBe(false);
    }
    expect(isTaskState("Ready")).toBe(false);
    expect(isTaskState("READY")).toBe(true);
    expect(MODEL_LEVELS).toEqual(["Junior", "Mid", "Senior", "Manager"]);
    expect(isModelLevel("junior")).toBe(false);
    expect(isModelLevel("Junior")).toBe(true);
    expect(SANDBOX_TIERS).toEqual(["A", "B", "C", "D", "E"]);
    expect(isSandboxTier("a")).toBe(false);
    expect(isSandboxTier("A")).toBe(true);
    expect(NAME_KINDS).toEqual([
      "http_route",
      "page_route",
      "db_table",
      "db_column",
      "db_index",
      "db_constraint",
      "env_var",
      "storage_key",
      "cookie_name",
      "cache_prefix",
      "event",
      "queue",
      "job",
      "permission",
      "feature_flag",
      "i18n_namespace",
      "cli_command",
    ]);
    expect(isNameKind("http-route")).toBe(false);
    expect(PROJECT_STAGES).toEqual(["prototype", "mvp", "production"]);
    expect(RUNTIME_MODES).toEqual(["wrapped", "stripped", "own_loop"]);
    expect(RUNTIME_COST_CLASSES).toEqual(["light", "session_process"]);
  });

  it("throws from assertNever for a value that escaped the type system", () => {
    expect(() => assertNever("HELD" as never)).toThrow(/HELD/u);
  });

  it("imports neither db, kernel, nor apps", () => {
    const files = sourceFiles(SOURCE_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      for (const specifier of text.matchAll(/from\s+["']([^"']+)["']/g)) {
        const source = specifier[1] ?? "";
        expect(source).not.toMatch(/(?:^|\/)(?:db|kernel|apps)(?:\/|$)/u);
        expect(source).not.toMatch(/@ef-harness\/(?:db|kernel)/u);
        expect(source).not.toBe("node:sqlite");
      }
    }
  });
});
