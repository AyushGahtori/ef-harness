import { sharedEntities } from "./applicability.js";
import {
  type ApplicabilityDecision,
  assertNever,
  attrFlag,
  attrString,
  type AxisNode,
  type CellDraft,
  entityActionAxis,
  entityClass,
  entityEndpointAxis,
  endpointStatusAxis,
  httpActorClass,
  M01_ACTIONS,
  type M01Action,
  M02_OPS,
  type M02Op,
  M03_PRINT_STATE,
  M03_UI_STATES,
  M04_STATUSES,
  type M04Status,
  M05_CHECKS,
  type M05Check,
  M07_FAILURES,
  M08_AXES,
  type M08Axis,
  M09_FILE_LOCK,
  M09_RACES,
  type M09Race,
  M10_AXES,
  type M10Axis,
  M11_AXES,
  M12_AXES,
  type MatrixId,
  permissionClass,
  type RawMatrixCell,
  screenStateAxis,
  sealCell,
  signatureOf,
  type SettledProjectGraph,
} from "./types.js";

const INVALID_TRANSITION_TEXT = "ALL invalid state transitions return 409 INVALID_TRANSITION";
const PRIVATE_401_TEXT = "ALL unauthenticated requests to /api/private/* return 401";

const M02_MUTATIONS: ReadonlySet<M02Op> = new Set([
  "update",
  "soft_delete",
  "hard_delete",
  "restore",
  "archive",
  "ownership_transfer",
]);

function nodes(settled: readonly AxisNode[], kind: AxisNode["kind"]): AxisNode[] {
  return settled.filter((node) => node.kind === kind);
}

const NO_DOMAINS: readonly string[] = [];
const DENY_SIGNATURE = signatureOf("deny_unauthenticated", null);
const ALLOW_SIGNATURE = signatureOf("allow", null);

class DomainIndex {
  private readonly sets = new Map<string, Set<string>>();

  add(matrixId: MatrixId, scopeKey: string, id: string): void {
    const key = `${matrixId}\n${scopeKey}`;
    let set = this.sets.get(key);
    if (!set) {
      set = new Set();
      this.sets.set(key, set);
    }
    set.add(id);
  }

  freeze(): Map<string, readonly string[]> {
    const frozen = new Map<string, readonly string[]>();
    for (const [key, set] of this.sets) {
      frozen.set(key, [...set].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));
    }
    return frozen;
  }
}

export function createDomainIndex(): DomainIndex {
  return new DomainIndex();
}

function open(outcome: string): {
  outcome: string;
  reason: null;
  notApplicable: false;
  forceException: false;
  ruleText: null;
} {
  return { outcome, reason: null, notApplicable: false, forceException: false, ruleText: null };
}

function blocked(
  reason: string,
): {
  outcome: "not_applicable";
  reason: string;
  notApplicable: true;
  forceException: false;
  ruleText: null;
} {
  return {
    outcome: "not_applicable",
    reason,
    notApplicable: true,
    forceException: false,
    ruleText: null,
  };
}

function terminalRuleText(titles: readonly string[]): string {
  const unique = [...new Set(titles)];
  const pair =
    unique.length === 2 && unique.includes("delivered") && unique.includes("cancelled");
  const rendered = pair ? "delivered, cancelled" : [...unique].sort().join(", ");
  return `No outgoing transitions permitted from terminal states {${rendered}}`;
}

function m01ActionOutcome(role: AxisNode, entity: AxisNode, action: M01Action) {
  const actor = permissionClass(role);
  const subject = entityClass(entity);
  if (actor === "unauthenticated" && subject === "profile" && action === "update") {
    return blocked("anonymous_cannot_edit_own_profile");
  }
  if (subject === "immutable_audit" && action === "update") {
    return blocked("immutable_audit_no_update");
  }
  if (subject === "immutable_audit" && (action === "delete" || action === "admin")) {
    return blocked("immutable_audit_no_mutation");
  }
  if (actor === "unauthenticated") return open("deny_unauthenticated");
  if (subject === "immutable_audit" && action === "create") return open("allow_append");
  if (subject === "immutable_audit" && action === "read") return open("allow_read");
  if (action === "admin" && actor !== "admin") return open("deny_requires_admin");
  if (action === "delete" && actor !== "admin") return open("deny_requires_admin");
  return open("allow");
}

