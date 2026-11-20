import { readyReadiness, type ReadinessCounts } from "./readiness-port.js";
import type { TouchesTag } from "./touches.js";
import {
  type AttrValue,
  type AxisKind,
  type AxisNode,
  type SettledProjectGraph,
  type StateTransition,
} from "./types.js";

interface NodeInput {
  readonly nodeId: string;
  readonly kind: AxisKind;
  readonly title: string;
  readonly touches?: readonly TouchesTag[];
  readonly attrs?: Readonly<Record<string, AttrValue>>;
}

function graph(input: {
  readonly projectId: string;
  readonly profile: SettledProjectGraph["profile"];
  readonly featureId: string;
  readonly featureTitle: string;
  readonly touches?: readonly TouchesTag[];
  readonly nodes: readonly NodeInput[];
  readonly transitions?: readonly StateTransition[];
  readonly readiness?: ReadinessCounts;
}): SettledProjectGraph {
  const feature: AxisNode = {
    nodeId: input.featureId,
    kind: "feature",
    title: input.featureTitle,
    touches: input.touches ?? [],
    featureId: input.featureId,
    attrs: {},
  };
  const nodes: AxisNode[] = [
    feature,
    ...input.nodes.map((node) => ({
      nodeId: node.nodeId,
      kind: node.kind,
      title: node.title,
      touches: node.touches ?? [],
      featureId: input.featureId,
      attrs: node.attrs ?? {},
    })),
  ];
  return {
    projectId: input.projectId,
    profile: input.profile,
    touches: input.touches ?? [],
    nodes,
    transitions: input.transitions ?? [],
    readiness: input.readiness ?? readyReadiness(),
  };
}

export function addAxisNode(source: SettledProjectGraph, node: AxisNode): SettledProjectGraph {
  return { ...source, nodes: [...source.nodes, node] };
}

export function renameAxisNode(
  source: SettledProjectGraph,
  nodeId: string,
  title: string,
): SettledProjectGraph {
  return {
    ...source,
    nodes: source.nodes.map((node) => (node.nodeId === nodeId ? { ...node, title } : node)),
  };
}

export function kitchenManagerRole(): AxisNode {
  return {
    nodeId: "role.kitchen_manager",
    kind: "role",
    title: "Kitchen Manager",
    touches: ["authz"],
    featureId: "feature.kitchen",
    attrs: {},
  };
}

