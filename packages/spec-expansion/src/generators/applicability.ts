import {
  type ApplicabilityDecision,
  assertNever,
  type AxisNode,
  entityClass,
  type MatrixId,
  MATRIX_IDS,
  permissionClass,
  type SettledProjectGraph,
} from "./types.js";
import { type TouchesTag } from "./touches.js";

export interface ApplicabilityContext {
  readonly roles: readonly AxisNode[];
  readonly authenticatedRoles: readonly AxisNode[];
  readonly entities: readonly AxisNode[];
  readonly screens: readonly AxisNode[];
  readonly endpoints: readonly AxisNode[];
  readonly fields: readonly AxisNode[];
  readonly states: readonly AxisNode[];
  readonly integrations: readonly AxisNode[];
  readonly notifications: readonly AxisNode[];
  readonly touches: ReadonlySet<TouchesTag>;
}

function nodesOf(nodes: readonly AxisNode[], kind: AxisNode["kind"]): AxisNode[] {
  return nodes.filter((node) => node.kind === kind);
}

export function buildApplicabilityContext(
  graph: SettledProjectGraph,
  settled: readonly AxisNode[],
): ApplicabilityContext {
  const touches = new Set<TouchesTag>(graph.touches);
  for (const node of settled) {
    for (const tag of node.touches) touches.add(tag);
  }
  const roles = nodesOf(settled, "role");
  return {
    roles,
    authenticatedRoles: roles.filter((role) => permissionClass(role) !== "unauthenticated"),
    entities: nodesOf(settled, "entity"),
    screens: nodesOf(settled, "screen"),
    endpoints: nodesOf(settled, "endpoint"),
    fields: nodesOf(settled, "field"),
    states: nodesOf(settled, "state"),
    integrations: nodesOf(settled, "integration"),
    notifications: nodesOf(settled, "notification"),
    touches,
  };
}

function hasTouch(context: ApplicabilityContext, tag: TouchesTag): boolean {
  return context.touches.has(tag);
}

function skip(matrixId: MatrixId, skippedReason: string): ApplicabilityDecision {
  return { matrixId, active: false, skippedReason, narrowed: null };
}

function on(matrixId: MatrixId, narrowed: string | null = null): ApplicabilityDecision {
  return { matrixId, active: true, skippedReason: null, narrowed };
}

function decide(matrixId: MatrixId, graph: SettledProjectGraph, context: ApplicabilityContext): ApplicabilityDecision {
  switch (matrixId) {
    case "M01": {
      const singleUser =
        context.authenticatedRoles.length <= 1 &&
        !hasTouch(context, "authz") &&
        !hasTouch(context, "authn");
      if (context.roles.length === 0) return skip(matrixId, "no_roles");
      if (singleUser) return skip(matrixId, "single_user_no_role_matrix");
      return on(matrixId);
    }
    case "M02":
      return context.entities.length === 0 ? skip(matrixId, "no_entities") : on(matrixId);
    case "M03":
      if (graph.profile === "headless_cli") return skip(matrixId, "headless_no_ui");
      if (context.screens.length === 0) return skip(matrixId, "no_screens");
      return on(matrixId);
    case "M04":
      return context.endpoints.length === 0 ? skip(matrixId, "no_endpoints") : on(matrixId);
    case "M05":
      return context.fields.length === 0 ? skip(matrixId, "no_form_fields") : on(matrixId);
    case "M06":
      return context.states.length === 0 ? skip(matrixId, "no_state_machines") : on(matrixId);
    case "M07":
      return context.integrations.length === 0
        ? skip(matrixId, "no_external_integrations")
        : on(matrixId);
    case "M08":
      return context.notifications.length === 0 ? skip(matrixId, "no_notifications") : on(matrixId);
    case "M09": {
      const singleProcess =
        graph.profile === "headless_cli" ||
        (context.authenticatedRoles.length <= 1 && !hasTouch(context, "concurrent_edit"));
      if (singleProcess) {
        const fileBacked = context.entities.some((entity) => entity.attrs.fileLock === true);
        return fileBacked
          ? on(matrixId, "single_process_file_lock")
          : skip(matrixId, "no_shared_resources");
      }
      return context.entities.length === 0 ? skip(matrixId, "no_shared_resources") : on(matrixId);
    }
    case "M10": {
      if (context.entities.length === 0) return skip(matrixId, "no_entities");
      const privacy =
        hasTouch(context, "personal_data") ||
        hasTouch(context, "destructive_write") ||
        context.entities.some(
          (entity) =>
            entityClass(entity) === "immutable_audit" ||
            entityClass(entity) === "pii" ||
            entity.attrs.retention === true,
        );
      return privacy ? on(matrixId) : skip(matrixId, "no_retention_scope");
    }
    case "M11":
      if (graph.profile === "headless_cli") return skip(matrixId, "headless_no_viewport");
      if (context.screens.length === 0) return skip(matrixId, "no_screens");
      return on(matrixId);
    case "M12": {
      if (context.entities.length === 0 && !hasTouch(context, "migration")) {
        return skip(matrixId, "no_persistence");
      }
      const persisted = context.entities.some((entity) => entity.attrs.persisted !== false);
      if (!persisted && !hasTouch(context, "migration")) return skip(matrixId, "no_persistence");
      if (context.entities.length === 0) return skip(matrixId, "no_persistence");
      return on(matrixId);
    }
    default:
      return assertNever(matrixId);
  }
}

export function evaluateApplicability(
  graph: SettledProjectGraph,
  settled: readonly AxisNode[],
): ApplicabilityDecision[] {
  const context = buildApplicabilityContext(graph, settled);
  return MATRIX_IDS.map((matrixId) => decide(matrixId, graph, context));
}

export function sharedEntities(entities: readonly AxisNode[]): AxisNode[] {
  return entities.filter((entity) => {
    if (entity.attrs.immutable === true) return false;
    if (entity.attrs.shared === false) return false;
    return true;
  });
}