function generateM01(settled: readonly AxisNode[], domains: DomainIndex): RawMatrixCell[] {
  const roles = nodes(settled, "role");
  const entities = nodes(settled, "entity");
  const endpoints = nodes(settled, "endpoint");
  const actionCount = roles.length * entities.length * M01_ACTIONS.length;
  const epCount = roles.length * entities.length * endpoints.length;
  const cells: RawMatrixCell[] = new Array(actionCount + epCount);
  let cursor = 0;
  const seenActors = new Set<string>();
  for (const role of roles) {
    const actor = permissionClass(role);
    seenActors.add(actor);
    for (const entity of entities) {
      const subject = entityClass(entity);
      for (const action of M01_ACTIONS) {
        const decision = m01ActionOutcome(role, entity, action);
        const axisB = entityActionAxis(entity.nodeId, action);
        cells[cursor] = {
          id: `cell:M01:${role.nodeId}:${axisB}`,
          matrixId: "M01",
          axisA: role.nodeId,
          axisB,
          domainNodeIds: [role.nodeId, entity.nodeId],
          outcome: decision.outcome,
          reason: decision.reason,
          notApplicable: decision.notApplicable,
          scopeKey: `ea|${actor}|${subject}|${action}`,
          forceException: decision.forceException,
          ruleText: decision.ruleText,
          signature: decision.reason === null ? `${decision.outcome}|` : `${decision.outcome}|${decision.reason}`,
        };
        cursor += 1;
      }
    }
  }
  for (const actor of seenActors) {
    const scopeKey = `ep|${actor}`;
    for (const role of roles) {
      if (permissionClass(role) !== actor) continue;
      domains.add("M01", scopeKey, role.nodeId);
    }
    for (const entity of entities) domains.add("M01", scopeKey, entity.nodeId);
    for (const endpoint of endpoints) domains.add("M01", scopeKey, endpoint.nodeId);
  }
  const epAxis = new Map<string, readonly string[]>();
  for (const entity of entities) {
    const axes: string[] = new Array(endpoints.length);
    for (let i = 0; i < endpoints.length; i += 1) {
      const endpoint = endpoints[i];
      if (endpoint) axes[i] = entityEndpointAxis(entity.nodeId, endpoint.nodeId);
    }
    epAxis.set(entity.nodeId, axes);
  }
  const deny = actorOutcome("unauthenticated");
  const allow = actorOutcome("authenticated");
  for (const role of roles) {
    const actor = permissionClass(role);
    const outcome = actor === "unauthenticated" ? deny : allow;
    const scopeKey = `ep|${actor}`;
    const rolePrefix = `cell:M01:${role.nodeId}:`;
    for (const entity of entities) {
      const axes = epAxis.get(entity.nodeId);
      if (!axes) continue;
      for (let i = 0; i < axes.length; i += 1) {
        const axisB = axes[i];
        if (!axisB) continue;
        cells[cursor] = {
          id: `${rolePrefix}${axisB}`,
          matrixId: "M01",
          axisA: role.nodeId,
          axisB,
          domainNodeIds: NO_DOMAINS,
          outcome: outcome.outcome,
          reason: null,
          notApplicable: false,
          scopeKey,
          forceException: false,
          ruleText: null,
          signature: outcome.signature,
        };
        cursor += 1;
      }
    }
  }
  cells.length = cursor;
  return cells;
}

