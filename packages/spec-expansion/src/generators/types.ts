import { type ReadinessCounts } from "./readiness-port.js";
import { assertTouchesTags, type TouchesTag } from "./touches.js";

export const MATRIX_IDS = [
  "M01",
  "M02",
  "M03",
  "M04",
  "M05",
  "M06",
  "M07",
  "M08",
  "M09",
  "M10",
  "M11",
  "M12",
] as const;

export type MatrixId = (typeof MATRIX_IDS)[number];

export const MATRIX_CATALOG: readonly { readonly id: MatrixId; readonly title: string }[] = [
  { id: "M01", title: "Role × Action Permissions Matrix" },
  { id: "M02", title: "Entity × CRUD & Lifecycle Matrix" },
  { id: "M03", title: "Screen × UI State Matrix" },
  { id: "M04", title: "API Endpoint × Status & Error Matrix" },
  { id: "M05", title: "Form Field × Validation & Boundary Matrix" },
  { id: "M06", title: "State Machine × Transition Matrix" },
  { id: "M07", title: "External Integration × Failure Matrix" },
  { id: "M08", title: "Notification × Trigger, Channel & Opt-Out Matrix" },
  { id: "M09", title: "Concurrency & Race × Shared Resource Matrix" },
  { id: "M10", title: "Data Retention, Privacy & Export Matrix" },
  { id: "M11", title: "Viewport / Device / Accessibility Matrix" },
  { id: "M12", title: "Migration, Seed & Upgrade Matrix" },
];

export const M01_ACTIONS = ["create", "read", "update", "delete", "admin"] as const;
export type M01Action = (typeof M01_ACTIONS)[number];

export const M02_OPS = [
  "create",
  "read_single",
  "list_filter",
  "update",
  "soft_delete",
  "hard_delete",
  "restore",
  "archive",
  "ownership_transfer",
] as const;
export type M02Op = (typeof M02_OPS)[number];

export const M03_UI_STATES = [
  "empty",
  "loading",
  "populated",
  "error",
  "validation_error",
  "unauthorized",
  "offline_slow",
] as const;
export const M03_PRINT_STATE = "print" as const;

export const M04_STATUSES = [
  "200/201",
  "400",
  "401",
  "403",
  "404",
  "409",
  "422",
  "429",
  "500",
] as const;
export type M04Status = (typeof M04_STATUSES)[number];

export const M05_CHECKS = [
  "required_optional",
  "min_max",
  "format",
  "unicode_emoji",
  "whitespace_trim",
  "duplicate_uniqueness",
  "cross_field",
] as const;
export type M05Check = (typeof M05_CHECKS)[number];

export const M07_FAILURES = [
  "timeout",
  "429_backoff",
  "5xx_outage",
  "malformed_response",
  "duplicate_webhook_replay",
  "invalid_signature",
  "partial_failure",
] as const;
export type M07Failure = (typeof M07_FAILURES)[number];

export const M08_AXES = [
  "trigger_event",
  "recipient_rule",
  "channel",
  "dedup_idempotency",
  "bounce_failure",
  "unsubscribe_mute",
] as const;
export type M08Axis = (typeof M08_AXES)[number];

export const M09_RACES = [
  "double_click_submit",
  "simultaneous_edit_lost_update",
  "concurrent_stock_quota_decrement",
  "concurrent_cutoff_boundary",
] as const;
export type M09Race = (typeof M09_RACES)[number];
export const M09_FILE_LOCK = "single_process_file_lock" as const;

export const M10_AXES = [
  "pii_classification",
  "retention_window",
  "user_deletion_anonymization",
  "audit_log_retention",
  "export_redaction",
] as const;
export type M10Axis = (typeof M10_AXES)[number];

export const M11_AXES = [
  "mobile_375",
  "tablet_768",
  "desktop_1440",
  "keyboard_only",
  "reduced_motion",
  "contrast_screen_reader",
] as const;
export type M11Axis = (typeof M11_AXES)[number];

export const M12_AXES = [
  "fresh_install_seed",
  "schema_upgrade_n_minus_1",
  "rollback_safety",
  "partial_backfill_resume",
  "zero_downtime_compatibility",
] as const;
export type M12Axis = (typeof M12_AXES)[number];

export const SETTLED_BASES = [
  "explicit",
  "derived",
  "delegated",
  "defaulted",
  "observed",
] as const;
export type SettledBasis = (typeof SETTLED_BASES)[number];

const SETTLED_BASIS_SET: ReadonlySet<string> = new Set(SETTLED_BASES);

export type AxisKind =
  | "entity"
  | "role"
  | "screen"
  | "endpoint"
  | "integration"
  | "state"
  | "field"
  | "notification"
  | "feature"
  | "decision";

export type AttrValue = string | number | boolean;

export interface AxisNode {
  readonly nodeId: string;
  readonly kind: AxisKind;
  readonly title: string;
  readonly touches: readonly TouchesTag[];
  readonly featureId: string;
  readonly attrs: Readonly<Record<string, AttrValue>>;
}

export type ProjectProfile = "web_saas" | "backend_api" | "headless_cli";

