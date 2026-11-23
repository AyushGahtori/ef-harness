import { acceptSourceAttribute, validateRoute } from "./path-guard.js";
import type {
  FiberDebugSource,
  IntersectingElement,
  LayoutBox,
  SteerKind,
  TokenStyles,
  ValidatedPick,
} from "./types.js";
import { PICK_MESSAGE_TYPE } from "./types.js";

const CLICK_KEYS = [
  "type",
  "gesture",
  "source",
  "ancestorSources",
  "role",
  "name",
  "text",
  "domPath",
  "snippet",
  "box",
  "styles",
  "viewportWidth",
  "route",
  "theme",
  "componentName",
  "fiberSource",
  "cropRect",
] as const;

const GAP_KEYS = [...CLICK_KEYS, "intersecting", "gapPx", "gapAxis"] as const;

export type PickParseResult =
  | { readonly ok: true; readonly kind: "escape" }
  | { readonly ok: true; readonly kind: "pick"; readonly pick: ValidatedPick }
  | { readonly ok: false; readonly reason: string };

export function parsePickMessage(input: unknown, projectRoot: string): PickParseResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "pick message must be an object" };
  }
  const record = input as Record<string, unknown>;
  if (record.type !== PICK_MESSAGE_TYPE) {
    return { ok: false, reason: "pick message type must be ef-pick-result" };
  }
  if (record.gesture === "escape") {
    if (!exactKeys(record, ["type", "gesture"])) {
      return { ok: false, reason: "escape message has unexpected fields" };
    }
    return { ok: true, kind: "escape" };
  }
  if (record.gesture !== "hover" && record.gesture !== "click" && record.gesture !== "gap") {
    return { ok: false, reason: "pick gesture is not supported" };
  }
  const keys = record.gesture === "gap" ? GAP_KEYS : CLICK_KEYS;
  if (!exactKeys(record, keys)) {
    return { ok: false, reason: "pick message does not match the ef-pick-result schema" };
  }
  const source = record.source;
  if (source !== null && typeof source !== "string") {
    return { ok: false, reason: "data-ef-source must be a string or null" };
  }
  if (typeof source === "string") {
    const accepted = acceptSourceAttribute(source, projectRoot);
    if (!accepted.ok) return { ok: false, reason: accepted.reason };
  }
  const ancestors = parseStringList(record.ancestorSources);
  if (!ancestors) return { ok: false, reason: "ancestorSources must be a string list" };
  for (const ancestor of ancestors) {
    const accepted = acceptSourceAttribute(ancestor, projectRoot);
    if (!accepted.ok) return { ok: false, reason: accepted.reason };
  }
  const box = parseBox(record.box);
  const cropRect = parseBox(record.cropRect);
  const styles = parseStyles(record.styles);
  if (!box || !cropRect || !styles) return { ok: false, reason: "pick geometry is invalid" };
  if (!isFiniteNumber(record.viewportWidth)) {
    return { ok: false, reason: "viewport width is invalid" };
  }
  if (typeof record.route !== "string" || !validateRoute(record.route)) {
    return { ok: false, reason: "route is outside the preview" };
  }
  if (record.theme !== "light" && record.theme !== "dark") {
    return { ok: false, reason: "theme must be light or dark" };
  }
  const text = nullableString(record.text);
  const domPath = nullableString(record.domPath);
  const snippet = nullableString(record.snippet);
  if (text === undefined || domPath === undefined || snippet === undefined) {
    return { ok: false, reason: "pick text fields are invalid" };
  }
  const role = nullableOrNull(record.role);
  const name = nullableOrNull(record.name);
  const componentName = nullableOrNull(record.componentName);
  if (role === undefined || name === undefined || componentName === undefined) {
    return { ok: false, reason: "pick identity fields are invalid" };
  }
  const fiber = parseFiber(record.fiberSource);
  if (fiber === undefined) return { ok: false, reason: "fiber source is invalid" };
  let intersecting: IntersectingElement[] = [];
  let gapPx: number | null = null;
  let gapAxis: "vertical" | "horizontal" | null = null;
  if (record.gesture === "gap") {
    const parsedHits = parseIntersecting(record.intersecting, projectRoot);
    if (!parsedHits.ok) return parsedHits;
    intersecting = parsedHits.hits;
    if (record.gapPx !== null && !isFiniteNumber(record.gapPx)) {
      return { ok: false, reason: "gap measurement is invalid" };
    }
    gapPx = record.gapPx === null ? null : record.gapPx;
    if (record.gapAxis !== null && record.gapAxis !== "vertical" && record.gapAxis !== "horizontal") {
      return { ok: false, reason: "gap axis is invalid" };
    }
    gapAxis = record.gapAxis;
  }
  return {
    ok: true,
    kind: "pick",
    pick: {
      gesture: record.gesture,
      source,
      ancestorSources: ancestors,
      role,
      name,
      text,
      domPath,
      snippet,
      box,
      styles,
      viewportWidth: record.viewportWidth,
      route: record.route,
      theme: record.theme,
      componentName,
      fiberSource: fiber,
      cropRect,
      intersecting,
      gapPx,
      gapAxis,
    },
  };
}