function actorOutcome(actor: string): { readonly outcome: string; readonly signature: string } {
  if (actor === "unauthenticated") {
    return { outcome: "deny_unauthenticated", signature: DENY_SIGNATURE };
  }
  return { outcome: "allow", signature: ALLOW_SIGNATURE };
}

function m02Outcome(entity: AxisNode, op: M02Op) {
  if (entityClass(entity) !== "immutable_audit") return open("open_lifecycle");
  if (M02_MUTATIONS.has(op)) return blocked("immutable_audit_no_mutation");
  if (op === "create") return open("allow_append");
  return open("allow_read");
}

function generateM02(settled: readonly AxisNode[]): RawMatrixCell[] {
  const cells: RawMatrixCell[] = [];
  for (const entity of nodes(settled, "entity")) {
    const subject = entityClass(entity);
    for (const op of M02_OPS) {
      cells.push(sealCell({
        matrixId: "M02",
        axisA: entity.nodeId,
        axisB: op,
        domainNodeIds: [entity.nodeId],
        scopeKey: `life|${subject}|${op}`,
        ...m02Outcome(entity, op),
      }));
    }
  }
  return cells;
}

function generateM03(settled: readonly AxisNode[]): RawMatrixCell[] {
  const cells: RawMatrixCell[] = [];
  const screens = nodes(settled, "screen");
  for (const role of nodes(settled, "role")) {
    for (const screen of screens) {
      const states: string[] = [...M03_UI_STATES];
      if (attrFlag(screen, "print")) states.push(M03_PRINT_STATE);
      for (const uiState of states) {
        cells.push(sealCell({
          matrixId: "M03",
          axisA: role.nodeId,
          axisB: screenStateAxis(screen.nodeId, uiState),
          domainNodeIds: [role.nodeId, screen.nodeId],
          scopeKey: `ui|${uiState}|${attrFlag(screen, "print") ? "print" : "noprint"}`,
          ...open("open_ui_state"),
        }));
      }
    }
  }
  return cells;
}

function m04Outcome(role: AxisNode, endpoint: AxisNode, status: M04Status) {
  const actor = httpActorClass(role);
  const visibility = attrFlag(endpoint, "public") ? "public" : "private";
  if (actor === "unauthenticated" && visibility === "private" && status === "401") {
    return {
      outcome: "return_401",
      reason: null,
      notApplicable: false as const,
      forceException: false,
      ruleText: PRIVATE_401_TEXT,
    };
  }
  if (actor === "unauthenticated" && visibility === "private") {
    return blocked(`unauthenticated_private_is_401_not_${status}`);
  }
  if (actor === "unauthenticated" && status === "401") return blocked("public_endpoint_not_401");
  if (actor === "unauthenticated" && status === "200/201") return open("public_success");
  if (actor === "unauthenticated") return open("public_error");
  if (status === "401") return blocked("authenticated_is_not_401");
  if (status === "403") return open("403_forbidden");
  if (status === "404") return open("404_cross_tenant_idor");
  if (status === "400") return open("400_validation");
  if (status === "409") return open("409_conflict");
  if (status === "422") return open("422_domain_rule");
  if (status === "429") return open("429_rate_limit");
  if (status === "500") return open("500_safe_fallback");
  return open("success");
}

