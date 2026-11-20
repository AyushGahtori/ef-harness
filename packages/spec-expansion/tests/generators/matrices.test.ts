import { describe, expect, it } from "vitest";

import {
  type ApplicabilityDecision,
  backendApiGraph,
  cellIdentityJcs,
  cellKey,
  endpointStatusAxis,
  entityActionAxis,
  type GenerationRun,
  headlessCliGraph,
  jcs,
  kitchenMealOrderingGraph,
  LocalKnowledgeGraphPort,
  LocalReadinessCalculator,
  M04_STATUSES,
  M07_FAILURES,
  M08_AXES,
  M09_RACES,
  M11_AXES,
  MATRIX_IDS,
  type MatrixId,
  MatrixGeneratorRegistry,
  readyReadiness,
  type RawMatrixCell,
  ScopedRuleCollapser,
  screenStateAxis,
  TOUCHES_TAGS,
  withProposedRole,
} from "../../src/generators/index.js";

const registry = new MatrixGeneratorRegistry();
const collapser = new ScopedRuleCollapser();

function cellMap(run: GenerationRun): Map<string, RawMatrixCell> {
  return new Map(run.rawCells.map((cell) => [cell.id, cell]));
}

function cellsFor(run: GenerationRun, matrixId: MatrixId): RawMatrixCell[] {
  return run.rawCells.filter((cell) => cell.matrixId === matrixId);
}

function decision(run: GenerationRun, matrixId: MatrixId): ApplicabilityDecision {
  const found = run.applicability.find((item) => item.matrixId === matrixId);
  if (!found) throw new Error(`missing ${matrixId}`);
  return found;
}

function expectOutcome(
  run: GenerationRun,
  matrixId: MatrixId,
  axisA: string,
  axisB: string,
  outcome: string,
  reason: string | null = null,
): void {
  const cell = cellMap(run).get(cellKey(matrixId, axisA, axisB));
  expect(cell, `${matrixId} ${axisA} ${axisB}`).toBeDefined();
  expect(cell?.outcome).toBe(outcome);
  expect(cell?.reason).toBe(reason);
}

function expectAbsent(run: GenerationRun, matrixId: MatrixId, axisA: string, axisB: string): void {
  expect(cellMap(run).has(cellKey(matrixId, axisA, axisB))).toBe(false);
}

function assertLossless(run: GenerationRun): void {
  const collapsed = collapser.collapse(run);
  const expanded = collapser.expand(collapsed, run.rawCells);
  expect(expanded.size).toBe(run.rawCells.length);
  for (const cell of run.rawCells) {
    expect(expanded.get(cell.id)).toBe(cell.signature);
  }
}

function assertGrounded(run: GenerationRun, nodeIds: ReadonlySet<string>): void {
  for (const cell of run.rawCells) {
    for (const id of cell.domainNodeIds) {
      expect(nodeIds.has(id), id).toBe(true);
    }
  }
}

