import { CanonicalStateDb } from "../../src/canvas/tabs/index.js";
import type { MatrixFillStatus, NodeDraft, RuntimeDraft } from "../../src/canvas/tabs/index.js";

const EARS = "When the cook clicks Print, the kitchen shall show a confirmation dialog.";
const ORACLE = "When the cook clicks Print, the page shows a confirmation dialog.";

export const PRINT_EARS = EARS;
export const PRINT_ORACLE = ORACLE;

export function openDb(): CanonicalStateDb {
  return new CanonicalStateDb();
}

export function seedSpec(db: CanonicalStateDb, projectKind: "ui" | "cli" = "ui"): void {
  const rules: NodeDraft[] = [];
  for (let index = 1; index <= 14; index += 1) {
    const id = `X-${String(index).padStart(2, "0")}`;
    rules.push({
      id,
      kind: "rule",
      title: `Rule ${id}`,
      text: `${id} stays in force for every matching change.`,
      fields: { rule_id: id },
    });
  }
  const screens: NodeDraft[] =
    projectKind === "cli"
      ? []
      : [
          {
            id: "screen-kitchen",
            kind: "arch_node",
            title: "Kitchen tickets",
            text: "Ticket board",
            fields: {
              role: "screen_spec",
              feature: "F-Orders",
              route: "/orders",
              states: ["empty", "loading", "populated"],
            },
          },
        ];
  db.insertNodes([
    {
      id: "system-overview",
      kind: "arch_node",
      title: "System overview",
      text: "Lunch tickets for the kitchen.",
      fields: { role: "system_overview", project_kind: projectKind },
    },
    {
      id: "F-Orders",
      kind: "feature",
      title: "Orders",
      text: "Order tickets",
      fields: { feature: "F-Orders", slug: "orders" },
    },
    {
      id: "D-Sign-in",
      kind: "decision",
      title: "Sign-in",
      text: "Email and password",
      status: "active",
      fields: {
        feature: "F-Orders",
        basis: "delegated",
        criterion_label: "Sign-in",
        chosen_value: "Email and password",
        rationale: "MVP default",
        impact_level: "high",
        downstream_task_count: 4,
      },
    },
    {
      id: "R-Explicit",
      kind: "spec_item",
      title: "Print tickets",
      text: EARS,
      fields: {
        feature: "F-Orders",
        basis: "explicit",
        turn: 2,
        touches: ["print", "ui"],
        record_type: "requirement",
      },
    },
    {
      id: "R-Derived",
      kind: "spec_item",
      title: "Derived cutoff",
      text: "The kitchen shall refuse ticket edits after the cutoff.",
      fields: { feature: "F-Orders", basis: "derived", derived_from: "D-4", record_type: "requirement" },
    },
    {
      id: "R-Delegated",
      kind: "spec_item",
      title: "Delegated retention",
      text: "The service shall keep tickets for 30 days.",
      fields: { feature: "F-Orders", basis: "delegated", record_type: "requirement" },
    },
    {
      id: "R-Proposed",
      kind: "spec_item",
      title: "Proposed empty state",
      text: "The kitchen shall show an empty state when no tickets exist.",
      fields: { feature: "F-Orders", basis: "proposed", record_type: "requirement" },
    },
    {
      id: "R-Observed",
      kind: "spec_item",
      title: "Observed printer",
      text: "The kitchen shall mark a ticket printed after the device reports success.",
      fields: { feature: "F-Orders", basis: "observed", record_type: "requirement" },
    },
    {
      id: "R-Cancel",
      kind: "spec_item",
      title: "Cancel ticket",
      text: "The kitchen shall cancel a ticket that the cook withdraws.",
      fields: { feature: "F-Orders", basis: "explicit", record_type: "requirement" },
    },
    {
      id: "C-Order",
      kind: "contract",
      title: "Order schema",
      text: "Order id and status",
      fields: { feature: "F-Orders" },
    },
    {
      id: "S-03",
      kind: "arch_node",
      title: "Print handoff",
      text: "Kitchen printer seam",
      fields: { role: "seam", feature: "F-Orders", seam_id: "S-03" },
    },
    {
      id: "RF-Paper",
      kind: "research_fact",
      title: "Paper stock",
      text: "Tickets print on 80mm stock.",
      fields: { feature: "F-Orders" },
    },
    ...screens,
    ...rules,
  ]);
}