function generateM04(settled: readonly AxisNode[], domains: DomainIndex): CellDraft[] {
  const roles = nodes(settled, "role");
  const endpoints = nodes(settled, "endpoint");
  const actors = new Set(roles.map((role) => httpActorClass(role)));
  const visibilities = new Set(endpoints.map((endpoint) => (attrFlag(endpoint, "public") ? "public" : "private")));
  for (const actor of actors) {
    for (const visibility of visibilities) {
      for (const status of M04_STATUSES) {
        const scopeKey = `http|${actor}|${visibility}|${status}`;
        for (const role of roles) {
          if (httpActorClass(role) !== actor) continue;
          domains.add("M04", scopeKey, role.nodeId);
        }
        for (const endpoint of endpoints) {
          const endpointVisibility = attrFlag(endpoint, "public") ? "public" : "private";
          if (endpointVisibility !== visibility) continue;
          domains.add("M04", scopeKey, endpoint.nodeId);
        }
      }
    }
  }
  type StatusPreset = {
    readonly scopeKey: string;
    readonly outcome: string;
    readonly reason: string | null;
    readonly notApplicable: boolean;
    readonly forceException: boolean;
    readonly ruleText: string | null;
  };
  const byActor = new Map<string, Map<string, Map<M04Status, StatusPreset>>>();
  for (const actor of actors) {
    const byVisibility = new Map<string, Map<M04Status, StatusPreset>>();
    for (const visibility of visibilities) {
      const byStatus = new Map<M04Status, StatusPreset>();
      const sampleRole = roles.find((role) => httpActorClass(role) === actor);
      const sampleEndpoint = endpoints.find(
        (endpoint) => (attrFlag(endpoint, "public") ? "public" : "private") === visibility,
      );
      if (sampleRole && sampleEndpoint) {
        for (const status of M04_STATUSES) {
          const decision = m04Outcome(sampleRole, sampleEndpoint, status);
          byStatus.set(status, {
            scopeKey: `http|${actor}|${visibility}|${status}`,
            outcome: decision.outcome,
            reason: decision.reason,
            notApplicable: decision.notApplicable,
            forceException: decision.forceException,
            ruleText: decision.ruleText,
          });
        }
      }
      byVisibility.set(visibility, byStatus);
    }
    byActor.set(actor, byVisibility);
  }
  const axisByEndpoint = new Map<string, ReadonlyMap<M04Status, string>>();
  for (const endpoint of endpoints) {
    const byStatus = new Map<M04Status, string>();
    for (const status of M04_STATUSES) {
      byStatus.set(status, endpointStatusAxis(endpoint.nodeId, status));
    }
    axisByEndpoint.set(endpoint.nodeId, byStatus);
  }
  const cells: CellDraft[] = new Array(roles.length * endpoints.length * M04_STATUSES.length);
  let cursor = 0;
  for (const role of roles) {
    const actor = httpActorClass(role);
    for (const endpoint of endpoints) {
      const visibility = attrFlag(endpoint, "public") ? "public" : "private";
      const byStatus = axisByEndpoint.get(endpoint.nodeId);
      const presets = byActor.get(actor)?.get(visibility);
      for (const status of M04_STATUSES) {
        const preset = presets?.get(status);
        if (!preset) continue;
        cells[cursor] = {
          matrixId: "M04",
          axisA: role.nodeId,
          axisB: byStatus?.get(status) ?? endpointStatusAxis(endpoint.nodeId, status),
          domainNodeIds: NO_DOMAINS,
          scopeKey: preset.scopeKey,
          outcome: preset.outcome,
          reason: preset.reason,
          notApplicable: preset.notApplicable,
          forceException: preset.forceException,
          ruleText: preset.ruleText,
        };
        cursor += 1;
      }
    }
  }
  cells.length = cursor;
  return cells;
}

function m05Outcome(field: AxisNode, check: M05Check) {
  const required = attrFlag(field, "required");
  const unique = attrFlag(field, "unique");
  const cross = attrFlag(field, "crossField");
  const format = attrString(field, "format");
  switch (check) {
    case "required_optional":
      return open(required ? "required" : "optional");
    case "min_max":
      return open(
        typeof field.attrs.min === "number" || typeof field.attrs.max === "number"
          ? "bounded"
          : "unbounded",
      );
    case "format":
      return format === null ? blocked("no_format_constraint") : open(`format:${format}`);
    case "unicode_emoji":
      return open("accept_unicode");
    case "whitespace_trim":
      return open("trim");
    case "duplicate_uniqueness":
      return open(unique ? "unique" : "not_unique");
    case "cross_field":
      return cross ? open("cross_field") : blocked("no_cross_field_rule");
    default:
      return assertNever(check);
  }
}

