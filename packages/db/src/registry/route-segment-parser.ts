import { InvalidNameValueError, type RouteShadowConflict } from "./errors.js";
import { type RouteNameKind } from "./name-kinds.js";

export type RouteSegment =
  | { type: "static"; value: string }
  | { type: "param"; name: string; optional: boolean }
  | { type: "wildcard" }
  | { type: "catchall"; name: string; optional: boolean };

export interface ParsedRoute {
  raw: string;
  canonical: string;
  segments: readonly RouteSegment[];
}

export interface RouteRegistration {
  kind: RouteNameKind;
  value: string;
  feature: string;
  ownerNode: string;
  explicitOrder?: boolean;
}

const OPTIONAL_CATCHALL = /^\[\[\.\.\.([A-Za-z_][A-Za-z0-9_]*)\]\]$/;
const REQUIRED_CATCHALL = /^\[\.\.\.([A-Za-z_][A-Za-z0-9_]*)\]$/;
const BRACKET_PARAM = /^\[([A-Za-z_][A-Za-z0-9_]*)\]$/;
const COLON_PARAM = /^:([A-Za-z_][A-Za-z0-9_]*)(\?)?$/;
const BRACE_PARAM = /^\{([A-Za-z_][A-Za-z0-9_]*)(\?)?\}$/;

/**
 * One segment AST for Express/Fastify (`:param`), Next.js (`[param]`, `[...slug]`),
 * and OpenAPI (`{param}`), plus a single-segment `*` wildcard.
 */
export class RouteSegmentParser {
  parse(route: string, kind: RouteNameKind = "http_route"): ParsedRoute {
    if (typeof route !== "string" || route.length === 0 || route.length > 512) {
      throw new InvalidNameValueError(kind, String(route));
    }
    const trimmed = route.trim();
    if (!trimmed || /[\s?#\\]/.test(trimmed)) {
      throw new InvalidNameValueError(kind, route);
    }
    const slashed = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    const parts = slashed.split("/").filter((part) => part.length > 0);
    const segments = parts.map((part) => parseSegment(part, kind, route));
    const catchallAt = segments.findIndex((segment) => segment.type === "catchall");
    if (catchallAt !== -1 && catchallAt !== segments.length - 1) {
      throw new InvalidNameValueError(kind, route);
    }
    const canonical = segments.length === 0 ? "/" : `/${segments.map(canonicalSegment).join("/")}`;
    return { raw: route, canonical, segments };
  }

  canonicalize(route: string, kind: RouteNameKind = "http_route"): string {
    return this.parse(route, kind).canonical;
  }
}

export function detectRouteShadowing(routes: readonly RouteRegistration[]): RouteShadowConflict[] {
  const parser = new RouteSegmentParser();
  const parsed = routes.map((route) => ({
    route,
    parsed: parser.parse(route.value, route.kind),
  }));
  parsed.sort((left, right) => compareRoutes(left.route, right.route));
  const conflicts: RouteShadowConflict[] = [];
  for (let i = 0; i < parsed.length; i += 1) {
    const left = parsed[i];
    if (!left) continue;
    for (let j = i + 1; j < parsed.length; j += 1) {
      const right = parsed[j];
      if (!right || left.route.kind !== right.route.kind) continue;
      const code = classifyPair(left.parsed, right.parsed, left.route.value, right.route.value);
      if (code === null || allowedSameFeatureShadow(left.route, right.route, code)) continue;
      conflicts.push({
        code,
        kind: left.route.kind,
        left: sideOf(left.route, left.parsed.canonical),
        right: sideOf(right.route, right.parsed.canonical),
        message: shadowMessage(code, left.route, right.route),
      });
    }
  }
  return conflicts;
}

function parseSegment(part: string, kind: RouteNameKind, route: string): RouteSegment {
  if (part === "*") return { type: "wildcard" };
  const optionalCatchall = OPTIONAL_CATCHALL.exec(part);
  if (optionalCatchall?.[1]) return { type: "catchall", name: optionalCatchall[1], optional: true };
  const catchall = REQUIRED_CATCHALL.exec(part);
  if (catchall?.[1]) return { type: "catchall", name: catchall[1], optional: false };
  const bracket = BRACKET_PARAM.exec(part);
  if (bracket?.[1]) return { type: "param", name: bracket[1], optional: false };
  const colon = COLON_PARAM.exec(part);
  if (colon?.[1]) return { type: "param", name: colon[1], optional: colon[2] === "?" };
  const brace = BRACE_PARAM.exec(part);
  if (brace?.[1]) return { type: "param", name: brace[1], optional: brace[2] === "?" };
  if (/[\[\]{}:*]/.test(part)) throw new InvalidNameValueError(kind, route);
  return { type: "static", value: part.toLowerCase() };
}

function canonicalSegment(segment: RouteSegment): string {
  switch (segment.type) {
    case "static":
      return segment.value;
    case "param":
      return segment.optional ? `:${segment.name}?` : `:${segment.name}`;
    case "wildcard":
      return "*";
    case "catchall":
      return segment.optional ? `[[...${segment.name}]]` : `[...${segment.name}]`;
    default:
      return assertSegment(segment);
  }
}

function assertSegment(segment: never): never {
  throw new Error(`Unknown route segment ${JSON.stringify(segment)}.`);
}

function compareRoutes(left: RouteRegistration, right: RouteRegistration): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.value.localeCompare(right.value) ||
    left.feature.localeCompare(right.feature) ||
    left.ownerNode.localeCompare(right.ownerNode)
  );
}

