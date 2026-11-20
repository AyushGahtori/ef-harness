import { describe, expect, it } from "vitest";
import { planTwoTierVerification } from "../../src/advanced/index.js";

describe("two-tier verification policy", () => {
  it("keeps red-before-green and held-back examples as the default baseline", () => {
    const plan = planTwoTierVerification({ tags: [] });
    expect(plan.baseline).toEqual(["red_before_green", "held_back_examples"]);
    expect(plan.propertyChecks).toBe(false);
    expect(plan.boundaryMutationProbes).toBe(false);
    expect(plan.runners).toEqual([]);
  });

  it("activates property checks only for invariant_domain", () => {
    const plan = planTwoTierVerification({ tags: ["invariant_domain"] });
    expect(plan.baseline).toEqual(["red_before_green", "held_back_examples"]);
    expect(plan.propertyChecks).toBe(true);
    expect(plan.boundaryMutationProbes).toBe(false);
    expect(plan.runners).toEqual(["PropertyCheckRunner"]);
  });

  it("activates boundary probes only for high_impact_boundary", () => {
    const plan = planTwoTierVerification({ tags: ["high_impact_boundary"] });
    expect(plan.runners).toEqual(["TargetedBoundaryMutationProber"]);
    expect(plan.propertyChecks).toBe(false);
  });

  it("activates both selective runners when both tags are present", () => {
    const plan = planTwoTierVerification({ tags: ["invariant_domain", "high_impact_boundary"] });
    expect(plan.baseline).toEqual(["red_before_green", "held_back_examples"]);
    expect(plan.runners).toEqual(["PropertyCheckRunner", "TargetedBoundaryMutationProber"]);
  });
});