function generateM05(settled: readonly AxisNode[]): CellDraft[] {
  const cells: CellDraft[] = [];
  for (const field of nodes(settled, "field")) {
    for (const check of M05_CHECKS) {
      const decision = m05Outcome(field, check);
      cells.push({
        matrixId: "M05",
        axisA: field.nodeId,
        axisB: check,
        domainNodeIds: [field.nodeId],
        scopeKey: `field|${field.nodeId}|${check}`,
        ...decision,
      });
    }
  }
  return cells;
}

function generateM06(graph: SettledProjectGraph, settled: readonly AxisNode[]): CellDraft[] {
  const cells: CellDraft[] = [];
  const states = nodes(settled, "state");
  const byMachine = new Map<string, AxisNode[]>();
  for (const state of states) {
    const machine = attrString(state, "machine") ?? "default";
    const bucket = byMachine.get(machine);
    if (bucket) bucket.push(state);
    else byMachine.set(machine, [state]);
  }
  const valid = new Set(
    graph.transitions
      .filter((transition) => transition.kind === "valid")
      .map((transition) => `${transition.fromStateId}>${transition.toStateId}`),
  );
  const transitionByPair = new Map<string, string>(
    graph.transitions
      .filter((transition) => transition.kind === "valid")
      .map((transition) => [`${transition.fromStateId}>${transition.toStateId}`, transition.nodeId]),
  );
  for (const machineStates of byMachine.values()) {
    const titles = machineStates.filter((state) => attrFlag(state, "terminal")).map((state) => state.title);
    const terminalText = titles.length > 0 ? terminalRuleText(titles) : null;
    for (const from of machineStates) {
      const fromTerminal = attrFlag(from, "terminal");
      for (const to of machineStates) {
        if (fromTerminal) {
          cells.push({
            matrixId: "M06",
            axisA: from.nodeId,
            axisB: to.nodeId,
            domainNodeIds: [from.nodeId, to.nodeId],
            scopeKey: `terminal|${machineOf(from)}`,
            outcome: "not_applicable",
            reason: "terminal_no_outgoing",
            notApplicable: true,
            forceException: false,
            ruleText: terminalText,
          });
          continue;
        }
        const pair = `${from.nodeId}>${to.nodeId}`;
        if (valid.has(pair)) {
          const transitionId = transitionByPair.get(pair);
          cells.push({
            matrixId: "M06",
            axisA: from.nodeId,
            axisB: to.nodeId,
            domainNodeIds: transitionId ? [from.nodeId, to.nodeId, transitionId] : [from.nodeId, to.nodeId],
            scopeKey: `valid|${pair}`,
            outcome: "valid_transition",
            reason: null,
            notApplicable: false,
            forceException: true,
            ruleText: null,
          });
          continue;
        }
        cells.push({
          matrixId: "M06",
          axisA: from.nodeId,
          axisB: to.nodeId,
          domainNodeIds: [from.nodeId, to.nodeId],
          scopeKey: `invalid|${machineOf(from)}`,
          outcome: "409_INVALID_TRANSITION",
          reason: null,
          notApplicable: false,
          forceException: false,
          ruleText: INVALID_TRANSITION_TEXT,
        });
      }
      if (!fromTerminal) {
        cells.push({
          matrixId: "M06",
          axisA: from.nodeId,
          axisB: "cutoff_expired",
          domainNodeIds: [from.nodeId],
          scopeKey: `cutoff|${from.nodeId}`,
          outcome: "cutoff_expired",
          reason: null,
          notApplicable: false,
          forceException: true,
          ruleText: null,
        });
      }
    }
  }
  return cells;
}

function machineOf(state: AxisNode): string {
  return attrString(state, "machine") ?? "default";
}