function classifyPair(
  left: ParsedRoute,
  right: ParsedRoute,
  leftRaw: string,
  rightRaw: string,
): RouteShadowConflict["code"] | null {
  if (!patternsOverlap(left, right)) return null;
  if (left.canonical === right.canonical && differsByCaseOrSlash(leftRaw, rightRaw)) return "case_or_slash";
  if (shapesEquivalent(left.segments, right.segments)) return "equivalent";
  return "shadow";
}

function allowedSameFeatureShadow(
  left: RouteRegistration,
  right: RouteRegistration,
  code: RouteShadowConflict["code"],
): boolean {
  if (code !== "shadow") return false;
  if (left.feature !== right.feature) return false;
  return left.explicitOrder === true || right.explicitOrder === true;
}

function sideOf(route: RouteRegistration, canonical: string): RouteShadowConflict["left"] {
  return {
    value: route.value,
    canonical,
    feature: route.feature,
    ownerNode: route.ownerNode,
  };
}

function shadowMessage(
  code: RouteShadowConflict["code"],
  left: RouteRegistration,
  right: RouteRegistration,
): string {
  if (code === "equivalent") {
    return `${left.kind} ${left.value} (${left.feature}) and ${right.value} (${right.feature}) are the same parameterized route and shadow each other.`;
  }
  if (code === "case_or_slash") {
    return `${left.kind} ${left.value} (${left.feature}) and ${right.value} (${right.feature}) collide after case and trailing-slash canonicalization.`;
  }
  return `${left.kind} ${left.value} (${left.feature}) shadows ${right.value} (${right.feature}).`;
}

function patternsOverlap(left: ParsedRoute, right: ParsedRoute): boolean {
  const leftForms = expandSegments(left.segments);
  const rightForms = expandSegments(right.segments);
  return leftForms.some((leftForm) => rightForms.some((rightForm) => fixedOverlap(leftForm, rightForm)));
}

function expandSegments(segments: readonly RouteSegment[]): RouteSegment[][] {
  let forms: RouteSegment[][] = [[]];
  for (const segment of segments) {
    if (!isOptional(segment)) {
      forms = forms.map((form) => [...form, segment]);
      continue;
    }
    const next: RouteSegment[][] = [];
    for (const form of forms) {
      next.push(form);
      next.push([...form, { ...segment, optional: false }]);
    }
    forms = next;
  }
  return forms;
}

function isOptional(segment: RouteSegment): segment is Extract<RouteSegment, { optional: boolean }> {
  return (segment.type === "param" || segment.type === "catchall") && segment.optional;
}

function fixedOverlap(left: readonly RouteSegment[], right: readonly RouteSegment[]): boolean {
  return walk(left, 0, right, 0);
}

function walk(left: readonly RouteSegment[], i: number, right: readonly RouteSegment[], j: number): boolean {
  const leftSeg = left[i];
  const rightSeg = right[j];
  if (!leftSeg && !rightSeg) return true;
  if (leftSeg?.type === "catchall") return left.length - i === 1 && right.length - j >= 1;
  if (rightSeg?.type === "catchall") return right.length - j === 1 && left.length - i >= 1;
  if (!leftSeg || !rightSeg) return false;
  if (!segmentsCompatible(leftSeg, rightSeg)) return false;
  return walk(left, i + 1, right, j + 1);
}

function segmentsCompatible(left: RouteSegment, right: RouteSegment): boolean {
  if (left.type === "static" && right.type === "static") return left.value === right.value;
  if (left.type === "static") return right.type === "param" || right.type === "wildcard";
  if (right.type === "static") return left.type === "param" || left.type === "wildcard";
  return left.type !== "catchall" && right.type !== "catchall";
}

function shapesEquivalent(left: readonly RouteSegment[], right: readonly RouteSegment[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b || !sameShape(a, b)) return false;
  }
  return true;
}

function sameShape(left: RouteSegment, right: RouteSegment): boolean {
  if (left.type === "static" && right.type === "static") return left.value === right.value;
  if (left.type === "catchall" && right.type === "catchall") return left.optional === right.optional;
  const leftDynamic = left.type === "param" || left.type === "wildcard";
  const rightDynamic = right.type === "param" || right.type === "wildcard";
  if (!leftDynamic || !rightDynamic) return false;
  const leftOptional = left.type === "param" ? left.optional : false;
  const rightOptional = right.type === "param" ? right.optional : false;
  return leftOptional === rightOptional;
}

function differsByCaseOrSlash(left: string, right: string): boolean {
  if (left === right) return false;
  return looseRouteKey(left) === looseRouteKey(right);
}

function looseRouteKey(value: string): string {
  const trimmed = value.trim();
  const slashed = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const collapsed = slashed.replace(/\/{2,}/g, "/");
  const stripped = collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed;
  return stripped.toLowerCase();
}
