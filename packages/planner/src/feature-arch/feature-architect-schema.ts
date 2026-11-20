import { isRecord } from "./canonical.js";
import {
  FEATURE_ARCHITECT_CONTRACT_ID,
  LOCAL_PORTS,
  type ComponentNode,
  type FeatureArchitectParse,
  type FeatureArchitectV1,
  type ScreenEndpoint,
  type ScreenLabel,
  type ScreenSpec,
  type TransitionSpec,
} from "./types.js";

/** Local port of Task 009 `FeatureArchitectV1Schema` until the Zod barrel exists. */
export const FEATURE_ARCHITECT_SCHEMA_SOURCE = LOCAL_PORTS.featureArchitectV1Schema;

const SUCCESS_KEYS = [
  "flows",
  "screens",
  "state_machines",
  "internal_contracts",
  "handling",
  "hoisted_rules",
] as const;

export function parseFeatureArchitectV1(value: unknown): FeatureArchitectParse {
  const issues: string[] = [];
  if (!isRecord(value)) return { ok: false, issues: ["feature-architect output must be an object"] };
  if ("blocked" in value) return parseBlocked(value);
  for (const key of Object.keys(value)) {
    if (!(SUCCESS_KEYS as readonly string[]).includes(key)) {
      issues.push(`${key} is not allowed on ${FEATURE_ARCHITECT_CONTRACT_ID}`);
    }
  }
  const flows = readFlows(value.flows, issues);
  const screens = readScreens(value.screens, issues);
  const stateMachines = readStateMachines(value.state_machines, issues);
  const contracts = readContracts(value.internal_contracts, issues);
  const handling = readHandling(value.handling, issues);
  const hoisted = readHoisted(value.hoisted_rules, issues);
  if (issues.length > 0 || !flows || !screens || !stateMachines || !contracts || !handling || !hoisted) {
    return { ok: false, issues };
  }
  const parsed: FeatureArchitectV1 = {
    flows,
    screens,
    state_machines: stateMachines,
    internal_contracts: contracts,
    handling,
    hoisted_rules: hoisted,
  };
  return { ok: true, value: parsed };
}

function parseBlocked(value: Record<string, unknown>): FeatureArchitectParse {
  const issues: string[] = [];
  for (const key of Object.keys(value)) {
    if (key !== "blocked" && key !== "reason" && key !== "missing_ids") {
      issues.push(`${key} is not allowed on a blocked feature-architect result`);
    }
  }
  if (value.blocked !== true) issues.push("blocked must be true");
  if (typeof value.reason !== "string" || value.reason.trim() === "") {
    issues.push("blocked reason must be a non-empty string");
  }
  let missing: string[] | undefined;
  if ("missing_ids" in value) {
    const parsed = readStringArray(value.missing_ids, "missing_ids", issues);
    if (parsed) missing = parsed;
  }
  if (issues.length > 0 || typeof value.reason !== "string") return { ok: false, issues };
  const blocked: { blocked: true; reason: string; missing_ids?: string[] } = {
    blocked: true,
    reason: value.reason.trim(),
  };
  if (missing) blocked.missing_ids = missing;
  return { ok: true, value: blocked };
}

function readFlows(value: unknown, issues: string[]): FeatureArchitectV1["flows"] | null {
  if (!Array.isArray(value)) {
    issues.push("flows must be an array");
    return null;
  }
  const flows: FeatureArchitectV1["flows"] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push(`flows[${index}] must be an object`);
      continue;
    }
    rejectUnknown(item, ["id", "steps"], `flows[${index}]`, issues);
    const id = readString(item.id, `flows[${index}].id`, issues);
    const steps = readStringArray(item.steps, `flows[${index}].steps`, issues);
    if (id && steps) flows.push({ id, steps });
  }
  return flows;
}

function readScreens(value: unknown, issues: string[]): ScreenSpec[] | null {
  if (!Array.isArray(value)) {
    issues.push("screens must be an array");
    return null;
  }
  const screens: ScreenSpec[] = [];
  for (const [index, item] of value.entries()) {
    const screen = readScreen(item, `screens[${index}]`, issues);
    if (screen) screens.push(screen);
  }
  return screens;
}