export function kitchenMealOrderingGraph(): SettledProjectGraph {
  const transitions: StateTransition[] = [
    ["transition.draft_submitted", "state.draft", "state.submitted"],
    ["transition.submitted_locked", "state.submitted", "state.locked"],
    ["transition.locked_delivered", "state.locked", "state.delivered"],
    ["transition.draft_cancelled", "state.draft", "state.cancelled"],
    ["transition.submitted_cancelled", "state.submitted", "state.cancelled"],
    ["transition.locked_cancelled", "state.locked", "state.cancelled"],
  ].map(([nodeId, fromStateId, toStateId]) => ({
    nodeId: nodeId ?? "",
    fromStateId: fromStateId ?? "",
    toStateId: toStateId ?? "",
    kind: "valid" as const,
  }));
  return graph({
    projectId: "kitchen-meal-ordering",
    profile: "web_saas",
    featureId: "feature.kitchen",
    featureTitle: "Kitchen meal ordering",
    touches: [
      "authn",
      "authz",
      "route",
      "interactive_ui",
      "form_input",
      "personal_data",
      "outbound_message",
      "external_api",
      "inbound_webhook",
      "concurrent_edit",
      "migration",
      "destructive_write",
      "scheduling",
      "time_display",
    ],
    transitions,
    nodes: [
      ...transitions.map((transition) => ({
        nodeId: transition.nodeId,
        kind: "decision" as const,
        title: transition.nodeId,
      })),
      {
        nodeId: "role.anonymous",
        kind: "role",
        title: "Anonymous user",
        touches: ["authn"],
        attrs: { unauthenticated: true, anonymous: true },
      },
      { nodeId: "role.staff", kind: "role", title: "Staff", touches: ["authz"] },
      {
        nodeId: "role.admin",
        kind: "role",
        title: "Admin",
        touches: ["authz"],
        attrs: { admin: true },
      },
      {
        nodeId: "entity.order",
        kind: "entity",
        title: "Order",
        touches: ["scheduling"],
        attrs: { cutoff: true, shared: true },
      },
      {
        nodeId: "entity.dish",
        kind: "entity",
        title: "Dish",
        touches: ["user_content"],
        attrs: { stock: true, shared: true },
      },
      {
        nodeId: "entity.profile",
        kind: "entity",
        title: "Own Profile",
        touches: ["personal_data"],
        attrs: { profile: true, pii: true },
      },
      {
        nodeId: "entity.audit",
        kind: "entity",
        title: "Immutable audit log",
        touches: ["logging"],
        attrs: { immutable: true, auditLog: true },
      },
      {
        nodeId: "screen.kitchen_list",
        kind: "screen",
        title: "Kitchen list",
        touches: ["interactive_ui"],
        attrs: { print: true },
      },
      {
        nodeId: "screen.order_form",
        kind: "screen",
        title: "Order form",
        touches: ["form_input", "interactive_ui"],
      },
      { nodeId: "endpoint.orders_create", kind: "endpoint", title: "POST /api/orders", touches: ["route", "authz"] },
      {
        nodeId: "endpoint.orders_get",
        kind: "endpoint",
        title: "GET /api/orders/:id",
        touches: ["route", "authz"],
      },
      {
        nodeId: "endpoint.menu_list",
        kind: "endpoint",
        title: "GET /api/menu",
        touches: ["route"],
        attrs: { public: true },
      },
      {
        nodeId: "field.order_quantity",
        kind: "field",
        title: "Order.quantity",
        touches: ["form_input"],
        attrs: { required: true, min: 1, max: 20, format: "integer" },
      },
      {
        nodeId: "field.order_note",
        kind: "field",
        title: "Order.note",
        touches: ["form_input"],
        attrs: { required: false },
      },
      { nodeId: "state.draft", kind: "state", title: "draft", attrs: { machine: "order" } },
      { nodeId: "state.submitted", kind: "state", title: "submitted", attrs: { machine: "order" } },
      { nodeId: "state.locked", kind: "state", title: "locked", attrs: { machine: "order" } },
      {
        nodeId: "state.delivered",
        kind: "state",
        title: "delivered",
        attrs: { machine: "order", terminal: true },
      },
      {
        nodeId: "state.cancelled",
        kind: "state",
        title: "cancelled",
        attrs: { machine: "order", terminal: true },
      },
      {
        nodeId: "integration.delivery_webhook",
        kind: "integration",
        title: "Delivery status webhook",
        touches: ["inbound_webhook", "external_api"],
      },
      {
        nodeId: "notification.order_submitted",
        kind: "notification",
        title: "Order submitted email",
        touches: ["outbound_message"],
        attrs: { channel: "email", trigger: "order_submitted" },
      },
      {
        nodeId: "notification.order_locked",
        kind: "notification",
        title: "Order locked",
        touches: ["outbound_message"],
        attrs: { suppressed: true, channel: "email", trigger: "order_locked" },
      },
    ],
  });
}

