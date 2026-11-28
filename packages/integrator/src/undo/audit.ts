import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  definedPermissions,
  importSpecifiers,
  isSourceFile,
  resolveImport,
  routeDefinitions,
  routeLinks,
  usedPermissions,
} from "./scan.js";
import type { StaticAuditReport } from "./types.js";

const SKIP = new Set([".git", "node_modules", "dist", "coverage"]);
const CONFLICT = /^(?:<{7}|={7}|>{7})/m;

/**
 * Local port of Task 054 `STATIC_AUDIT` for an undo candidate.
 * Blocks the undo commit while a removed route still has a nav link,
 * a relative import does not resolve, or a removed permission is still used.
 */
export function runStaticAudit(
  worktree: string,
  removedRoutes: readonly string[],
  removedPermissions: readonly string[],
): StaticAuditReport {
  const files = walkFiles(worktree);
  const texts = new Map<string, string>();
  for (const file of files) {
    const relative = file.relative.replaceAll("\\", "/");
    if (!isSourceFile(relative) && !relative.endsWith(".md") && !relative.endsWith(".html")) continue;
    const text = readFileSync(file.full, "utf8");
    if (text.includes("\u0000")) continue;
    texts.set(relative, text);
  }
  const definedRoutes = new Set<string>();
  const definedPerms = new Set<string>();
  for (const text of texts.values()) {
    for (const route of routeDefinitions(text)) definedRoutes.add(route);
    for (const permission of definedPermissions(text)) definedPerms.add(permission);
  }
  const deadNav: string[] = [];
  const danglingImports: string[] = [];
  const orphanPermissions: string[] = [];
  const fileSet = new Set(texts.keys());
  for (const [relative, text] of texts) {
    if (CONFLICT.test(text)) danglingImports.push(`conflict-marker:${relative}`);
    for (const link of routeLinks(text)) {
      if (removedRoutes.includes(link) && !definedRoutes.has(link)) deadNav.push(`${relative} -> ${link}`);
    }
    for (const spec of importSpecifiers(text)) {
      if (!spec.startsWith(".")) continue;
      if (!resolveImport(relative, spec, fileSet)) danglingImports.push(`${relative} -> ${spec}`);
    }
    for (const permission of usedPermissions(text)) {
      if (removedPermissions.includes(permission) && !definedPerms.has(permission)) {
        orphanPermissions.push(`${relative} -> ${permission}`);
      }
    }
  }
  return {
    ok: deadNav.length === 0 && danglingImports.length === 0 && orphanPermissions.length === 0,
    deadNav,
    danglingImports,
    orphanPermissions,
  };
}

export function collectRemovedSymbols(blobs: readonly string[]): { routes: string[]; permissions: string[] } {
  const routes = new Set<string>();
  const permissions = new Set<string>();
  for (const blob of blobs) {
    for (const route of routeDefinitions(blob)) routes.add(route);
    for (const permission of definedPermissions(blob)) permissions.add(permission);
  }
  return { routes: [...routes], permissions: [...permissions] };
}

function walkFiles(root: string): { full: string; relative: string }[] {
  const out: { full: string; relative: string }[] = [];
  function visit(dir: string): void {
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.push({ full, relative: path.relative(root, full) });
    }
  }
  visit(root);
  return out;
}
