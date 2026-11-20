import { isRecord, unique } from "./canonical.js";
import { isM03State, M03_SOURCE, requiredScreenStates } from "./m03.js";
import { isLayoutTemplate, isSharedPrimitive } from "./templates.js";
import type { ComponentNode, ScreenContext, ScreenEndpoint, ScreenLabel, ScreenSpec } from "./types.js";

const SCREEN_KEYS = [
  "slug",
  "title",
  "route",
  "roles",
  "templateId",
  "components",
  "states",
  "labels",
  "copyConstraints",
  "keyboardOrder",
  "endpoints",
  "tags",
] as const;

const COMPONENT_KEYS = ["id", "primitive", "label", "variant", "columns", "focusable", "children"] as const;

const BANNED_STYLE_KEYS = new Set(["style", "className", "color", "css", "sx", "pixels"]);

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export class ScreenSpecGenerator {
  static readonly source = M03_SOURCE;

  generate(
    drafts: readonly unknown[],
    context: ScreenContext,
  ): { ok: true; specs: ScreenSpec[] } | { ok: false; issues: string[] } {
    if (context.surface !== "web") {
      if (drafts.length === 0) return { ok: true, specs: [] };
      return { ok: false, issues: ["headless feature cannot declare screens"] };
    }
    if (drafts.length === 0) {
      return { ok: false, issues: ["web feature requires at least one screen"] };
    }
    const issues: string[] = [];
    const specs: ScreenSpec[] = [];
    for (const [index, draft] of drafts.entries()) {
      const spec = this.readDraft(draft, `screens[${index}]`, context, issues);
      if (spec) specs.push(spec);
    }
    if (issues.length > 0) return { ok: false, issues };
    return { ok: true, specs };
  }

  validate(
    spec: ScreenSpec,
    context?: ScreenContext,
  ): { ok: true; spec: ScreenSpec } | { ok: false; issues: string[] } {
    const draft: Record<string, unknown> = {
      slug: spec.slug,
      title: spec.title,
      route: spec.route,
      roles: spec.roles,
      templateId: spec.templateId,
      components: spec.components,
      states: spec.states,
      labels: spec.labels,
      copyConstraints: spec.copyConstraints,
      keyboardOrder: spec.keyboardOrder,
      endpoints: spec.endpoints,
      tags: spec.tags,
    };
    const nextContext: ScreenContext = context ?? {
      featureId: spec.featureId,
      featureSlug: spec.slug,
      surface: "web",
      tags: spec.tags,
    };
    const generated = this.generate([draft], nextContext);
    if (!generated.ok) return generated;
    const parsed = generated.specs[0];
    if (!parsed) return { ok: false, issues: ["screen spec did not validate"] };
    return { ok: true, spec: parsed };
  }

  private readDraft(
    value: unknown,
    label: string,
    context: ScreenContext,
    issues: string[],
  ): ScreenSpec | null {
    if (!isRecord(value)) {
      issues.push(`${label} must be an object`);
      return null;
    }
    for (const key of Object.keys(value)) {
      if (!(SCREEN_KEYS as readonly string[]).includes(key)) {
        issues.push(`${label}.${key} is not allowed`);
      }
    }
    const slug = readString(value.slug, `${label}.slug`, issues);
    const title = readString(value.title, `${label}.title`, issues);
    const route = readString(value.route, `${label}.route`, issues);
    const templateId = readString(value.templateId, `${label}.templateId`, issues);
    const roles = readStringArray(value.roles, `${label}.roles`, issues);
    const states = readStringArray(value.states, `${label}.states`, issues);
    const copyConstraints = readStringArray(value.copyConstraints, `${label}.copyConstraints`, issues);
    const keyboardOrder = readStringArray(value.keyboardOrder, `${label}.keyboardOrder`, issues);
    const draftTags = value.tags === undefined ? [] : readStringArray(value.tags, `${label}.tags`, issues);
    const labels = readLabels(value.labels, `${label}.labels`, issues);
    const endpoints = readEndpoints(value.endpoints, `${label}.endpoints`, issues);
    const components = readComponents(value.components, `${label}.components`, issues, context, new Set());
    if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      issues.push(`${label}.slug must be a lowercase slug`);
    }
    if (route && (!route.startsWith("/") || route.includes(" "))) {
      issues.push(`${label}.route must be a path starting with /`);
    }
    if (roles && roles.length === 0) issues.push(`${label}.roles must list at least one role`);
    if (templateId && !isLayoutTemplate(templateId)) {
      issues.push(`${label}.templateId ${templateId} is not a design-system layout template`);
    }
    if (copyConstraints && copyConstraints.length === 0) {
      issues.push(`${label}.copyConstraints must state the visible copy`);
    }
    if (labels && labels.length === 0) issues.push(`${label}.labels must include the visible labels`);
    if (endpoints && endpoints.length === 0) {
      issues.push(`${label}.endpoints must name the data-fetching or mutation endpoints`);
    }
    if (components && components.length === 0) issues.push(`${label}.components must use shared primitives`);
    const tags = unique([...context.tags, ...(draftTags ?? [])]);
    if (states) {
      for (const state of states) {
        if (!isM03State(state)) issues.push(`${label} unknown state ${state}`);
      }
      for (const required of requiredScreenStates(tags)) {
        if (!states.includes(required)) issues.push(`${label} missing required state ${required}`);
      }
    }
    if (components && keyboardOrder) {
      const focusable = focusableIds(components);
      const left = [...focusable].sort();
      const right = [...keyboardOrder].sort();
      const same = left.length === right.length && left.every((item, index) => item === right[index]);
      if (!same) {
        issues.push(`${label}.keyboardOrder must list every focusable component once`);
      }
    }
    if (
      !slug ||
      !title ||
      !route ||
      !templateId ||
      !roles ||
      !states ||
      !copyConstraints ||
      !keyboardOrder ||
      !draftTags ||
      !labels ||
      !endpoints ||
      !components ||
      issues.length > 0
    ) {
      return null;
    }
    return {
      id: `SCR-${slug}`,
      slug,
      featureId: context.featureId,
      title,
      route,
      roles,
      templateId,
      components,
      states,
      labels,
      copyConstraints,
      keyboardOrder,
      endpoints,
      tags,
    };
  }
}

