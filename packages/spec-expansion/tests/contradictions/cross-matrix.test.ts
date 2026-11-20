import { describe, expect, it } from "vitest";
import {
  CrossMatrixInvariantChecker,
  MATRIX_IDS,
  type MatrixCellRecord,
  type MatrixId,
} from "../../src/contradictions/index.js";

function cell(partial: MatrixCellRecord): MatrixCellRecord {
  return partial;
}

describe("cross-matrix invariants", () => {
  const checker = new CrossMatrixInvariantChecker();

  it("checks all 12 matrices and flags M01/M03, routes, traps, retention, and notification mismatches", () => {
    const cells: MatrixCellRecord[] = [
      cell({
        id: "cell-create",
        matrixId: "M01",
        axisA: "staff",
        axisB: "order:create",
        status: "filled",
        actionId: "order:create",
        allowed: true,
      }),
      cell({
        id: "cell-refund-role",
        matrixId: "M01",
        axisA: "staff",
        axisB: "order:refund",
        status: "filled",
        actionId: "order:refund",
        allowed: true,
      }),
      cell({
        id: "cell-delete-role",
        matrixId: "M01",
        axisA: "user",
        axisB: "user:delete_account",
        status: "filled",
        actionId: "user:delete_account",
        allowed: false,
      }),
      cell({
        id: "cell-create-life",
        matrixId: "M02",
        axisA: "order",
        axisB: "create",
        status: "filled",
        actionId: "order:create",
        lifecycleHandler: "create",
        entityId: "order",
      }),
      cell({
        id: "cell-user-audit",
        matrixId: "M02",
        axisA: "user",
        axisB: "audit",
        status: "filled",
        entityId: "user",
        immutableAudit: true,
        hardDelete: false,
      }),
      cell({
        id: "cell-delete-screen",
        matrixId: "M03",
        axisA: "account",
        axisB: "danger",
        status: "filled",
        screenActionId: "user:delete_account",
        text: "Delete Account",
      }),
      cell({
        id: "cell-create-route",
        matrixId: "M04",
        axisA: "POST /orders",
        axisB: "201",
        status: "filled",
        actionId: "order:create",
        routeOrCommand: "POST /orders",
      }),
      cell({ id: "cell-m05", matrixId: "M05", axisA: "name", axisB: "required", status: "filled" }),
      cell({
        id: "cell-open",
        matrixId: "M06",
        axisA: "open",
        axisB: "delivered",
        status: "filled",
        fromState: "open",
        toState: "delivered",
      }),
      cell({
        id: "cell-delivered",
        matrixId: "M06",
        axisA: "delivered",
        axisB: "terminal",
        status: "filled",
        stateId: "delivered",
        terminal: true,
      }),
      cell({
        id: "cell-locked",
        matrixId: "M06",
        axisA: "locked",
        axisB: "state",
        status: "filled",
        stateId: "locked",
        terminal: false,
      }),
      cell({ id: "cell-m07", matrixId: "M07", axisA: "stripe", axisB: "timeout", status: "filled" }),
      cell({
        id: "cell-notice-ok",
        matrixId: "M08",
        axisA: "delivered",
        axisB: "email",
        status: "filled",
        notificationTrigger: "open->delivered",
      }),
      cell({
        id: "cell-notice-bad",
        matrixId: "M08",
        axisA: "refunded",
        axisB: "email",
        status: "filled",
        notificationTrigger: "paid->refunded",
      }),
      cell({ id: "cell-m09", matrixId: "M09", axisA: "stock", axisB: "decrement", status: "filled" }),
      cell({
        id: "cell-retention",
        matrixId: "M10",
        axisA: "user",
        axisB: "gdpr",
        status: "filled",
        entityId: "user",
        retentionAction: "hard_delete",
      }),
      cell({ id: "cell-m11", matrixId: "M11", axisA: "mobile", axisB: "375", status: "filled" }),
      cell({ id: "cell-m12", matrixId: "M12", axisA: "fresh", axisB: "seed", status: "filled" }),
    ];

    const result = checker.check(cells);
    expect(result.matricesChecked).toEqual([...MATRIX_IDS]);
    const rules = new Set(result.conflicts.map((conflict) => conflict.ruleId));
    expect(rules.has("m03_forbidden_by_m01")).toBe(true);
    expect(rules.has("m01_missing_m04")).toBe(true);
    expect(rules.has("m01_missing_m02")).toBe(true);
    expect(rules.has("m06_trap_state")).toBe(true);
    expect(rules.has("m10_conflicts_m02")).toBe(true);
    expect(rules.has("m08_trigger_mismatch")).toBe(true);

    const screen = result.conflicts.find((conflict) => conflict.ruleId === "m03_forbidden_by_m01");
    expect(screen?.nodeIds).toEqual(["cell-delete-role", "cell-delete-screen"]);
    expect(screen?.plainEnglishConflict).toContain("Delete Account");
    expect(screen?.plainEnglishConflict).toContain("user:delete_account");

    const trap = result.conflicts.find((conflict) => conflict.ruleId === "m06_trap_state");
    expect(trap?.plainEnglishConflict).toContain("locked");
    const createMissing = result.conflicts.filter((conflict) => conflict.nodeIds.includes("cell-create"));
    expect(createMissing).toHaveLength(0);
    expect(result.conflicts.some((conflict) => conflict.nodeIds.includes("cell-refund-role"))).toBe(true);
  });

  it("accepts a cell from every matrix id without inventing a conflict", () => {
    const cells = MATRIX_IDS.map((matrixId: MatrixId) =>
      cell({
        id: `only-${matrixId}`,
        matrixId,
        axisA: "a",
        axisB: "b",
        status: "filled",
      }),
    );
    expect(checker.check(cells).conflicts).toEqual([]);
  });
});
