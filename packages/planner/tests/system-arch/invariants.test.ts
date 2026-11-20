import { afterEach, describe, expect, it } from "vitest";
import {
  FakeModelAdapter,
  SystemArchitectureSynthesizer,
  openArchitectureStore,
  type ArchitectureStore,
} from "../../src/system-arch/index.js";
import { kitchenInput, kitchenJson } from "./kitchen-fixture.js";

describe("architecture invariants", () => {
  let store: ArchitectureStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  it("refuses to start while a contradicts edge is active", async () => {
    store = openArchitectureStore();
    store.commitChangeSet({
      author: "test",
      summary: "conflict",
      nodes: [
        {
          id: "D-A",
          kind: "decision",
          title: "A",
          text: "Anonymous access",
          fields: { feature: "phase0-foundation", basis: "explicit" },
        },
        {
          id: "D-B",
          kind: "decision",
          title: "B",
          text: "Accounts are required",
          fields: { feature: "phase0-foundation", basis: "explicit" },
        },
      ],
      edges: [{ src: "D-A", type: "contradicts", dst: "D-B" }],
    });
    const model = new FakeModelAdapter([kitchenJson()]);
    const result = await new SystemArchitectureSynthesizer({ model, store, now: () => 1 }).synthesize(kitchenInput());
    expect(result.started).toBe(false);
    expect(result.accepted).toBe(false);
    expect(result.refusal).toEqual({ reason: "unresolved_contradictions", activeConflicts: 1 });
    expect(model.calls).toEqual([]);
  });

  it("rejects two features that both claim MenuItem", async () => {
    store = openArchitectureStore();
    const model = new FakeModelAdapter([kitchenJson({ dualOwnMenu: true })]);
    const result = await new SystemArchitectureSynthesizer({ model, store, now: () => 1 }).synthesize(kitchenInput());
    expect(result.accepted).toBe(false);
    expect(result.violations[0]?.code).toBe("dual_owner");
    expect(result.violations[0]?.message).toMatch(/F-Menu owns MenuItem/);
    expect(result.violations[0]?.message).toMatch(/F-Orders consumes via contract\/seam/);
    expect(store.getNode("entity:MenuItem")).toBeUndefined();
  });

  it("keeps observed subsystems and rejects a rewrite of an untouched one", async () => {
    store = openArchitectureStore();
    const kept = new FakeModelAdapter([kitchenJson()]);
    const preserved = await new SystemArchitectureSynthesizer({
      model: kept,
      store,
      now: () => 1,
    }).synthesize(kitchenInput(true));
    expect(preserved.accepted).toBe(true);
    expect(store.getNode("legacy:billing")?.basis).toBe("observed");
    expect(store.getNode("legacy:billing")?.text).toBe("export function charge(): void");
    store.close();

    store = openArchitectureStore();
    const rewrite = new FakeModelAdapter([kitchenJson({ rewriteObservedId: "legacy:billing" })]);
    const rejected = await new SystemArchitectureSynthesizer({
      model: rewrite,
      store,
      now: () => 1,
    }).synthesize(kitchenInput(true));
    expect(rejected.accepted).toBe(false);
    expect(rejected.violations[0]?.code).toBe("brownfield_rewrite");
    expect(store.getNode("legacy:billing")?.text).toBe("export function charge(): void");
  }, 60_000);
});
