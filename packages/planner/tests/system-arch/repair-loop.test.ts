import { afterEach, describe, expect, it } from "vitest";
import {
  FakeModelAdapter,
  SystemArchitectureSynthesizer,
  openArchitectureStore,
  type ArchitectureStore,
} from "../../src/system-arch/index.js";
import { BROKEN_MERMAID, PAREN_MERMAID, kitchenInput, kitchenJson } from "./kitchen-fixture.js";

const ORPHANS = ["REQ-14", "REQ-19", "REQ-22"] as const;

describe("bounded architecture repair", () => {
  let store: ArchitectureStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  it("fixes orphan requirements and broken Mermaid within two passes", async () => {
    store = openArchitectureStore();
    const model = new FakeModelAdapter([
      kitchenJson({ omitRequirements: ORPHANS, contextDiagram: PAREN_MERMAID }),
      kitchenJson({ contextDiagram: PAREN_MERMAID }),
    ]);
    const result = await new SystemArchitectureSynthesizer({ model, store, now: () => 1_700_000_000_000 }).synthesize(
      kitchenInput(),
    );

    expect(result.accepted).toBe(true);
    expect(result.repairPasses).toBeGreaterThan(0);
    expect(result.repairPasses).toBeLessThanOrEqual(2);
    expect(model.calls.length).toBeLessThanOrEqual(3);
    expect(model.calls[1]?.violations.map((item) => item.code)).toEqual(
      expect.arrayContaining(["orphan_requirements", "invalid_mermaid"]),
    );
    expect(store.getNode("diagram:context")?.text).toContain('A["User (Admin)"]');
    expect(store.listEdges()).toContainEqual({ src: "F-Billing", type: "implements", dst: "REQ-14" });
  }, 60_000);

  it("stops after two passes when the faults remain", async () => {
    store = openArchitectureStore();
    const broken = kitchenJson({ omitRequirements: ORPHANS, contextDiagram: BROKEN_MERMAID });
    const model = new FakeModelAdapter([broken, broken, broken]);
    const result = await new SystemArchitectureSynthesizer({ model, store, now: () => 1_700_000_000_000 }).synthesize(
      kitchenInput(),
    );

    expect(result.accepted).toBe(false);
    expect(result.repairPasses).toBe(2);
    expect(result.diagnostic?.contractId).toBe("system-architect@1");
    expect(result.diagnostic?.violations.map((item) => item.code)).toEqual(
      expect.arrayContaining(["orphan_requirements", "invalid_mermaid"]),
    );
    expect(result.diagnostic?.message).toMatch(/orphan_requirements: \['REQ-14', 'REQ-19', 'REQ-22'\]/);
  }, 60_000);
});
