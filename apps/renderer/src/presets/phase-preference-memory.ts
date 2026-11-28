import {
  BUILD_TABS,
  CENTER_TABS,
  LIFECYCLE_PHASES,
  type BuildTabPreference,
  type CenterTab,
  type LifecyclePhase,
  type PhaseUserOverride,
} from "./types.js";

export class PresetMemoryError extends Error {
  readonly code = "preset-memory";

  constructor(message: string) {
    super(message);
    this.name = "PresetMemoryError";
  }
}

interface ProjectMemory {
  preferredBuildTab: BuildTabPreference | null;
  phases: Record<LifecyclePhase, PhaseUserOverride>;
}

function emptyPhases(): Record<LifecyclePhase, PhaseUserOverride> {
  return {
    discover: {},
    plan: {},
    build: {},
    ship: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCenterTab(value: unknown): value is CenterTab {
  return typeof value === "string" && (CENTER_TABS as readonly string[]).includes(value);
}

function isBuildPreference(value: unknown): value is BuildTabPreference {
  return value === "office" || value === "board";
}

function isRailPresentation(value: unknown): value is "expanded" | "compact" {
  return value === "expanded" || value === "compact";
}

function readOverride(value: unknown, phase: LifecyclePhase): PhaseUserOverride {
  if (!isRecord(value)) {
    throw new PresetMemoryError(`Phase ${phase} override is unreadable`);
  }
  const next: {
    leftRailPresentation?: "expanded" | "compact";
    centerTab?: CenterTab;
    inspectorCollapsed?: boolean;
  } = {};
  if ("leftRailPresentation" in value) {
    if (!isRailPresentation(value.leftRailPresentation)) {
      throw new PresetMemoryError(`Phase ${phase} left rail override is invalid`);
    }
    next.leftRailPresentation = value.leftRailPresentation;
  }
  if ("centerTab" in value) {
    if (!isCenterTab(value.centerTab)) {
      throw new PresetMemoryError(`Phase ${phase} center tab override is invalid`);
    }
    next.centerTab = value.centerTab;
  }
  if ("inspectorCollapsed" in value) {
    if (typeof value.inspectorCollapsed !== "boolean") {
      throw new PresetMemoryError(`Phase ${phase} inspector override is invalid`);
    }
    next.inspectorCollapsed = value.inspectorCollapsed;
  }
  return next;
}

function assertProjectId(projectId: string): void {
  if (projectId.trim().length === 0) {
    throw new PresetMemoryError("Project id is required");
  }
}

export class PhasePreferenceMemory {
  private readonly projects = new Map<string, ProjectMemory>();

  preferredBuildTab(projectId: string): BuildTabPreference | null {
    assertProjectId(projectId);
    return this.projects.get(projectId)?.preferredBuildTab ?? null;
  }

  setPreferredBuildTab(projectId: string, tab: BuildTabPreference): void {
    assertProjectId(projectId);
    if (!isBuildPreference(tab) || !(BUILD_TABS as readonly string[]).includes(tab)) {
      throw new PresetMemoryError("Build tab preference must be office or board");
    }
    const project = this.ensure(projectId);
    project.preferredBuildTab = tab;
  }

  override(projectId: string, phase: LifecyclePhase): PhaseUserOverride {
    assertProjectId(projectId);
    return this.projects.get(projectId)?.phases[phase] ?? {};
  }

  merge(projectId: string, phase: LifecyclePhase, patch: PhaseUserOverride): void {
    assertProjectId(projectId);
    const project = this.ensure(projectId);
    project.phases[phase] = mergeOverride(project.phases[phase], patch);
  }

  serialize(): string {
    const projects: Record<string, ProjectMemory> = {};
    for (const [projectId, memory] of this.projects) {
      projects[projectId] = {
        preferredBuildTab: memory.preferredBuildTab,
        phases: {
          discover: memory.phases.discover,
          plan: memory.phases.plan,
          build: memory.phases.build,
          ship: memory.phases.ship,
        },
      };
    }
    return JSON.stringify({ projects });
  }

  static restore(serialized: string): PhasePreferenceMemory {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized) as unknown;
    } catch {
      throw new PresetMemoryError("Phase preference memory is unreadable");
    }
    if (!isRecord(parsed) || !isRecord(parsed.projects)) {
      throw new PresetMemoryError("Phase preference memory is unreadable");
    }
    const memory = new PhasePreferenceMemory();
    for (const [projectId, value] of Object.entries(parsed.projects)) {
      if (!isRecord(value) || !isRecord(value.phases)) {
        throw new PresetMemoryError(`Project ${projectId} memory is unreadable`);
      }
      const preferred = value.preferredBuildTab ?? null;
      if (preferred !== null && !isBuildPreference(preferred)) {
        throw new PresetMemoryError(`Project ${projectId} build tab preference is invalid`);
      }
      const phases = emptyPhases();
      for (const phase of LIFECYCLE_PHASES) {
        const stored = value.phases[phase] ?? {};
        phases[phase] = readOverride(stored, phase);
      }
      const project = memory.ensure(projectId);
      project.preferredBuildTab = preferred;
      project.phases = phases;
    }
    return memory;
  }

  private ensure(projectId: string): ProjectMemory {
    const existing = this.projects.get(projectId);
    if (existing) return existing;
    const created: ProjectMemory = {
      preferredBuildTab: null,
      phases: emptyPhases(),
    };
    this.projects.set(projectId, created);
    return created;
  }
}

function mergeOverride(current: PhaseUserOverride, patch: PhaseUserOverride): PhaseUserOverride {
  const left = patch.leftRailPresentation ?? current.leftRailPresentation;
  const tab = patch.centerTab ?? current.centerTab;
  const collapsed = patch.inspectorCollapsed ?? current.inspectorCollapsed;
  const next: {
    leftRailPresentation?: "expanded" | "compact";
    centerTab?: CenterTab;
    inspectorCollapsed?: boolean;
  } = {};
  if (left !== undefined) next.leftRailPresentation = left;
  if (tab !== undefined) next.centerTab = tab;
  if (collapsed !== undefined) next.inspectorCollapsed = collapsed;
  return next;
}
