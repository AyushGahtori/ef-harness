import { describe, expect, it } from "vitest";
import {
  CONTRADICTION_EDGE_TYPE,
  FiveLayerContradictionEngine,
  InMemoryContradictionStore,
  Z3UnsatCoreSolver,
  type ArchitecturalConstraint,
  type CatalogRuleEntry,
  type ContradictionCheckModel,
  type ContradictionWarning,
  type MaterializedRequirement,
  type MatrixCellRecord,
} from "../../src/contradictions/index.js";

const RULES: CatalogRuleEntry[] = [
  { id: "rule-sqlite", optionId: "sqlite", groupId: "storage", conflictsWith: ["multi_writer"], requires: [] },
  { id: "rule-multi", optionId: "multi_writer", groupId: "jobs", conflictsWith: ["sqlite"], requires: [] },
  { id: "rule-local", optionId: "local_disk", groupId: "disk", conflictsWith: ["object_store"], requires: [] },
  { id: "rule-object", optionId: "object_store", groupId: "disk", conflictsWith: ["local_disk"], requires: [] },
];

const CHAIN: ArchitecturalConstraint[] = [
  { kind: "assert", nodeId: "A", value: true },
  { kind: "implies", from: "A", to: "B" },
  { kind: "implies", from: "B", to: "C" },
  { kind: "assert", nodeId: "C", value: false },
];

function addNode(
  store: InMemoryContradictionStore,
  id: string,
  kind: string,
  title: string,
  text: string,
  fields: unknown,
): void {
  store.commitChangeSet({
    origin: "kernel",
    author: "test",
    summary: id,
    nodes: [{ op: "create", id, kind, title, text, fields, status: "active" }],
  });
}

function decision(store: InMemoryContradictionStore, id: string, optionId: string, groupId: string): void {
  addNode(store, id, "decision", id, id, { basis: "explicit", selectedOptionId: optionId, groupId });
}

function groundedModel(): ContradictionCheckModel {
  return {
    checkBatch(pairs) {
      return pairs.map((pair) => ({
        verdict: "conflict",
        explanation: "The two requirements cannot both hold for one order.",
        minimal_change_suggestion: "Keep one requirement.",
        cited_node_ids: [pair.leftId, pair.rightId],
        counterexample: 'When order "1001" is submitted, one requirement prints a ticket and the other forbids it.',
      }));
    },
  };
}

function requirements(): MaterializedRequirement[] {
  return [
    {
      id: "req-print",
      text: "The kitchen shall print a ticket.",
      earsText: "When an order is submitted, the system shall print a ticket.",
      entities: ["order"],
      touches: ["printing"],
      featureId: "kitchen",
      pass: 1,
      basis: "derived",
      status: "active",
      quote: "print a ticket",
    },
    {
      id: "req-silent",
      text: "The kitchen shall not print a ticket.",
      earsText: "When an order is submitted, the system shall not print a ticket.",
      entities: ["order"],
      touches: ["printing"],
      featureId: "kitchen",
      pass: 3,
      basis: "proposed",
      status: "active",
      quote: "shall not print",
    },
  ];
}

function screenCells(): MatrixCellRecord[] {
  return [
    {
      id: "cell-delete-role",
      matrixId: "M01",
      axisA: "user",
      axisB: "user:delete_account",
      status: "filled",
      actionId: "user:delete_account",
      allowed: false,
    },
    {
      id: "cell-delete-screen",
      matrixId: "M03",
      axisA: "account",
      axisB: "danger",
      status: "filled",
      screenActionId: "user:delete_account",
      text: "Delete Account",
    },
  ];
}