function generateM07(settled: readonly AxisNode[]): CellDraft[] {
  const cells: CellDraft[] = [];
  for (const integration of nodes(settled, "integration")) {
    for (const failure of M07_FAILURES) {
      cells.push({
        matrixId: "M07",
        axisA: integration.nodeId,
        axisB: failure,
        domainNodeIds: [integration.nodeId],
        scopeKey: `fail|${failure}`,
        ...open("open_failure"),
      });
    }
  }
  return cells;
}

function m08Outcome(notification: AxisNode, axis: M08Axis) {
  if (attrFlag(notification, "suppressed")) return open("no_notification");
  switch (axis) {
    case "trigger_event":
      return open(`trigger:${attrString(notification, "trigger") ?? "unspecified"}`);
    case "channel":
      return open(`channel:${attrString(notification, "channel") ?? "unspecified"}`);
    case "recipient_rule":
      return open("recipient:settled");
    case "dedup_idempotency":
      return open("dedup:required");
    case "bounce_failure":
      return open("bounce:retry_then_dead_letter");
    case "unsubscribe_mute":
      return open("unsubscribe:honor");
    default:
      return assertNever(axis);
  }
}

function generateM08(settled: readonly AxisNode[]): CellDraft[] {
  const cells: CellDraft[] = [];
  for (const notification of nodes(settled, "notification")) {
    const mode = attrFlag(notification, "suppressed") ? "suppressed" : "active";
    for (const axis of M08_AXES) {
      const decision = m08Outcome(notification, axis);
      cells.push({
        matrixId: "M08",
        axisA: notification.nodeId,
        axisB: axis,
        domainNodeIds: [notification.nodeId],
        scopeKey: `note|${mode}|${axis}|${decision.outcome}`,
        ...decision,
      });
    }
  }
  return cells;
}

function m09Outcome(entity: AxisNode, race: M09Race) {
  if (race === "concurrent_cutoff_boundary") {
    return attrFlag(entity, "cutoff")
      ? open("cutoff_boundary_reject")
      : blocked("no_cutoff");
  }
  if (race === "concurrent_stock_quota_decrement") {
    return attrFlag(entity, "stock") ? open("conflict_409") : blocked("no_stock_quota");
  }
  return open("conflict_409");
}

function generateM09(settled: readonly AxisNode[], decision: ApplicabilityDecision): CellDraft[] {
  const cells: CellDraft[] = [];
  if (decision.narrowed === "single_process_file_lock") {
    for (const entity of nodes(settled, "entity")) {
      if (!attrFlag(entity, "fileLock")) continue;
      cells.push({
        matrixId: "M09",
        axisA: entity.nodeId,
        axisB: M09_FILE_LOCK,
        domainNodeIds: [entity.nodeId],
        scopeKey: "file_lock",
        ...open("file_lock_exclusive"),
      });
    }
    return cells;
  }
  for (const entity of sharedEntities(nodes(settled, "entity"))) {
    for (const race of M09_RACES) {
      const outcome = m09Outcome(entity, race);
      cells.push({
        matrixId: "M09",
        axisA: entity.nodeId,
        axisB: race,
        domainNodeIds: [entity.nodeId],
        scopeKey: `race|${race}|${outcome.outcome}|${outcome.reason ?? ""}`,
        ...outcome,
      });
    }
  }
  return cells;
}

function m10Outcome(entity: AxisNode, axis: M10Axis) {
  const subject = entityClass(entity);
  if (subject === "immutable_audit") {
    switch (axis) {
      case "pii_classification":
        return open("not_pii");
      case "retention_window":
        return open("retain_indefinite");
      case "user_deletion_anonymization":
        return blocked("audit_not_user_deletable");
      case "audit_log_retention":
        return open("retain_immutable");
      case "export_redaction":
        return open("redact_secrets");
      default:
        return assertNever(axis);
    }
  }
  if (subject === "pii" || attrFlag(entity, "pii")) {
    switch (axis) {
      case "pii_classification":
        return open("personal_data");
      case "retention_window":
        return open("open_policy");
      case "user_deletion_anonymization":
        return open("anonymize_on_user_deletion");
      case "audit_log_retention":
        return open("retain_audit_separately");
      case "export_redaction":
        return open("redact_pii");
      default:
        return assertNever(axis);
    }
  }
  switch (axis) {
    case "pii_classification":
      return open("not_pii");
    case "retention_window":
      return open("open_policy");
    case "user_deletion_anonymization":
      return open("delete_with_parent");
    case "audit_log_retention":
      return open("retain_audit_separately");
    case "export_redaction":
      return open("export_plain");
    default:
      return assertNever(axis);
  }
}