describe("matrix generators", () => {
  it("canonicalizes cell keys with RFC 8785", () => {
    const key = cellKey("M01", "role.staff", "ea/entity.order/read");
    expect(key).toBe("cell:M01:role.staff:ea/entity.order/read");
    const identity = cellIdentityJcs("M01", "role.staff", "ea/entity.order/read");
    expect(identity).toBe(jcs({ a: "role.staff", b: "ea/entity.order/read", m: "M01" }));
    expect(identity.startsWith('{"a":')).toBe(true);
    const composed = "e\u0301";
    expect(cellKey("M06", composed, "state.draft")).toBe(cellKey("M06", composed.normalize("NFC"), "state.draft"));
  });

  it("rejects touches tags outside the closed registry", () => {
    const graph = kitchenMealOrderingGraph();
    expect(() =>
      registry.generate({
        ...graph,
        touches: ["payments_stripe" as never],
      }),
    ).toThrow(/closed 28-tag/);
    expect(TOUCHES_TAGS).toHaveLength(28);
  });

  it("keeps proposed roles off every axis and records readiness", () => {
    const clean = registry.generate(kitchenMealOrderingGraph());
    const polluted = registry.generate(withProposedRole(kitchenMealOrderingGraph()));
    expect(polluted.rawCells.map((cell) => cell.id)).toEqual(clean.rawCells.map((cell) => cell.id));
    expect(polluted.llmCalls).toBe(0);
    expect(clean.readinessReady).toBe(true);
    const blocked = registry.generate({
      ...kitchenMealOrderingGraph(),
      readiness: { ...readyReadiness(), openMustAsk: 1 },
    });
    expect(blocked.readinessReady).toBe(false);
    expect(blocked.rawCells).toHaveLength(clean.rawCells.length);
    expect(new LocalReadinessCalculator().calculate(readyReadiness()).isReadyToPlan).toBe(true);
    const port = new LocalKnowledgeGraphPort(withProposedRole(kitchenMealOrderingGraph()));
    expect(port.getNode("role.proposed")).toBeNull();
    expect(port.getNode("role.invented")).toBeNull();
    expect(port.getNode("role.staff")?.id).toBe("role.staff");
  });

  it("generates the kitchen web app with all 12 matrices and no missed edges", () => {
    const graph = kitchenMealOrderingGraph();
    const first = JSON.stringify(registry.generate(graph));
    const run = registry.generate(graph);
    expect(JSON.stringify(run)).toBe(first);
    expect(run.llmCalls).toBe(0);
    expect(run.applicability.map((item) => item.matrixId)).toEqual([...MATRIX_IDS]);
    for (const matrixId of MATRIX_IDS) {
      expect(decision(run, matrixId).active, matrixId).toBe(true);
    }
    const ids = new Set(graph.nodes.map((node) => node.nodeId));
    assertGrounded(run, ids);
    assertLossless(run);

    expectOutcome(run, "M01", "role.anonymous", entityActionAxis("entity.profile", "update"), "not_applicable", "anonymous_cannot_edit_own_profile");
    expectOutcome(run, "M01", "role.staff", entityActionAxis("entity.audit", "update"), "not_applicable", "immutable_audit_no_update");
    expectOutcome(run, "M01", "role.admin", entityActionAxis("entity.audit", "update"), "not_applicable", "immutable_audit_no_update");
    expectOutcome(run, "M01", "role.anonymous", entityActionAxis("entity.order", "read"), "deny_unauthenticated");
    expectOutcome(run, "M01", "role.staff", entityActionAxis("entity.order", "read"), "allow");
    expectOutcome(run, "M01", "role.staff", entityActionAxis("entity.order", "admin"), "deny_requires_admin");
    expectOutcome(run, "M01", "role.admin", entityActionAxis("entity.order", "delete"), "allow");
    expect(cellsFor(run, "M01")).toHaveLength(3 * 4 * 5 + 3 * 4 * 3);

    expectOutcome(run, "M03", "role.staff", screenStateAxis("screen.kitchen_list", "print"), "open_ui_state");
    expectOutcome(run, "M03", "role.staff", screenStateAxis("screen.kitchen_list", "empty"), "open_ui_state");
    expectOutcome(run, "M03", "role.anonymous", screenStateAxis("screen.order_form", "offline_slow"), "open_ui_state");
    expectAbsent(run, "M03", "role.staff", screenStateAxis("screen.order_form", "print"));

    expectOutcome(run, "M04", "role.anonymous", endpointStatusAxis("endpoint.orders_get", "401"), "return_401");
    expectOutcome(run, "M04", "role.anonymous", endpointStatusAxis("endpoint.orders_get", "403"), "not_applicable", "unauthenticated_private_is_401_not_403");
    expectOutcome(run, "M04", "role.anonymous", endpointStatusAxis("endpoint.orders_get", "404"), "not_applicable", "unauthenticated_private_is_401_not_404");
    expectOutcome(run, "M04", "role.staff", endpointStatusAxis("endpoint.orders_get", "401"), "not_applicable", "authenticated_is_not_401");
    expectOutcome(run, "M04", "role.staff", endpointStatusAxis("endpoint.orders_get", "403"), "403_forbidden");
    expectOutcome(run, "M04", "role.staff", endpointStatusAxis("endpoint.orders_get", "404"), "404_cross_tenant_idor");
    expectOutcome(run, "M04", "role.anonymous", endpointStatusAxis("endpoint.menu_list", "401"), "not_applicable", "public_endpoint_not_401");
    expectOutcome(run, "M04", "role.anonymous", endpointStatusAxis("endpoint.menu_list", "200/201"), "public_success");
    expect(cellsFor(run, "M04")).toHaveLength(3 * 3 * M04_STATUSES.length);

    expectOutcome(run, "M06", "state.draft", "state.submitted", "valid_transition");
    expectOutcome(run, "M06", "state.locked", "state.submitted", "409_INVALID_TRANSITION");
    expectOutcome(run, "M06", "state.submitted", "state.submitted", "409_INVALID_TRANSITION");
    expectOutcome(run, "M06", "state.delivered", "state.draft", "not_applicable", "terminal_no_outgoing");
    expectOutcome(run, "M06", "state.cancelled", "state.locked", "not_applicable", "terminal_no_outgoing");
    expectOutcome(run, "M06", "state.draft", "cutoff_expired", "cutoff_expired");
    expectOutcome(run, "M06", "state.locked", "cutoff_expired", "cutoff_expired");
    expectAbsent(run, "M06", "state.delivered", "cutoff_expired");
    expectAbsent(run, "M06", "state.cancelled", "cutoff_expired");

    expectOutcome(run, "M08", "notification.order_submitted", "channel", "channel:email");
    expectOutcome(run, "M08", "notification.order_submitted", "trigger_event", "trigger:order_submitted");
    expectOutcome(run, "M08", "notification.order_submitted", "unsubscribe_mute", "unsubscribe:honor");
    expectOutcome(run, "M08", "notification.order_locked", "channel", "no_notification");
    for (const axis of M08_AXES) {
      expect(cellMap(run).has(cellKey("M08", "notification.order_submitted", axis))).toBe(true);
      expect(cellMap(run).has(cellKey("M08", "notification.order_locked", axis))).toBe(true);
    }

    expectOutcome(run, "M09", "entity.order", "concurrent_cutoff_boundary", "cutoff_boundary_reject");
    expectOutcome(run, "M09", "entity.order", "double_click_submit", "conflict_409");
    expectOutcome(run, "M09", "entity.dish", "concurrent_stock_quota_decrement", "conflict_409");
    for (const race of M09_RACES) {
      expect(cellMap(run).has(cellKey("M09", "entity.order", race))).toBe(true);
    }

    expectOutcome(run, "M11", "screen.kitchen_list", "mobile_375", "open_viewport");
    expectOutcome(run, "M11", "screen.order_form", "keyboard_only", "open_viewport");
    expect(cellsFor(run, "M11")).toHaveLength(2 * M11_AXES.length);

    for (const failure of M07_FAILURES) {
      expectOutcome(run, "M07", "integration.delivery_webhook", failure, "open_failure");
    }

    expectOutcome(run, "M05", "field.order_quantity", "required_optional", "required");
    expectOutcome(run, "M05", "field.order_quantity", "min_max", "bounded");
    expectOutcome(run, "M05", "field.order_quantity", "unicode_emoji", "accept_unicode");
    expectOutcome(run, "M05", "field.order_note", "required_optional", "optional");
    expectOutcome(run, "M05", "field.order_note", "cross_field", "not_applicable", "no_cross_field_rule");

    expectOutcome(run, "M02", "entity.audit", "update", "not_applicable", "immutable_audit_no_mutation");
    expectOutcome(run, "M02", "entity.order", "soft_delete", "open_lifecycle");
    expectOutcome(run, "M10", "entity.profile", "pii_classification", "personal_data");
    expectOutcome(run, "M10", "entity.audit", "user_deletion_anonymization", "not_applicable", "audit_not_user_deletable");
    expectOutcome(run, "M12", "entity.order", "fresh_install_seed", "open_migration");

    const collapsed = collapser.collapse(run);
    expect(collapsed.rules.some((rule) => rule.text === "ALL unauthenticated requests to /api/private/* return 401")).toBe(true);
    expect(collapsed.rules.some((rule) => rule.text === "ALL invalid state transitions return 409 INVALID_TRANSITION")).toBe(true);
    expect(
      collapsed.rules.some(
        (rule) => rule.text === "No outgoing transitions permitted from terminal states {delivered, cancelled}",
      ),
    ).toBe(true);
  });

  it("generates the backend API and skips screen matrices", () => {
    const graph = backendApiGraph();
    const run = registry.generate(graph);
    expect(JSON.stringify(registry.generate(graph))).toBe(JSON.stringify(run));
    expect(decision(run, "M03")).toMatchObject({ active: false, skippedReason: "no_screens" });
    expect(decision(run, "M11")).toMatchObject({ active: false, skippedReason: "no_screens" });
    for (const matrixId of ["M01", "M02", "M04", "M05", "M06", "M07", "M08", "M09", "M10", "M12"] as const) {
      expect(decision(run, matrixId).active, matrixId).toBe(true);
      expect(cellsFor(run, matrixId).length).toBeGreaterThan(0);
    }
    expect(cellsFor(run, "M03")).toHaveLength(0);
    expect(cellsFor(run, "M11")).toHaveLength(0);
    expectOutcome(run, "M04", "role.anonymous", endpointStatusAxis("endpoint.items_get", "401"), "return_401");
    expectOutcome(run, "M04", "role.staff", endpointStatusAxis("endpoint.items_get", "404"), "404_cross_tenant_idor");
    expectOutcome(run, "M06", "state.active", "state.retired", "valid_transition");
    expectOutcome(run, "M06", "state.retired", "state.active", "not_applicable", "terminal_no_outgoing");
    expectOutcome(run, "M06", "state.active", "cutoff_expired", "cutoff_expired");
    assertGrounded(run, new Set(graph.nodes.map((node) => node.nodeId)));
    assertLossless(run);
    const collapsed = collapser.collapse(run);
    expect(
      collapsed.rules.some(
        (rule) => rule.text === "No outgoing transitions permitted from terminal states {retired}",
      ),
    ).toBe(true);
  });

  it("narrows a single-user headless CLI and lists every remaining cell", () => {
    const graph = headlessCliGraph();
    const run = registry.generate(graph);
    expect(decision(run, "M01")).toMatchObject({ active: false, skippedReason: "single_user_no_role_matrix" });
    expect(decision(run, "M03")).toMatchObject({ active: false, skippedReason: "headless_no_ui" });
    expect(decision(run, "M04")).toMatchObject({ active: false, skippedReason: "no_endpoints" });
    expect(decision(run, "M05")).toMatchObject({ active: false, skippedReason: "no_form_fields" });
    expect(decision(run, "M06")).toMatchObject({ active: false, skippedReason: "no_state_machines" });
    expect(decision(run, "M07")).toMatchObject({ active: false, skippedReason: "no_external_integrations" });
    expect(decision(run, "M08")).toMatchObject({ active: false, skippedReason: "no_notifications" });
    expect(decision(run, "M10")).toMatchObject({ active: false, skippedReason: "no_retention_scope" });
    expect(decision(run, "M11")).toMatchObject({ active: false, skippedReason: "headless_no_viewport" });
    expect(decision(run, "M09")).toMatchObject({ active: true, narrowed: "single_process_file_lock" });
    expect(decision(run, "M02").active).toBe(true);
    expect(decision(run, "M12").active).toBe(true);

    const expected = [
      ...["create", "read_single", "list_filter", "update", "soft_delete", "hard_delete", "restore", "archive", "ownership_transfer"].map(
        (op) => `M02|entity.note|${op}|open_lifecycle|`,
      ),
      "M09|entity.note|single_process_file_lock|file_lock_exclusive|",
      ...[
        "fresh_install_seed",
        "schema_upgrade_n_minus_1",
        "rollback_safety",
        "partial_backfill_resume",
        "zero_downtime_compatibility",
      ].map((axis) => `M12|entity.note|${axis}|open_migration|`),
    ].sort();
    const actual = run.rawCells
      .map((cell) => `${cell.matrixId}|${cell.axisA}|${cell.axisB}|${cell.outcome}|${cell.reason ?? ""}`)
      .sort();
    expect(actual).toEqual(expected);
    expect(run.rawCells.some((cell) => cell.axisB === "double_click_submit")).toBe(false);
    expect(run.rawCells.some((cell) => cell.matrixId === "M03" || cell.matrixId === "M11")).toBe(false);
    assertLossless(run);
  });

  it("yields zero external-integration cells when none are settled", () => {
    const graph = kitchenMealOrderingGraph();
    const stripped = {
      ...graph,
      nodes: graph.nodes.filter((node) => node.kind !== "integration"),
      touches: graph.touches.filter((tag) => tag !== "external_api" && tag !== "inbound_webhook"),
    };
    const run = registry.generate(stripped);
    expect(decision(run, "M07")).toMatchObject({
      active: false,
      skippedReason: "no_external_integrations",
    });
    expect(cellsFor(run, "M07")).toHaveLength(0);
  });
});
