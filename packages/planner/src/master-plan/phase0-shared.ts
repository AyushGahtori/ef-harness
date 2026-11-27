import { MasterPlanError } from "./errors.js";
import type { Phase0Capabilities, ProjectKind } from "./types.js";

export interface Phase0SelectionInput {
  readonly projectKind: ProjectKind;
  readonly database?: boolean;
  readonly auth?: boolean;
}

const GREENFIELD_IDS = ["P0.1", "P0.2", "P0.3", "P0.4", "P0.5", "P0.6", "P0.7", "P0.8"] as const;

export function resolvePhase0Capabilities(input: Phase0SelectionInput): Phase0Capabilities {
  if (input.projectKind === "brownfield") {
    return { database: false, auth: false, ui: false };
  }
  return {
    database: input.database !== false,
    auth: input.projectKind !== "headless_cli" && input.auth !== false,
    ui: input.projectKind === "web_saas",
  };
}

export function expectedPhase0Ids(projectKind: ProjectKind, capabilities: Phase0Capabilities): string[] {
  if (projectKind === "brownfield") return ["P0.B1", "P0.B2"];
  const ids = ["P0.1"];
  if (capabilities.database) ids.push("P0.2");
  if (capabilities.auth) ids.push("P0.3");
  if (capabilities.ui) ids.push("P0.4");
  ids.push("P0.5", "P0.6", "P0.7");
  if (capabilities.ui) ids.push("P0.8");
  return ids;
}

export function omissionReason(id: string, projectKind: ProjectKind, capabilities: Phase0Capabilities): string {
  if (projectKind === "brownfield") return "brownfield_skips_greenfield_scaffold";
  if (id === "P0.2" && !capabilities.database) return "no_primary_database";
  if (id === "P0.3" && projectKind === "headless_cli") return "headless_cli_skips_auth_middleware";
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