export interface StateTransition {
  readonly nodeId: string;
  readonly fromStateId: string;
  readonly toStateId: string;
  readonly kind: "valid" | "invalid" | "reverse" | "duplicate" | "cutoff_expired";
}

export interface SettledProjectGraph {
  readonly projectId: string;
  readonly profile: ProjectProfile;
  readonly touches: readonly TouchesTag[];
  readonly nodes: readonly AxisNode[];
  readonly transitions: readonly StateTransition[];
  readonly readiness: ReadinessCounts;
}

export function attrFlag(node: AxisNode, key: string): boolean {
  return node.attrs[key] === true;
}

export function attrString(node: AxisNode, key: string): string | null {
  const value = node.attrs[key];
  return typeof value === "string" ? value : null;
}

export function isSettledBasis(node: AxisNode): boolean {
  const basis = attrString(node, "basis");
  if (basis === null) return true;
  return SETTLED_BASIS_SET.has(basis);
}

export function assertKnownGraph(graph: SettledProjectGraph): void {
  assertTouchesTags(graph.touches, graph.projectId);
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (ids.has(node.nodeId)) {
      throw new Error(`duplicate node id ${node.nodeId}`);
    }
    ids.add(node.nodeId);
    assertTouchesTags(node.touches, node.nodeId);
  }
  const featureIds = new Set(
    graph.nodes.filter((node) => node.kind === "feature").map((node) => node.nodeId),
  );
  for (const node of graph.nodes) {
    if (node.kind === "feature") continue;
    if (!featureIds.has(node.featureId)) {
      throw new Error(`${node.nodeId} feature ${node.featureId} is not a settled feature node`);
    }
  }
  for (const transition of graph.transitions) {
    if (!ids.has(transition.nodeId)) {
      throw new Error(`transition ${transition.nodeId} is not a settled node`);
    }
    if (!ids.has(transition.fromStateId) || !ids.has(transition.toStateId)) {
      throw new Error(`transition ${transition.nodeId} cites a state that is not settled`);
    }
  }
}

export type PermissionClass = "unauthenticated" | "admin" | "authenticated";
export type HttpActorClass = "unauthenticated" | "authenticated";
export type EntityClass = "immutable_audit" | "profile" | "pii" | "normal";

export function permissionClass(node: AxisNode): PermissionClass {
  if (attrFlag(node, "unauthenticated") || attrFlag(node, "anonymous")) return "unauthenticated";
  if (attrFlag(node, "admin")) return "admin";
  return "authenticated";
}

export function httpActorClass(node: AxisNode): HttpActorClass {
  return permissionClass(node) === "unauthenticated" ? "unauthenticated" : "authenticated";
}

export function entityClass(node: AxisNode): EntityClass {
  if (attrFlag(node, "immutable") && attrFlag(node, "auditLog")) return "immutable_audit";
  if (attrFlag(node, "profile")) return "profile";
  if (attrFlag(node, "pii")) return "pii";
  return "normal";
}

export function entityActionAxis(entityId: string, action: string): string {
  return `ea/${entityId}/${action}`;
}

export function entityEndpointAxis(entityId: string, endpointId: string): string {
  return `ep/${entityId}/${endpointId}`;
}

export function endpointStatusAxis(endpointId: string, status: string): string {
  return `st/${endpointId}/${status}`;
}

export function screenStateAxis(screenId: string, uiState: string): string {
  return `ui/${screenId}/${uiState}`;
}

export interface CellDraft {
  readonly matrixId: MatrixId;
  readonly axisA: string;
  readonly axisB: string;
  readonly domainNodeIds: readonly string[];
  readonly outcome: string;
  readonly reason: string | null;
  readonly notApplicable: boolean;
  readonly scopeKey: string;
  readonly forceException: boolean;
  readonly ruleText: string | null;
}

export interface RawMatrixCell extends CellDraft {
  readonly id: string;
  readonly signature: string;
}

export function signatureOf(outcome: string, reason: string | null): string {
  return `${outcome}|${reason ?? ""}`;
}

export function sealCell(draft: CellDraft): RawMatrixCell {
  const cell = draft as CellDraft & { id: string; signature: string };
  cell.id = `cell:${draft.matrixId}:${draft.axisA}:${draft.axisB}`;
  cell.signature = draft.reason === null ? `${draft.outcome}|` : `${draft.outcome}|${draft.reason}`;
  return cell;
}

export interface ApplicabilityDecision {
  readonly matrixId: MatrixId;
  readonly active: boolean;
  readonly skippedReason: string | null;
  readonly narrowed: string | null;
}

export interface MatrixSlice {
  readonly matrixId: MatrixId;
  readonly applicability: ApplicabilityDecision;
  readonly cells: readonly RawMatrixCell[];
}

export interface GenerationRun {
  readonly llmCalls: 0;
  readonly readinessReady: boolean;
  readonly applicability: readonly ApplicabilityDecision[];
  readonly matrices: readonly MatrixSlice[];
  readonly rawCells: readonly RawMatrixCell[];
  readonly domains: ReadonlyMap<string, readonly string[]>;
}

export function assertNever(value: never): never {
  throw new Error(`unhandled variant: ${String(value)}`);
}
