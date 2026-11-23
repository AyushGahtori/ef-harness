import type { CodeMapModule } from "./contracts.js";
import type { ScopeFenceModule } from "./types.js";

export interface ScopeFenceInput {
  readonly focusModuleIds: readonly string[];
  readonly allModules: readonly CodeMapModule[];
}

export class AntiRewriteScopeFence {
  buildFence(input: ScopeFenceInput): readonly ScopeFenceModule[] {
    const focus = new Set(input.focusModuleIds);
    return input.allModules.map((mod) => ({
      modulePath: mod.id,
      access: focus.has(mod.id) ? ("in_scope" as const) : ("read_only" as const),
    }));
  }

  untouchedSubsystems(fence: readonly ScopeFenceModule[]): readonly string[] {
    return fence.filter((m) => m.access === "read_only").map((m) => m.modulePath);
  }
}