import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CREW_PRESETS,
  CrewPresetSchema,
  DECISION_BASES,
  GOVERNOR_PRESSURES,
  GovernorPressureSchema,
  HOLD_REASONS,
  MODEL_LEVELS,
  NODE_STATUSES,
  NodeStatusSchema,
  PRESSURE_LEVELS,
  PROJECT_KINDS,
  PacketSecurityRedactor,
  PressureLevelSchema,
  ProjectKindSchema,
  SETTLED_BASES,
  SecretRedactor,
  TASK_HOLD_REASONS,
  TOUCHES_TAGS,
  TaskHoldReasonSchema,
  UI_PROJECT_KINDS,
  WORKER_TIERS,
  WorkerTierSchema,
  canonicalAssetAbsolute,
  isCrewPreset,
  isDecisionBasis,
  isGovernorPressure,
  isNodeStatus,
  isPressureLevel,
  isProjectKind,
  isTaskHoldReason,
  isUiProjectKind,
  isWorkerTier,
  normalizeCrewPreset,
  normalizeGovernorPressure,
  normalizeProjectKind,
  normalizeWorkerTier,
} from "../../src/index.js";

describe("frozen C04 closed vocabularies", () => {
  it("aliases DECISION_BASES to canonical SETTLED_BASES and matches node_statuses in state.sql", () => {
    expect(DECISION_BASES).toEqual(SETTLED_BASES);
    expect(isDecisionBasis("explicit")).toBe(true);
    expect(isDecisionBasis("confirmed")).toBe(false);
    expect(isDecisionBasis("inferred_highentropy")).toBe(false);

    const stateSql = fs.readFileSync(canonicalAssetAbsolute("stateSql"), "utf8");
    const match = /CREATE TABLE nodes[\s\S]*?status\s+TEXT NOT NULL DEFAULT 'active' CHECK \(status IN \(([^)]*)\)\)/.exec(
      stateSql,
    );
    const sqlStatuses = [...(match?.[1] ?? "").matchAll(/'([^']*)'/g)].map((hit) => hit[1]);
    expect(sqlStatuses).toEqual([...NODE_STATUSES]);
    expect(isNodeStatus("active")).toBe(true);
    expect(NodeStatusSchema.safeParse("retired").success).toBe(true);
  });

  it("extends HOLD_REASONS into TASK_HOLD_REASONS with editor_overlap only", () => {
    for (const reason of HOLD_REASONS) {
      expect(isTaskHoldReason(reason)).toBe(true);
    }
    expect(TASK_HOLD_REASONS).toEqual([
      "user_pause",
      "requirement_change",
      "budget",
      "ccr",
      "governor",
      "editor_overlap",
    ]);
    expect(isTaskHoldReason("editor_overlap")).toBe(true);
    expect(TaskHoldReasonSchema.safeParse("editor_overlap").success).toBe(true);
    for (const invalid of ["user_paused", "revision_in_flight", "waiting_on_human_step"]) {
      expect(isTaskHoldReason(invalid)).toBe(false);
      expect(TaskHoldReasonSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("freezes strict uppercase governor pressure levels", () => {
    expect(PRESSURE_LEVELS).toEqual(["GREEN", "YELLOW", "ORANGE", "RED"]);
    expect(GOVERNOR_PRESSURES).toEqual(PRESSURE_LEVELS);
    for (const level of PRESSURE_LEVELS) {
      expect(isPressureLevel(level)).toBe(true);
      expect(isGovernorPressure(level)).toBe(true);
      expect(PressureLevelSchema.safeParse(level).success).toBe(true);
      expect(GovernorPressureSchema.safeParse(level).success).toBe(true);
      expect(isPressureLevel(level.toLowerCase())).toBe(false);
      expect(isPressureLevel(`${level[0]}${level.slice(1).toLowerCase()}`)).toBe(false);
      expect(normalizeGovernorPressure(level)).toBe(level);
      expect(normalizeGovernorPressure(level.toLowerCase())).toBe(level);
      expect(normalizeGovernorPressure(`${level[0]}${level.slice(1).toLowerCase()}`)).toBe(level);
    }
    expect(normalizeGovernorPressure("crimson")).toBeUndefined();
  });

  it("freezes PROJECT_KINDS, UI classification, and legacy aliases", () => {
    expect(PROJECT_KINDS).toEqual([
      "web_saas",
      "web_static",
      "api_service",
      "cli_tool",
      "desktop_electron",
      "mobile_web",
    ]);
    for (const kind of PROJECT_KINDS) {
      expect(isProjectKind(kind)).toBe(true);
      expect(ProjectKindSchema.safeParse(kind).success).toBe(true);
      expect(isUiProjectKind(kind)).toBe((UI_PROJECT_KINDS as readonly string[]).includes(kind));
    }
    expect(isUiProjectKind("web_saas")).toBe(true);
    expect(isUiProjectKind("web_static")).toBe(true);
    expect(isUiProjectKind("desktop_electron")).toBe(true);
    expect(isUiProjectKind("mobile_web")).toBe(true);
    expect(isUiProjectKind("cli_tool")).toBe(false);
    expect(isUiProjectKind("api_service")).toBe(false);

    expect(normalizeProjectKind("web")).toBe("web_saas");
    expect(normalizeProjectKind("ui")).toBe("web_saas");
    expect(normalizeProjectKind("web_fullstack")).toBe("web_saas");
    expect(normalizeProjectKind("headless_cli")).toBe("cli_tool");
    expect(normalizeProjectKind("cli")).toBe("cli_tool");
    expect(normalizeProjectKind("api")).toBe("api_service");
    expect(normalizeProjectKind("backend_api")).toBe("api_service");
    expect(normalizeProjectKind("openapi")).toBe("api_service");
    expect(normalizeProjectKind("headless")).toBe("api_service");
    expect(normalizeProjectKind("unknown_kind")).toBeUndefined();
  });

  it("freezes WORKER_TIERS, CREW_PRESETS, TOUCHES_TAGS, and PacketSecurityRedactor", () => {
    expect(TOUCHES_TAGS).toHaveLength(28);
    expect(MODEL_LEVELS).toEqual(["Junior", "Mid", "Senior", "Manager"]);
    expect(WORKER_TIERS).toEqual(["Junior", "Mid", "Senior", "Principal"]);
    for (const tier of WORKER_TIERS) {
      expect(isWorkerTier(tier)).toBe(true);
      expect(WorkerTierSchema.safeParse(tier).success).toBe(true);
    }
    expect(normalizeWorkerTier("junior")).toBe("Junior");
    expect(normalizeWorkerTier("principal")).toBe("Principal");
    expect(normalizeWorkerTier("manager")).toBe("Principal");

    expect(CREW_PRESETS).toEqual(["Fastest", "Balanced", "Cheapest"]);
    for (const preset of CREW_PRESETS) {
      expect(isCrewPreset(preset)).toBe(true);
      expect(CrewPresetSchema.safeParse(preset).success).toBe(true);
    }
    expect(normalizeCrewPreset("fastest")).toBe("Fastest");
    expect(normalizeCrewPreset("balanced")).toBe("Balanced");
    expect(normalizeCrewPreset("cheapest")).toBe("Cheapest");
    expect(normalizeCrewPreset("budget")).toBe("Cheapest");
    expect(normalizeCrewPreset("thorough")).toBe("Fastest");

    expect(PacketSecurityRedactor).toBe(SecretRedactor);
  });
});