export function backendApiGraph(): SettledProjectGraph {
  const transition: StateTransition = {
    nodeId: "transition.item_retire",
    fromStateId: "state.active",
    toStateId: "state.retired",
    kind: "valid",
  };
  return graph({
    projectId: "backend-api",
    profile: "backend_api",
    featureId: "feature.api",
    featureTitle: "Items API",
    touches: ["authn", "authz", "route", "personal_data", "external_api", "outbound_message", "migration"],
    transitions: [transition],
    nodes: [
      { nodeId: transition.nodeId, kind: "decision", title: transition.nodeId },
      {
        nodeId: "role.anonymous",
        kind: "role",
        title: "Anonymous user",
        attrs: { unauthenticated: true },
      },
      { nodeId: "role.staff", kind: "role", title: "Staff", touches: ["authz"] },
      { nodeId: "role.admin", kind: "role", title: "Admin", attrs: { admin: true }, touches: ["authz"] },
      { nodeId: "entity.item", kind: "entity", title: "Item", touches: ["personal_data"], attrs: { pii: true } },
      {
        nodeId: "entity.audit",
        kind: "entity",
        title: "Audit log",
        attrs: { immutable: true, auditLog: true },
      },
      { nodeId: "endpoint.items_get", kind: "endpoint", title: "GET /api/items/:id", touches: ["route", "authz"] },
      { nodeId: "endpoint.items_post", kind: "endpoint", title: "POST /api/items", touches: ["route", "authz"] },
      {
        nodeId: "field.item_name",
        kind: "field",
        title: "Item.name",
        touches: ["form_input"],
        attrs: { required: true, min: 1, max: 80, unique: true },
      },
      { nodeId: "state.active", kind: "state", title: "active", attrs: { machine: "item" } },
      {
        nodeId: "state.retired",
        kind: "state",
        title: "retired",
        attrs: { machine: "item", terminal: true },
      },
      {
        nodeId: "integration.billing",
        kind: "integration",
        title: "Billing API",
        touches: ["external_api"],
      },
      {
        nodeId: "notification.item_created",
        kind: "notification",
        title: "Item created email",
        touches: ["outbound_message"],
        attrs: { channel: "email", trigger: "item_created" },
      },
    ],
  });
}

export function headlessCliGraph(): SettledProjectGraph {
  return graph({
    projectId: "headless-cli",
    profile: "headless_cli",
    featureId: "feature.cli",
    featureTitle: "Local notes",
    nodes: [
      { nodeId: "role.owner", kind: "role", title: "Owner" },
      {
        nodeId: "entity.note",
        kind: "entity",
        title: "Note",
        attrs: { fileLock: true, persisted: true },
      },
    ],
  });
}

export function stressGraph(): SettledProjectGraph {
  const nodes: NodeInput[] = [
    {
      nodeId: "role.anonymous",
      kind: "role",
      title: "Anonymous user",
      attrs: { unauthenticated: true },
    },
    { nodeId: "role.admin", kind: "role", title: "Admin", attrs: { admin: true } },
  ];
  for (let index = 1; index <= 6; index += 1) {
    nodes.push({
      nodeId: `role.staff_${String(index).padStart(2, "0")}`,
      kind: "role",
      title: `Staff ${index}`,
    });
  }
  nodes.push({
    nodeId: "entity.e01",
    kind: "entity",
    title: "Entity 01",
    touches: ["personal_data"],
    attrs: { pii: true, shared: true },
  });
  for (let index = 2; index <= 24; index += 1) {
    nodes.push({
      nodeId: `entity.e${String(index).padStart(2, "0")}`,
      kind: "entity",
      title: `Entity ${index}`,
      attrs: { shared: true },
    });
  }
  nodes.push({
    nodeId: "entity.audit",
    kind: "entity",
    title: "Immutable audit log",
    attrs: { immutable: true, auditLog: true },
  });
  for (let index = 1; index <= 60; index += 1) {
    nodes.push({
      nodeId: `endpoint.ep${String(index).padStart(2, "0")}`,
      kind: "endpoint",
      title: `GET /api/private/${index}`,
      touches: ["route", "authz"],
    });
  }
  return graph({
    projectId: "stress-25-8-60",
    profile: "web_saas",
    featureId: "feature.stress",
    featureTitle: "Large SaaS",
    touches: ["authn", "authz", "route", "personal_data", "migration", "concurrent_edit", "destructive_write"],
    nodes,
  });
}

export function withProposedRole(source: SettledProjectGraph): SettledProjectGraph {
  const feature = source.nodes.find((node) => node.kind === "feature");
  if (!feature) throw new Error("graph has no feature");
  return addAxisNode(source, {
    nodeId: "role.proposed",
    kind: "role",
    title: "Proposed role",
    touches: [],
    featureId: feature.featureId,
    attrs: { basis: "proposed" },
  });
}