function readScreen(value: unknown, label: string, issues: string[]): ScreenSpec | null {
  if (!isRecord(value)) {
    issues.push(`${label} must be an object`);
    return null;
  }
  rejectUnknown(
    value,
    [
      "id",
      "slug",
      "featureId",
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
    ],
    label,
    issues,
  );
  const id = readString(value.id, `${label}.id`, issues);
  const slug = readString(value.slug, `${label}.slug`, issues);
  const featureId = readString(value.featureId, `${label}.featureId`, issues);
  const title = readString(value.title, `${label}.title`, issues);
  const route = readString(value.route, `${label}.route`, issues);
  const roles = readStringArray(value.roles, `${label}.roles`, issues);
  const templateId = readString(value.templateId, `${label}.templateId`, issues);
  const states = readStringArray(value.states, `${label}.states`, issues);
  const copyConstraints = readStringArray(value.copyConstraints, `${label}.copyConstraints`, issues);
  const keyboardOrder = readStringArray(value.keyboardOrder, `${label}.keyboardOrder`, issues);
  const tags = readStringArray(value.tags, `${label}.tags`, issues);
  const labels = readLabels(value.labels, `${label}.labels`, issues);
  const endpoints = readScreenEndpoints(value.endpoints, `${label}.endpoints`, issues);
  const components = readComponents(value.components, `${label}.components`, issues);
  if (
    !id ||
    !slug ||
    !featureId ||
    !title ||
    !route ||
    !roles ||
    !templateId ||
    !states ||
    !copyConstraints ||
    !keyboardOrder ||
    !tags ||
    !labels ||
    !endpoints ||
    !components
  ) {
    return null;
  }
  return {
    id,
    slug,
    featureId,
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
    rejectUnknown(item, ["id", "text"], `${label}[${index}]`, issues);
    const id = readString(item.id, `${label}[${index}].id`, issues);
    const text = readString(item.text, `${label}[${index}].text`, issues);
    if (id && text) labels.push({ id, text });
  }
  return labels;
}

function readScreenEndpoints(value: unknown, label: string, issues: string[]): ScreenEndpoint[] | null {
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
    rejectUnknown(item, ["id", "kind", "method", "path"], `${label}[${index}]`, issues);
    const id = readString(item.id, `${label}[${index}].id`, issues);
    const method = readString(item.method, `${label}[${index}].method`, issues);
    const path = readString(item.path, `${label}[${index}].path`, issues);
    const kind = item.kind === "fetch" || item.kind === "mutation" ? item.kind : "";
    if (!kind) issues.push(`${label}[${index}].kind must be fetch or mutation`);
    if (id && kind && method && path) endpoints.push({ id, kind, method, path });
  }
  return endpoints;
}

function readComponents(value: unknown, label: string, issues: string[]): ComponentNode[] | null {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array`);
    return null;
  }
  const nodes: ComponentNode[] = [];
  for (const [index, item] of value.entries()) {
    const node = readComponent(item, `${label}[${index}]`, issues);
    if (node) nodes.push(node);
  }
  return nodes;
}

function readComponent(value: unknown, label: string, issues: string[]): ComponentNode | null {
  if (!isRecord(value)) {
    issues.push(`${label} must be an object`);
    return null;
  }
  rejectUnknown(value, ["id", "primitive", "label", "variant", "columns", "focusable", "children"], label, issues);
  const id = readString(value.id, `${label}.id`, issues);
  const primitive = readString(value.primitive, `${label}.primitive`, issues);
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
    const columns = readStringArray(value.columns, `${label}.columns`, issues);
    if (columns) node.columns = columns;
  }
  if ("focusable" in value) {
    if (typeof value.focusable !== "boolean") issues.push(`${label}.focusable must be a boolean`);
    else node.focusable = value.focusable;
  }
  if ("children" in value) {
    const children = readComponents(value.children, `${label}.children`, issues);
    if (children) node.children = children;
  }
  return node;
}

function readStateMachines(value: unknown, issues: string[]): FeatureArchitectV1["state_machines"] | null {
  if (!Array.isArray(value)) {
    issues.push("state_machines must be an array");
    return null;
  }
  const machines: FeatureArchitectV1["state_machines"] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push(`state_machines[${index}] must be an object`);
      continue;
    }
    rejectUnknown(item, ["id", "mermaid", "transitions", "failureModes"], `state_machines[${index}]`, issues);
    const id = readString(item.id, `state_machines[${index}].id`, issues);
    const mermaid = readString(item.mermaid, `state_machines[${index}].mermaid`, issues);
    const failureModes = readStringArray(item.failureModes, `state_machines[${index}].failureModes`, issues);
    const transitions = readTransitions(item.transitions, `state_machines[${index}].transitions`, issues);
    if (id && mermaid && failureModes && transitions) {
      machines.push({ id, mermaid, transitions, failureModes });
    }
  }
  return machines;
}

function readTransitions(value: unknown, label: string, issues: string[]): TransitionSpec[] | null {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array`);
    return null;
  }
  const transitions: TransitionSpec[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push(`${label}[${index}] must be an object`);
      continue;
    }
    rejectUnknown(item, ["from", "to", "event"], `${label}[${index}]`, issues);
    const from = readString(item.from, `${label}[${index}].from`, issues);
    const to = readString(item.to, `${label}[${index}].to`, issues);
    const event = readString(item.event, `${label}[${index}].event`, issues);
    if (from && to && event) transitions.push({ from, to, event });
  }
  return transitions;
}

