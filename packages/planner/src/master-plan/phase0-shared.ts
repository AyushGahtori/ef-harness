import { isUiProjectKind, normalizeProjectKind, type ProjectKind } from "@ef-harness/shared-contracts";

import { MasterPlanError } from "./errors.js";
import type { Phase0Capabilities } from "./types.js";

export interface Phase0SelectionInput {
  readonly projectKind: string;
  readonly brownfield?: boolean;
  readonly database?: boolean;
  readonly auth?: boolean;
}

export interface PlanningProfile {
  readonly projectKind: ProjectKind;
  readonly brownfield: boolean;
}

export function planningProfile(kind: string, brownfield?: boolean): PlanningProfile {
  if (kind === "brownfield" || brownfield === true) {
    const normalized = kind === "brownfield" ? "web_saas" : normalizeProjectKind(kind);
    return { projectKind: normalized ?? "web_saas", brownfield: true };
  }
  const projectKind = normalizeProjectKind(kind);
  if (!projectKind) {
    throw new MasterPlanError("invalid_project_kind", `Unknown project kind ${kind}`);
  }
  return { projectKind, brownfield: false };
}

const GREENFIELD_IDS = ["P0.1", "P0.2", "P0.3", "P0.4", "P0.5", "P0.6", "P0.7", "P0.8"] as const;

export function resolvePhase0Capabilities(input: Phase0SelectionInput): Phase0Capabilities {
  const profile = planningProfile(input.projectKind, input.brownfield);
  if (profile.brownfield) {
    return { database: false, auth: false, ui: false };
  }
  return {
    database: input.database !== false,
    auth: profile.projectKind !== "cli_tool" && input.auth !== false,
    ui: isUiProjectKind(profile.projectKind),
  };
}

export function expectedPhase0Ids(profile: PlanningProfile, capabilities: Phase0Capabilities): string[] {
  if (profile.brownfield) return ["P0.B1", "P0.B2"];
  const ids = ["P0.1"];
  if (capabilities.database) ids.push("P0.2");
  if (capabilities.auth) ids.push("P0.3");
  if (capabilities.ui) ids.push("P0.4");
  ids.push("P0.5", "P0.6", "P0.7");
  if (capabilities.ui) ids.push("P0.8");
  return ids;
}

export function omissionReason(id: string, profile: PlanningProfile, capabilities: Phase0Capabilities): string {
  if (profile.brownfield) return "brownfield_skips_greenfield_scaffold";
  if (id === "P0.2" && !capabilities.database) return "no_primary_database";
  if (id === "P0.3" && profile.projectKind === "cli_tool") return "headless_cli_skips_auth_middleware";
  if (id === "P0.3" && !capabilities.auth) return "auth_not_required";
  if (id === "P0.4") return "pure_cli_or_api_skips_design_system";
  if (id === "P0.8") return "non_ui_skips_jsx_preview";
  return "not_applicable";
}

export function greenfieldIds(): readonly string[] {
  return GREENFIELD_IDS;
}

export function normalizeScope(scope: string): { readonly kind: "file" | "dir"; readonly path: string } {
  const normalized = scope.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.endsWith("/**")) {
    return { kind: "dir", path: normalized.slice(0, -3).replace(/\/$/, "") };
  }
  if (normalized.endsWith("/")) {
    return { kind: "dir", path: normalized.slice(0, -1) };
  }
  return { kind: "file", path: normalized };
}

export function writeScopesOverlap(left: string, right: string): boolean {
  const a = normalizeScope(left);
  const b = normalizeScope(right);
  if (a.kind === "file" && b.kind === "file") return a.path === b.path;
  if (a.kind === "dir" && b.kind === "dir") {
    return a.path === b.path || a.path.startsWith(`${b.path}/`) || b.path.startsWith(`${a.path}/`);
  }
  const file = a.kind === "file" ? a : b;
  const dir = a.kind === "dir" ? a : b;
  return file.path === dir.path || file.path.startsWith(`${dir.path}/`);
}

export function assertDisjointWriteScopes(
  groups: readonly { readonly id: string; readonly writeScope: readonly string[] }[],
): void {
  for (let i = 0; i < groups.length; i += 1) {
    const left = groups[i];
    if (!left) continue;
    for (let j = i + 1; j < groups.length; j += 1) {
      const right = groups[j];
      if (!right) continue;
      for (const a of left.writeScope) {
        for (const b of right.writeScope) {
          if (writeScopesOverlap(a, b)) {
            throw new MasterPlanError(
              "overlapping_write_scope",
              `${left.id} write scope ${a} overlaps ${right.id} write scope ${b}`,
            );
          }
        }
      }
    }
  }
}