function readComponents(
  value: unknown,
  label: string,
  issues: string[],
  context: ScreenContext,
  ids: Set<string>,
): ComponentNode[] | null {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array`);
    return null;
  }
  const nodes: ComponentNode[] = [];
  for (const [index, item] of value.entries()) {
    const node = readComponent(item, `${label}[${index}]`, issues, context, ids);
    if (node) nodes.push(node);
  }
  return nodes;
}

function readComponent(
  value: unknown,
  label: string,
  issues: string[],
  context: ScreenContext,
  ids: Set<string>,
): ComponentNode | null {
  if (!isRecord(value)) {
    issues.push(`${label} must be an object`);
    return null;
  }
  for (const key of Object.keys(value)) {
    if (BANNED_STYLE_KEYS.has(key)) {
      issues.push(`${label}.${key} raw styling is not allowed`);
      continue;
    }
    if (!(COMPONENT_KEYS as readonly string[]).includes(key)) {
      issues.push(`${label}.${key} is not allowed`);
    }
  }
  const id = readString(value.id, `${label}.id`, issues);
  const primitive = readString(value.primitive, `${label}.primitive`, issues);
  if (id && ids.has(id)) issues.push(`${label}.id ${id} is duplicated`);
  if (id) ids.add(id);
  if (primitive && !isSharedPrimitive(primitive)) {
    issues.push(`${label}.primitive ${primitive} is not a shared primitive`);
  } else if (
    primitive &&
    context.observedPrimitives &&
    !context.observedPrimitives.includes(primitive)
  ) {
    issues.push(`${label}.primitive ${primitive} is not in the observed design system`);
  }
  if (!id || !primitive) return null;
  const node: ComponentNode = { id, primitive };
  if ("label" in value) {
    const text = readString(value.label, `${label}.label`, issues);
    if (text) node.label = text;
  }
  if ("variant" in value) {
    const variant = value.variant;
    if (variant !== "primary" && variant !== "secondary" && variant !== "danger") {
      issues.push(`${label}.variant must be primary, secondary, or danger`);
    } else {
      node.variant = variant;
    }
  }
  if ("columns" in value) {
    if (primitive !== "Table") issues.push(`${label}.columns are only valid on Table`);
    const columns = readStringArray(value.columns, `${label}.columns`, issues);
    if (columns) {
      for (const column of columns) {
        if (/\d+px/.test(column) || /#[0-9a-fA-F]{3,8}/.test(column)) {
          issues.push(`${label}.columns ${column} uses raw sizing`);
        }
      }
      node.columns = columns;
    }
  } else if (primitive === "Table") {
    issues.push(`${label} Table requires columns`);
  }
  if ("focusable" in value) {
    if (typeof value.focusable !== "boolean") issues.push(`${label}.focusable must be a boolean`);
    else node.focusable = value.focusable;
  }
  if ("children" in value) {
    const children = readComponents(value.children, `${label}.children`, issues, context, ids);
    if (children) node.children = children;
  }
  return node;
}

function readLabels(value: unknown, label: string, issues: string[]): ScreenLabel[] | null {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array`);
    return null;
  }
  const labels: ScreenLabel[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push(`${label}[${index}] must be an object`);
      continue;
    }
    const id = readString(item.id, `${label}[${index}].id`, issues);
    const text = readString(item.text, `${label}[${index}].text`, issues);
    if (id && text) labels.push({ id, text });
  }
  return labels;
}