function readContracts(value: unknown, issues: string[]): FeatureArchitectV1["internal_contracts"] | null {
  if (!Array.isArray(value)) {
    issues.push("internal_contracts must be an array");
    return null;
  }
  const contracts: FeatureArchitectV1["internal_contracts"] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push(`internal_contracts[${index}] must be an object`);
      continue;
    }
    rejectUnknown(item, ["id", "request", "response", "errors"], `internal_contracts[${index}]`, issues);
    const id = readString(item.id, `internal_contracts[${index}].id`, issues);
    const request = readString(item.request, `internal_contracts[${index}].request`, issues);
    const response = readString(item.response, `internal_contracts[${index}].response`, issues);
    const errors = readStringArray(item.errors, `internal_contracts[${index}].errors`, issues);
    if (id && request && response && errors) contracts.push({ id, request, response, errors });
  }
  return contracts;
}

function readHandling(value: unknown, issues: string[]): FeatureArchitectV1["handling"] | null {
  if (!Array.isArray(value)) {
    issues.push("handling must be an array");
    return null;
  }
  const handling: FeatureArchitectV1["handling"] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push(`handling[${index}] must be an object`);
      continue;
    }
    rejectUnknown(item, ["spec_item_or_edge_case", "node_id"], `handling[${index}]`, issues);
    const spec = readString(item.spec_item_or_edge_case, `handling[${index}].spec_item_or_edge_case`, issues);
    const nodeId = readString(item.node_id, `handling[${index}].node_id`, issues);
    if (spec && nodeId) handling.push({ spec_item_or_edge_case: spec, node_id: nodeId });
  }
  return handling;
}

function readHoisted(value: unknown, issues: string[]): FeatureArchitectV1["hoisted_rules"] | null {
  if (!Array.isArray(value)) {
    issues.push("hoisted_rules must be an array");
    return null;
  }
  const rules: FeatureArchitectV1["hoisted_rules"] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push(`hoisted_rules[${index}] must be an object`);
      continue;
    }
    rejectUnknown(item, ["id", "text", "classification", "reason"], `hoisted_rules[${index}]`, issues);
    const id = readString(item.id, `hoisted_rules[${index}].id`, issues);
    const text = readString(item.text, `hoisted_rules[${index}].text`, issues);
    const classification = item.classification;
    if (classification !== "local" && classification !== "cross_cutting") {
      issues.push(`hoisted_rules[${index}].classification must be local or cross_cutting`);
      continue;
    }
    if (!id || !text) continue;
    const rule: FeatureArchitectV1["hoisted_rules"][number] = { id, text, classification };
    if ("reason" in item) {
      const reason = readString(item.reason, `hoisted_rules[${index}].reason`, issues);
      if (reason) rule.reason = reason;
    }
    rules.push(rule);
  }
  return rules;
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  issues: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push(`${label}.${key} is not allowed`);
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
