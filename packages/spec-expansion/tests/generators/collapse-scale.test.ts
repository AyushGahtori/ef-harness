import { describe, expect, it } from "vitest";

import {
  addAxisNode,
  entityActionAxis,
  entityEndpointAxis,
  kitchenManagerRole,
  kitchenMealOrderingGraph,
  MatrixCellPersistenceRepo,
  MatrixGeneratorRegistry,
  renameAxisNode,
  ScopedRuleCollapser,
  screenStateAxis,
  stressGraph,
} from "../../src/generators/index.js";

const registry = new MatrixGeneratorRegistry();
const collapser = new ScopedRuleCollapser();

describe("scoped collapse, scale, and incremental cell ids", () => {
  it("collapses 25 entities, 8 roles, and 60 endpoints under the explosion budget", () => {
    const graph = stressGraph();
    const roles = graph.nodes.filter((node) => node.kind === "role");
    const entities = graph.nodes.filter((node) => node.kind === "entity");
    const endpoints = graph.nodes.filter((node) => node.kind === "endpoint");
    expect(roles).toHaveLength(8);
    expect(entities).toHaveLength(25);
    expect(endpoints).toHaveLength(60);

    const warmup = registry.generate(graph);
    collapser.collapse(warmup);
    let elapsed = Number.POSITIVE_INFINITY;
    let run = warmup;
    let collapsed = collapser.collapse(warmup);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const started = performance.now();
      run = registry.generate(graph);
      collapsed = collapser.collapse(run);
      elapsed = Math.min(elapsed, performance.now() - started);
    }

    expect(run.llmCalls).toBe(0);
    expect(run.rawCells.length).toBeGreaterThanOrEqual(12_000);
    expect(run.rawCells.filter((cell) => cell.axisB.startsWith("ep/"))).toHaveLength(8 * 25 * 60);
    const stored = collapsed.rules.length + collapsed.exceptions.length;
    expect(stored).toBeLessThan(200);
    expect(elapsed).toBeLessThan(50);

    const expanded = collapser.expand(collapsed, run.rawCells);
    expect(expanded.size).toBe(run.rawCells.length);
    for (const cell of run.rawCells) {
      expect(expanded.get(cell.id)).toBe(cell.signature);
    }
  });

  it("adds only the Kitchen Manager rows on M01, M03, and M04", () => {
    const before = registry.generate(kitchenMealOrderingGraph());
    const after = registry.generate(addAxisNode(kitchenMealOrderingGraph(), kitchenManagerRole()));
    const beforeIds = new Set(before.rawCells.map((cell) => cell.id));
    const afterIds = new Set(after.rawCells.map((cell) => cell.id));
    const removed = before.rawCells.filter((cell) => !afterIds.has(cell.id));
    const delta = after.rawCells.filter((cell) => !beforeIds.has(cell.id));
    expect(removed).toEqual([]);
    expect(delta.length).toBeGreaterThan(0);
    expect(delta.every((cell) => cell.axisA === "role.kitchen_manager")).toBe(true);
    expect(new Set(delta.map((cell) => cell.matrixId))).toEqual(new Set(["M01", "M03", "M04"]));
    const entities = 4;
    const endpoints = 3;
    const screens = { print: 8, plain: 7 };
    expect(delta.filter((cell) => cell.matrixId === "M01")).toHaveLength(entities * 5 + entities * endpoints);
    expect(delta.filter((cell) => cell.matrixId === "M03")).toHaveLength(screens.print + screens.plain);
    expect(delta.filter((cell) => cell.matrixId === "M04")).toHaveLength(endpoints * 9);
    expect(delta.some((cell) => cell.axisB === entityActionAxis("entity.order", "read"))).toBe(true);
    expect(delta.some((cell) => cell.axisB === entityEndpointAxis("entity.order", "endpoint.orders_get"))).toBe(true);
    expect(delta.some((cell) => cell.axisB === screenStateAxis("screen.kitchen_list", "print"))).toBe(true);
  });

  it("keeps cell ids when a display title changes", () => {
    const original = registry.generate(kitchenMealOrderingGraph());
    const renamed = registry.generate(renameAxisNode(kitchenMealOrderingGraph(), "entity.order", "Meal Order"));
    expect(renamed.rawCells.map((cell) => cell.id)).toEqual(original.rawCells.map((cell) => cell.id));
    expect(renamed.rawCells.some((cell) => cell.id.includes("Meal Order") || cell.id.includes("Order"))).toBe(false);
  });

  it("preserves filled cells and persists expands edges for the delta only", () => {
    const repo = MatrixCellPersistenceRepo.openMemory();
    const initialGraph = kitchenMealOrderingGraph();
    const initial = registry.generate(initialGraph);
    const initialCollapsed = collapser.collapse(initial);
    repo.persist(initialGraph, initial, initialCollapsed);
    const filledId = initial.rawCells.find(
      (cell) => cell.axisA === "role.staff" && cell.axisB === entityActionAxis("entity.order", "read"),
    )?.id;
    if (!filledId) throw new Error("missing staff read cell");
    repo.markFilled(filledId, { basis: "explicit", text: "Staff may read an order until cutoff." }, initialGraph);
    const filledBefore = repo.readRecord(filledId);
    if (!filledBefore) throw new Error("filled cell was not stored");

    const nextGraph = addAxisNode(initialGraph, kitchenManagerRole());
    const next = registry.generate(nextGraph);
    const stats = repo.persist(nextGraph, next, collapser.collapse(next));
    const filledAfter = repo.readRecord(filledId);
    expect(filledAfter).toEqual(filledBefore);

    const beforeIds = new Set(initial.rawCells.map((cell) => cell.id));
    const delta = next.rawCells.filter((cell) => !beforeIds.has(cell.id)).map((cell) => cell.id).sort();
    expect(stats.insertedCellIds).toEqual(delta);
    expect(stats.insertedCellIds.every((id) => id.includes("role.kitchen_manager"))).toBe(true);
    expect(stats.preservedCellIds).toHaveLength(initial.rawCells.length);

    const sample = delta[0];
    if (!sample) throw new Error("missing delta cell");
    const edges = repo.expandEdges(sample);
    expect(edges.some((edge) => edge.type === "expands" && edge.dst === "role.kitchen_manager")).toBe(true);
    expect(edges.some((edge) => edge.type === "expands" && edge.dst === "feature.kitchen")).toBe(true);

    const rule = initialCollapsed.rules.find(
      (item) => item.text === "ALL unauthenticated requests to /api/private/* return 401",
    );
    if (!rule) throw new Error("missing 401 rule");
    const ruleEdges = repo.expandEdges(rule.id);
    expect(ruleEdges.some((edge) => edge.type === "expands" && edge.dst === "endpoint.orders_get")).toBe(true);
    expect(repo.readRecord(rule.id)?.text).toBe(rule.text);

    const again = repo.persist(nextGraph, next, collapser.collapse(next));
    expect(again.insertedCellIds).toEqual([]);
    expect(repo.readRecord(filledId)).toEqual(filledBefore);
  });

  it("does not orphan cells when the renamed entity is persisted again", () => {
    const repo = MatrixCellPersistenceRepo.openMemory();
    const graph = kitchenMealOrderingGraph();
    const run = registry.generate(graph);
    repo.persist(graph, run, collapser.collapse(run));
    const renamedGraph = renameAxisNode(graph, "entity.order", "Meal Order");
    const renamed = registry.generate(renamedGraph);
    const before = repo.readRecord("entity.order");
    const stats = repo.persist(renamedGraph, renamed, collapser.collapse(renamed));
    expect(stats.insertedCellIds).toEqual([]);
    expect(repo.readRecord("entity.order")).toEqual(before);
    expect(renamed.rawCells.map((cell) => cell.id)).toEqual(run.rawCells.map((cell) => cell.id));
  });
});