function generateM10(settled: readonly AxisNode[]): CellDraft[] {
  const cells: CellDraft[] = [];
  for (const entity of nodes(settled, "entity")) {
    const subject = entityClass(entity);
    for (const axis of M10_AXES) {
      cells.push({
        matrixId: "M10",
        axisA: entity.nodeId,
        axisB: axis,
        domainNodeIds: [entity.nodeId],
        scopeKey: `priv|${subject}|${axis}`,
        ...m10Outcome(entity, axis),
      });
    }
  }
  return cells;
}

function generateM11(settled: readonly AxisNode[]): CellDraft[] {
  const cells: CellDraft[] = [];
  for (const screen of nodes(settled, "screen")) {
    for (const axis of M11_AXES) {
      cells.push({
        matrixId: "M11",
        axisA: screen.nodeId,
        axisB: axis,
        domainNodeIds: [screen.nodeId],
        scopeKey: `view|${axis}`,
        ...open("open_viewport"),
      });
    }
  }
  return cells;
}

function generateM12(settled: readonly AxisNode[]): CellDraft[] {
  const cells: CellDraft[] = [];
  for (const entity of nodes(settled, "entity")) {
    if (entity.attrs.persisted === false) continue;
    for (const axis of M12_AXES) {
      cells.push({
        matrixId: "M12",
        axisA: entity.nodeId,
        axisB: axis,
        domainNodeIds: [entity.nodeId],
        scopeKey: `mig|${axis}`,
        ...open("open_migration"),
      });
    }
  }
  return cells;
}

function finish(cells: readonly CellDraft[]): RawMatrixCell[] {
  return cells.map((draft) => sealCell(draft));
}

export function generateMatrix(
  matrixId: MatrixId,
  graph: SettledProjectGraph,
  settled: readonly AxisNode[],
  decision: ApplicabilityDecision,
  domains: DomainIndex,
): RawMatrixCell[] {
  if (!decision.active) return [];
  switch (matrixId) {
    case "M01":
      return finish(generateM01(settled, domains));
    case "M02":
      return finish(generateM02(settled));
    case "M03":
      return finish(generateM03(settled));
    case "M04":
      return finish(generateM04(settled, domains));
    case "M05":
      return finish(generateM05(settled));
    case "M06":
      return finish(generateM06(graph, settled));
    case "M07":
      return finish(generateM07(settled));
    case "M08":
      return finish(generateM08(settled));
    case "M09":
      return finish(generateM09(settled, decision));
    case "M10":
      return finish(generateM10(settled));
    case "M11":
      return finish(generateM11(settled));
    case "M12":
      return finish(generateM12(settled));
    default:
      return assertNever(matrixId);
  }
}

export function assertNoHallucinatedAxes(
  settled: readonly AxisNode[],
  cells: readonly RawMatrixCell[],
): void {
  const ids = new Set(settled.map((node) => node.nodeId));
  for (const cell of cells) {
    if (cell.domainNodeIds.length === 0) {
      if (!ids.has(cell.axisA)) throw new Error(`hallucinated axis ${cell.axisA} on ${cell.id}`);
      continue;
    }
    for (const id of cell.domainNodeIds) {
      if (!ids.has(id)) {
        throw new Error(`hallucinated axis ${id} on ${cell.id}`);
      }
    }
  }
}