export function seedCli(db: CanonicalStateDb): void {
  seedSpec(db, "cli");
  db.insertNodes([
    {
      id: "CLI-Export",
      kind: "spec_item",
      title: "orders export",
      text: "orders export writes a CSV and exits 0.",
      fields: { feature: "F-Orders", basis: "explicit", record_type: "cli_command" },
    },
    {
      id: "EXIT-2",
      kind: "spec_item",
      title: "Exit 2",
      text: "A missing menu file exits 2.",
      fields: { feature: "F-Orders", basis: "explicit", record_type: "exit_code" },
    },
  ]);
}

export function seedConflict(db: CanonicalStateDb): void {
  db.insertInbox({
    id: "conflict-1",
    kind: "conflict",
    subject: "Cutoff vs print",
    priority: 1,
    payload: {
      summary: "Cutoff disagrees with the print rule",
      cell_ids: ["cell:M04:anon:401"],
      decision_ids: ["D-4"],
    },
  });
}

export function seedProposals(db: CanonicalStateDb): void {
  db.insertNodes([
    { id: "F-Orders", kind: "feature", title: "Orders", fields: { feature: "F-Orders" } },
    { id: "F-Billing", kind: "feature", title: "Billing", fields: { feature: "F-Billing" } },
    proposal("P-1", "F-Orders", "M04", "Unauthenticated print"),
    proposal("P-2", "F-Orders", "M03", "Empty ticket board"),
    proposal("P-3", "F-Billing", "M04", "Invoice status"),
  ]);
}

function proposal(id: string, featureId: string, matrixId: string, title: string): NodeDraft {
  return {
    id,
    kind: "spec_item",
    title,
    text: EARS,
    status: "draft",
    fields: {
      feature: featureId,
      basis: "proposed",
      risk: "medium",
      review_status: "proposed",
      matrix_id: matrixId,
      record_type: "requirement",
      ears_text: EARS,
      oracle_sketch: ORACLE,
    },
  };
}

const FILLS: readonly MatrixFillStatus[] = ["pass1", "pass2", "pass3", "proposed", "conflict", "na"];

export function seedMatrices(db: CanonicalStateDb, rawCells: number): void {
  const drafts: NodeDraft[] = [];
  for (let index = 1; index <= 12; index += 1) {
    const matrixId = `M${String(index).padStart(2, "0")}`;
    if (matrixId === "M04") {
      for (let rule = 0; rule < 14; rule += 1) {
        drafts.push(
          matrixNode(`rule-M04-${rule}`, "universal_rule", matrixId, FILLS[rule % FILLS.length] ?? "pass1", rule === 0
            ? "ALL unauthenticated private API calls → 401"
            : `Universal rule ${rule}`),
        );
      }
      for (let exception = 0; exception < 28; exception += 1) {
        drafts.push(
          matrixNode(
            `exc-M04-${exception}`,
            "matrix_exception",
            matrixId,
            FILLS[exception % FILLS.length] ?? "na",
            `Exception ${exception}`,
          ),
        );
      }
    } else {
      drafts.push(matrixNode(`rule-${matrixId}`, "universal_rule", matrixId, "pass1", `${matrixId} universal rule`));
    }
  }
  for (let index = 0; index < rawCells; index += 1) {
    drafts.push({
      id: `raw-M04-${index}`,
      kind: "spec_item",
      title: `Raw ${index}`,
      text: `raw ${index}`,
      fields: {
        record_type: "matrix_cell",
        matrix_id: "M04",
        status: "pass1",
        axis_a: `axis-${index % 25}`,
        axis_b: `status-${index % 60}`,
      },
    });
  }
  db.insertNodes(drafts);
}

function matrixNode(
  id: string,
  recordType: "universal_rule" | "matrix_exception",
  matrixId: string,
  status: MatrixFillStatus,
  text: string,
): NodeDraft {
  return {
    id,
    kind: "spec_item",
    title: text,
    text,
    fields: { record_type: recordType, matrix_id: matrixId, status },
  };
}