function seedWorld(store: InMemoryContradictionStore): void {
  decision(store, "D-sqlite", "sqlite", "storage");
  decision(store, "D-multi", "multi_writer", "jobs");
  decision(store, "D-local", "local_disk", "disk");
  decision(store, "D-object", "object_store", "disk");
  addNode(store, "A", "decision", "Anonymous public access", "Anonymous public access", { basis: "explicit" });
  addNode(store, "B", "decision", "Per-user private billing history", "Per-user private billing history", { basis: "explicit" });
  addNode(store, "C", "decision", "No accounts", "No accounts", { basis: "explicit" });
  addNode(store, "rule-chain", "rule", "Indirect chain", "A implies B implies C, and C is false.", {
    basis: "derived",
    constraints: CHAIN,
  });
  addNode(store, "upload-max", "spec_item", "Upload cap", "upload_max_bytes = 5 MB", { basis: "derived" });
  addNode(store, "upload-need", "spec_item", "Menu attachment", "attach 25 MB high-res menus", { basis: "derived" });
  addNode(store, "cutoff", "spec_item", "Cutoff", "Kitchen cutoff time 11:00 AM America/New_York", { basis: "explicit" });
  addNode(store, "print", "spec_item", "Kitchen print", "Kitchen prints at 10:45 AM local", { basis: "explicit" });
}

function engineFor(
  store: InMemoryContradictionStore,
  model: ContradictionCheckModel,
  extras?: { solver?: Z3UnsatCoreSolver; warnings?: ContradictionWarning[]; trace?: string[] },
) {
  return new FiveLayerContradictionEngine({
    graph: store,
    inbox: store,
    catalog: { listRules: () => RULES },
    matrices: { listCells: () => screenCells() },
    filler: { listMaterializedRequirements: () => requirements() },
    model: {
      checkBatch(pairs) {
        extras?.trace?.push("model");
        return model.checkBatch(pairs);
      },
    },
    ...(extras?.solver === undefined ? {} : { solver: extras.solver }),
    logger: {
      warn(warning) {
        extras?.warnings?.push(warning);
      },
    },
    observer: {
      phase(name) {
        extras?.trace?.push(name);
      },
    },
  });
}