function parseIntersecting(
  value: unknown,
  projectRoot: string,
): { ok: true; hits: IntersectingElement[] } | { ok: false; reason: string } {
  if (!Array.isArray(value)) return { ok: false, reason: "intersecting elements must be a list" };
  const hits: IntersectingElement[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return { ok: false, reason: "intersecting element is invalid" };
    }
    const record = item as Record<string, unknown>;
    if (!exactKeys(record, ["source", "tag", "name", "box"])) {
      return { ok: false, reason: "intersecting element is invalid" };
    }
    if (record.source !== null && typeof record.source !== "string") {
      return { ok: false, reason: "intersecting source is invalid" };
    }
    if (typeof record.source === "string") {
      const accepted = acceptSourceAttribute(record.source, projectRoot);
      if (!accepted.ok) return { ok: false, reason: accepted.reason };
    }
    if (typeof record.tag !== "string" || typeof record.name !== "string") {
      return { ok: false, reason: "intersecting element is invalid" };
    }
    const box = parseBox(record.box);
    if (!box) return { ok: false, reason: "intersecting box is invalid" };
    hits.push({ source: record.source, tag: record.tag, name: record.name, box });
  }
  return { ok: true, hits };
}

export interface VisualSteerTarget {
  readonly kind: SteerKind;
  readonly node_id: string;
  readonly file: string;
  readonly component: string;
}

export interface VisualSteerSuccess {
  readonly target: VisualSteerTarget;
  readonly intent: string;
  readonly needs_question: boolean;
  readonly conflict: string | null;
}

export interface VisualSteerBlocked {
  readonly blocked: true;
  readonly reason: string;
}

export function parseVisualSteerV1(value: VisualSteerSuccess | VisualSteerBlocked): void {
  if ("blocked" in value) {
    if (value.blocked !== true || value.reason.trim().length === 0) {
      throw new Error("blocked visual-steer@1 exit is invalid");
    }
    if (Object.keys(value).some((key) => key !== "blocked" && key !== "reason")) {
      throw new Error("blocked visual-steer@1 exit has extra fields");
    }
    return;
  }
  const keys = Object.keys(value);
  if (keys.length !== 4 || keys.some((key) => !["target", "intent", "needs_question", "conflict"].includes(key))) {
    throw new Error("visual-steer@1 success has unexpected fields");
  }
  const kinds: readonly SteerKind[] = ["style", "copy", "layout", "behavior"];
  if (!kinds.includes(value.target.kind)) throw new Error("visual-steer@1 kind is invalid");
  if (/\s/.test(value.target.node_id) || value.target.node_id.trim().length === 0) {
    throw new Error("visual-steer@1 node_id is invalid");
  }
  if (value.target.file.trim().length === 0 || value.target.component.trim().length === 0) {
    throw new Error("visual-steer@1 target file is invalid");
  }
  if (value.intent.trim().length === 0) throw new Error("visual-steer@1 intent is empty");
  if (typeof value.needs_question !== "boolean") throw new Error("visual-steer@1 needs_question is invalid");
  if (value.conflict !== null && value.conflict.trim().length === 0) {
    throw new Error("visual-steer@1 conflict is blank");
  }
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === allowed.length && allowed.every((key) => keys.includes(key));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseBox(value: unknown): LayoutBox | null {
  if (!value || typeof value !== "object") return null;
  const box = value as Record<string, unknown>;
  if (!exactKeys(box, ["x", "y", "width", "height"])) return null;
  if (![box.x, box.y, box.width, box.height].every(isFiniteNumber)) return null;
  if ((box.width as number) < 0 || (box.height as number) < 0) return null;
  return { x: box.x as number, y: box.y as number, width: box.width as number, height: box.height as number };
}

function parseStyles(value: unknown): TokenStyles | null {
  if (!value || typeof value !== "object") return null;
  const styles = value as Record<string, unknown>;
  if (!exactKeys(styles, ["font", "color", "padding", "gap", "position"])) return null;
  if (
    typeof styles.font !== "string" ||
    typeof styles.color !== "string" ||
    typeof styles.padding !== "string" ||
    typeof styles.gap !== "string" ||
    typeof styles.position !== "string"
  ) {
    return null;
  }
  return {
    font: styles.font,
    color: styles.color,
    padding: styles.padding,
    gap: styles.gap,
    position: styles.position,
  };
}

function parseStringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value as string[];
}

function nullableString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nullableOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") return value;
  return undefined;
}

function parseFiber(value: unknown): FiberDebugSource | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const fiber = value as Record<string, unknown>;
  if (!exactKeys(fiber, ["fileName", "lineNumber", "columnNumber"])) return undefined;
  if (typeof fiber.fileName !== "string") return undefined;
  if (!isFiniteNumber(fiber.lineNumber) || !isFiniteNumber(fiber.columnNumber)) return undefined;
  return {
    fileName: fiber.fileName,
    lineNumber: fiber.lineNumber,
    columnNumber: fiber.columnNumber,
  };
}