export function seedPlan(db: CanonicalStateDb): void {
  const tasks: NodeDraft[] = [];
  const levels = [
    { balanced: "Junior", floor: "Junior", critical: false, cost: 1_000_000, minutes: 10 },
    { balanced: "Mid", floor: "Junior", critical: false, cost: 1_000_000, minutes: 10 },
    { balanced: "Senior", floor: "Mid", critical: false, cost: 1_000_000, minutes: 12 },
    { balanced: "Mid", floor: "Junior", critical: true, cost: 1_000_000, minutes: 10 },
  ] as const;
  for (let index = 0; index < 8; index += 1) {
    const level = levels[index] ?? levels[1];
    const id = `P0-${index + 1}`;
    tasks.push({
      id,
      kind: "task",
      title: `Phase step ${index + 1}`,
      fields: {
        feature: "F-Orders",
        band: "phase0",
        step: `P0.${index + 1}`,
        balanced_level: level.balanced,
        safety_floor: level.floor,
        critical_path: level.critical,
        junior_cost_micro_usd: level.cost,
        duration_minutes: level.minutes,
      },
    });
  }
  for (let index = 0; index < 80; index += 1) {
    tasks.push({
      id: `W1-${index}`,
      kind: "task",
      title: `Wave task ${index}`,
      fields: {
        feature: "F-Orders",
        band: "wave1",
        balanced_level: "Mid",
        safety_floor: "Junior",
        critical_path: index === 0,
        junior_cost_micro_usd: 100_000,
        duration_minutes: 8,
      },
    });
  }
  db.insertNodes([
    { id: "F-Orders", kind: "feature", title: "Orders", fields: { feature: "F-Orders", slug: "orders" } },
    {
      id: "F-Catering",
      kind: "feature",
      title: "Admin & Catering Email",
      fields: {
        feature: "F-Catering",
        band: "projected",
        wave: 2,
        task_min: 6,
        task_max: 9,
        cost_min_micro: 600_000,
        cost_max_micro: 1_100_000,
      },
    },
    {
      id: "F-Completion",
      kind: "feature",
      title: "Completion",
      fields: {
        feature: "F-Completion",
        band: "projected",
        wave: 3,
        task_min: 2,
        task_max: 4,
        cost_min_micro: 200_000,
        cost_max_micro: 500_000,
      },
    },
    {
      id: "D-Magic",
      kind: "decision",
      title: "Sign-in",
      text: "Email and password",
      fields: {
        basis: "delegated",
        criterion_label: "Sign-in",
        chosen_value: "Email and password",
      },
    },
    {
      id: "D-Sms",
      kind: "decision",
      title: "SMS receipts",
      text: "Deferred until email is stable",
      fields: {
        basis: "delegated",
        deferred: true,
        criterion_label: "SMS receipts",
        deferred_reason: "Email covers the first release",
        revisit_wave: "Wave 3",
      },
    },
    ...tasks,
  ]);
  for (const task of tasks) {
    db.insertTaskRuntime({ taskId: task.id, featureId: "F-Orders", state: "DRAFTED", level: "Mid" });
    db.insertScopes(task.id, ["src/orders/**"]);
  }
}

export function seedRuntime(db: CanonicalStateDb, count: number): void {
  const lanes = ["READY", "CODING", "CLEAN_VERIFY", "ACCEPTED", "MERGED_TO_FEATURE"] as const;
  const rows: RuntimeDraft[] = [];
  for (let index = 0; index < count; index += 1) {
    const orders = index < 20;
    rows.push({
      id: `T-${String(index).padStart(3, "0")}`,
      title: orders ? `Print ticket ${index}` : `Billing task ${index}`,
      featureId: orders ? "F-Orders" : `F-Feature-${Math.floor(index / 20)}`,
      featureTitle: orders ? "Orders" : `Feature ${Math.floor(index / 20)}`,
      wave: orders ? 1 : 2,
      lane: index === 0 ? "CODING" : (lanes[index % lanes.length] ?? "READY"),
      tier: index === 1 ? "Mid" : "Junior",
      model: index === 0 ? "gpt-test" : "small-test",
      agentId: `agent-${String(index).padStart(3, "0")}`,
      retries: index === 0 ? 2 : 0,
      elapsedMs: index === 0 ? 90_000 : 1_500,
      costMicroUsd: index === count - 1 ? 1_000 : (count - index) * 100_000,
      windowUnits: index === 0 ? 40_000 : 0,
      mergeSha: index === 0 ? "abc1234" : "",
    });
  }
  db.insertRuntimeRows(rows);
}

export function bestElapsed(sample: () => number, runs = 5): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < runs; index += 1) {
    const elapsed = sample();
    if (elapsed < best) best = elapsed;
  }
  return best;
}