describe("five-layer engine", () => {
  it("detects every layer, blocks readiness, and runs the model only after layers 1-4", () => {
    const store = new InMemoryContradictionStore();
    seedWorld(store);
    const trace: string[] = [];
    const report = engineFor(store, groundedModel(), { trace }).check();
    expect(report.deterministicMs).toBeLessThan(500);
    expect(trace.indexOf("layer5")).toBeGreaterThan(trace.indexOf("layer4"));
    expect(trace.indexOf("model")).toBeGreaterThan(trace.indexOf("layer4"));
    expect(trace.slice(0, 4)).toEqual(["layer1", "layer2", "layer3", "layer4"]);
    expect(report.layer2Status).toBe("unsat");

    const layers = new Set(report.detected.map((conflict) => conflict.layer));
    expect(layers.has(1)).toBe(true);
    expect(layers.has(2)).toBe(true);
    expect(layers.has(3)).toBe(true);
    expect(layers.has(4)).toBe(true);
    expect(layers.has(5)).toBe(true);

    const core = report.detected.find((conflict) => conflict.layer === 2);
    expect(core?.nodeIds).toEqual(["A", "B", "C"]);
    expect(core?.plainEnglishConflict).toContain("Anonymous public access");
    expect(core?.plainEnglishConflict).toContain("Per-user private billing history");
    expect(core?.plainEnglishConflict).toContain("No accounts");
    expect(core?.concreteCounterexample).toContain("A implies B");

    const screen = report.detected.find((conflict) => conflict.layer === 3);
    expect(screen?.nodeIds).toEqual(["cell-delete-role", "cell-delete-screen"]);
    expect(screen?.plainEnglishConflict).toContain("Delete Account");

    expect(report.detected.some((conflict) => conflict.layer === 4 && conflict.nodeIds.includes("upload-max"))).toBe(true);
    expect(report.detected.some((conflict) => conflict.layer === 4 && conflict.nodeIds.includes("print"))).toBe(true);
    expect(report.detected.some((conflict) => conflict.layer === 5 && conflict.concreteCounterexample.includes("1001"))).toBe(true);

    expect(report.blocksReadiness).toBe(true);
    expect(report.blocksGraphCompilation).toBe(true);
    const edges = store.getEdgesAsOf(store.currentRevision()).filter((edge) => edge.type === CONTRADICTION_EDGE_TYPE);
    expect(edges.length).toBeGreaterThan(0);
    const inbox = store.listOpenConflicts()[0];
    expect(inbox?.kind).toBe("conflict");
    expect(inbox?.payload.minimalCoreNodeIds.length).toBeGreaterThan(0);
    expect(inbox?.payload.plainEnglishConflict.length).toBeGreaterThan(0);
    expect(inbox?.payload.concreteCounterexample.length).toBeGreaterThan(0);
    expect(inbox?.payload.resolutionOptions.length).toBeGreaterThan(0);
    expect(inbox?.payload.layer).toBeGreaterThan(0);
  });

  it("clears a contradicts edge when the conflicting decision is superseded", () => {
    const store = new InMemoryContradictionStore();
    seedWorld(store);
    const checker = engineFor(store, groundedModel());
    checker.check();
    expect(edgeBetween(store, "D-local", "D-object")).toBe(true);
    expect(edgeBetween(store, "D-multi", "D-sqlite")).toBe(true);

    store.supersede("D-multi");
    const started = performance.now();
    const report = checker.recheck("D-multi");
    expect(performance.now() - started).toBeLessThan(100);
    expect(report.elapsedMs).toBeLessThan(100);
    expect(edgeBetween(store, "D-multi", "D-sqlite")).toBe(false);
    expect(edgeBetween(store, "D-local", "D-object")).toBe(true);
    expect(checker.blocksReadiness()).toBe(true);

    const cleared = store.listOpenConflicts().find((item) => item.payload.minimalCoreNodeIds.includes("D-multi"));
    expect(cleared).toBeUndefined();

    store.supersede("D-object");
    checker.recheck("D-object");
    expect(edgeBetween(store, "D-local", "D-object")).toBe(false);
    expect(store.listOpenConflicts().some((item) => item.payload.layer === 1)).toBe(false);
  });

  it("keeps layers 1, 3, 4, and 5 when the solver times out", () => {
    const store = new InMemoryContradictionStore();
    seedWorld(store);
    const healthy = engineFor(store, groundedModel());
    const first = healthy.check();
    expect(first.layer2Status).toBe("unsat");
    expect(edgeBetween(store, "A", "B")).toBe(true);

    let ticks = 0;
    const warnings: ContradictionWarning[] = [];
    const degraded = engineFor(store, groundedModel(), {
      warnings,
      solver: new Z3UnsatCoreSolver({ now: () => (ticks++ === 0 ? 0 : 5_000) }),
    });
    const second = degraded.check();
    expect(second.layer2Status).toBe("incomplete_timeout");
    expect(warnings.some((warning) => warning.event === "z3_incomplete_timeout" && warning.timeoutMs === 2_000)).toBe(true);
    expect(second.detected.some((conflict) => conflict.layer === 1)).toBe(true);
    expect(second.detected.some((conflict) => conflict.layer === 3)).toBe(true);
    expect(second.detected.some((conflict) => conflict.layer === 4)).toBe(true);
    expect(second.detected.some((conflict) => conflict.layer === 5)).toBe(true);
    expect(second.detected.some((conflict) => conflict.layer === 2)).toBe(false);
    expect(edgeBetween(store, "A", "B")).toBe(true);
    expect(second.active.some((conflict) => conflict.layer === 2 && conflict.nodeIds.includes("C"))).toBe(true);
    expect(second.blocksGraphCompilation).toBe(true);
  });
});

function edgeBetween(store: InMemoryContradictionStore, left: string, right: string): boolean {
  const [src, dst] = left < right ? [left, right] : [right, left];
  return store
    .getEdgesAsOf(store.currentRevision())
    .some((edge) => edge.type === CONTRADICTION_EDGE_TYPE && edge.src === src && edge.dst === dst);
}
