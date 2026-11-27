import type { NameCollision, NameRegistryRepo } from "./ports.js";
import type {
  BrownfieldName,
  CompilationInput,
  NameKind,
  PlannedName,
  PlanTask,
  TargetPlatform,
} from "./types.js";
import { foldAsciiCase } from "./windows-glob.js";

interface OwnedName {
  readonly kind: NameKind;
  readonly value: string;
  readonly method: string | null;
  readonly owner: string;
  readonly featureId: string;
  readonly brownfield: boolean;
}

interface RouteShape {
  readonly method: string;
  readonly segments: readonly RouteSegment[];
  readonly display: string;
  readonly owner: string;
  readonly featureId: string;
  readonly canonical: string;
}

type RouteSegment = { readonly kind: "static"; readonly text: string } | { readonly kind: "param" } | { readonly kind: "wildcard" };

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

function caseFoldKind(kind: NameKind, platform: TargetPlatform): boolean {
  if (kind === "http_route" || kind === "page_route" || kind === "db_table" || kind === "db_column" || kind === "db_index") {
    return true;
  }
  if (platform === "windows" && (kind === "env_var" || kind === "exported_symbol")) return true;
  return false;
}

function normalizeValue(kind: NameKind, value: string, platform: TargetPlatform): string {
  const trimmed = value.trim().replaceAll("\\", "/");
  return caseFoldKind(kind, platform) ? foldAsciiCase(trimmed) : trimmed;
}

function parseRoute(name: OwnedName): RouteShape {
  let method = (name.method ?? "").toUpperCase();
  let path = name.value.trim();
  const embedded = /^([A-Za-z]+)\s+(\/\S*)$/.exec(path);
  if (embedded) {
    method = (embedded[1] ?? "").toUpperCase();
    path = embedded[2] ?? path;
  }
  if (!HTTP_METHODS.includes(method as (typeof HTTP_METHODS)[number])) method = method || "*";
  const folded = foldAsciiCase(path).replace(/\/+$/, "") || "/";
  const segments: RouteSegment[] = [];
  for (const part of folded.split("/")) {
    if (part === "") continue;
    if (part === "*" || part === "**" || part.startsWith("[...")) {
      segments.push({ kind: "wildcard" });
      break;
    }
    if (part.startsWith(":") || (part.startsWith("{") && part.endsWith("}")) || (part.startsWith("[") && part.endsWith("]"))) {
      segments.push({ kind: "param" });
      continue;
    }
    segments.push({ kind: "static", text: part });
  }
  const canonical = `${method} ${segments
    .map((segment) => (segment.kind === "static" ? segment.text : segment.kind === "param" ? ":param" : "*"))
    .join("/")}`;
  return {
    method,
    segments,
    display: `${method} ${folded}`,
    owner: name.owner,
    featureId: name.featureId,
    canonical,
  };
}

function methodsCompatible(left: string, right: string): boolean {
  return left === "*" || right === "*" || left === right;
}

function routesShadow(left: RouteShape, right: RouteShape): boolean {
  if (!methodsCompatible(left.method, right.method)) return false;
  const walk = (i: number, j: number): boolean => {
    const a = left.segments[i];
    const b = right.segments[j];
    if (!a && !b) return true;
    if (a?.kind === "wildcard" || b?.kind === "wildcard") return true;
    if (!a || !b) return false;
    if (a.kind === "static" && b.kind === "static" && a.text !== b.text) return false;
    return walk(i + 1, j + 1);
  };
  return walk(0, 0);
}

function isAllStatic(route: RouteShape): boolean {
  return route.segments.every((segment) => segment.kind === "static");
}

function hasDynamic(route: RouteShape): boolean {
  return route.segments.some((segment) => segment.kind !== "static");
}

function collectNames(input: CompilationInput): OwnedName[] {
  const names: OwnedName[] = [];
  for (const task of input.tasks) {
    for (const name of task.names) {
      names.push({
        kind: name.kind,
        value: name.value,
        method: name.method,
        owner: task.id,
        featureId: task.featureId,
        brownfield: false,
      });
    }
  }
  for (const name of input.brownfieldNames) {
    names.push({
      kind: name.kind,
      value: name.value,
      method: name.method,
      owner: name.owner,
      featureId: "brownfield",
      brownfield: true,
    });
  }
  return names;
}

function collisionKey(name: OwnedName, platform: TargetPlatform): string {
  if (name.kind === "http_route" || name.kind === "page_route") {
    return `${name.kind}\u0000${parseRoute(name).canonical}`;
  }
  return `${name.kind}\u0000${normalizeValue(name.kind, name.value, platform)}`;
}

export function detectNameCollisions(input: CompilationInput): NameCollision[] {
  const found: NameCollision[] = [];
  const names = collectNames(input);
  const seen = new Map<string, OwnedName>();
  for (const name of names) {
    const key = collisionKey(name, input.platform);
    const prior = seen.get(key);
    if (!prior) {
      seen.set(key, name);
      continue;
    }
    if (prior.owner === name.owner) continue;
    const brownfield = prior.brownfield || name.brownfield;
    const caseOnly =
      name.value !== prior.value &&
      normalizeValue(name.kind, name.value, input.platform) === normalizeValue(prior.kind, prior.value, input.platform);
    found.push({
      kind: name.kind,
      reason: brownfield ? "brownfield_shadow" : caseOnly ? "case_collision" : "duplicate",
      left: prior.value,
      right: name.value,
      leftOwner: prior.owner,
      rightOwner: name.owner,
    });
  }
  const routes = names
    .filter((name) => name.kind === "http_route" || name.kind === "page_route")
    .map((name) => parseRoute(name));
  for (let i = 0; i < routes.length; i += 1) {
    for (let j = i + 1; j < routes.length; j += 1) {
      const left = routes[i];
      const right = routes[j];
      if (!left || !right || left.owner === right.owner) continue;
      if (left.canonical === right.canonical) continue;
      if (!routesShadow(left, right)) continue;
      if (left.featureId === right.featureId && left.featureId !== "brownfield") {
        if ((isAllStatic(left) && hasDynamic(right)) || (isAllStatic(right) && hasDynamic(left))) continue;
      }
      found.push({
        kind: "route",
        reason: left.featureId === "brownfield" || right.featureId === "brownfield" ? "brownfield_shadow" : "route_shadow",
        left: left.display,
        right: right.display,
        leftOwner: left.owner,
        rightOwner: right.owner,
      });
    }
  }
  found.sort((a, b) => a.reason.localeCompare(b.reason) || a.left.localeCompare(b.left) || a.right.localeCompare(b.right));
  return found;
}

export class LocalNameRegistryRepo implements NameRegistryRepo {
  detectCollisions(input: CompilationInput): readonly NameCollision[] {
    return detectNameCollisions(input);
  }
}

export function plannedRoute(value: string, method: string | null = null): PlannedName {
  return { kind: "http_route", value, method };
}

export function brownfieldRoute(value: string, owner: string, method: string | null = null): BrownfieldName {
  return { kind: "http_route", value, owner, method };
}

export function taskOwnsName(task: PlanTask, kind: NameKind, value: string): boolean {
  return task.names.some((name) => name.kind === kind && name.value === value);
}