function readEndpoints(value: unknown, label: string, issues: string[]): ScreenEndpoint[] | null {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array`);
    return null;
  }
  const endpoints: ScreenEndpoint[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push(`${label}[${index}] must be an object`);
      continue;
    }
    const id = readString(item.id, `${label}[${index}].id`, issues);
    const method = readString(item.method, `${label}[${index}].method`, issues);
    const path = readString(item.path, `${label}[${index}].path`, issues);
    const kind = item.kind === "fetch" || item.kind === "mutation" ? item.kind : "";
    if (!kind) issues.push(`${label}[${index}].kind must be fetch or mutation`);
    if (method && !HTTP_METHODS.has(method)) issues.push(`${label}[${index}].method is not an HTTP method`);
    if (path && !path.startsWith("/")) issues.push(`${label}[${index}].path must start with /`);
    if (id && kind && method && path) endpoints.push({ id, kind, method, path });
  }
  return endpoints;
}

function focusableIds(nodes: readonly ComponentNode[]): string[] {
  const ids: string[] = [];
  walkComponents(nodes, (node) => {
    if (node.primitive === "Button" || node.primitive === "Input" || node.focusable === true) {
      ids.push(node.id);
    }
  });
  return ids;
}

export function walkComponents(
  nodes: readonly ComponentNode[],
  visit: (node: ComponentNode) => void,
): void {
  for (const node of nodes) {
    visit(node);
    if (node.children) walkComponents(node.children, visit);
  }
}

function readString(value: unknown, label: string, issues: string[]): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${label} must be a non-empty string`);
    return null;
  }
  return value.trim();
}

function readStringArray(value: unknown, label: string, issues: string[]): string[] | null {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array of strings`);
    return null;
  }
  const out: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim() === "") {
      issues.push(`${label}[${index}] must be a non-empty string`);
      continue;
    }
    out.push(item.trim());
  }
  return out;
}
