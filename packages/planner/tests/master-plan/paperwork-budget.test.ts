import { describe, expect, it } from "vitest";

import {
  allocateEnvelopes,
  BUILD_PPM,
  ENVELOPE_IDS,
  ENVELOPE_PPM,
  PAPERWORK_PPM,
  PaperworkBudgetEnvelopeAllocator,
  paperworkOf,
  UNIT_SCALE,
  usdDecimalToMicroUnits,
} from "../../src/master-plan/index.js";

function expectExactSplit(total: bigint): void {
  const envelopes = allocateEnvelopes(total);
  let sum = 0n;
  for (const id of ENVELOPE_IDS) {
    const expected = (total * ENVELOPE_PPM[id]) / UNIT_SCALE;
    expect(envelopes[id]).toBe(expected);
    sum += envelopes[id];
  }
  expect(sum).toBe(total);
  expect(paperworkOf(envelopes)).toBe((total * PAPERWORK_PPM) / UNIT_SCALE);
  expect(envelopes.build).toBe((total * BUILD_PPM) / UNIT_SCALE);
  expect(paperworkOf(envelopes) + envelopes.build).toBe(total);
}

describe("PaperworkBudgetEnvelopeAllocator", () => {
  it("keeps the 3/5/6/4/2 shares and the 80% build share on an exact integer scale", () => {
    expect(ENVELOPE_PPM.research + ENVELOPE_PPM.architecture + ENVELOPE_PPM.planning + ENVELOPE_PPM.integration_review + ENVELOPE_PPM.final_audit).toBe(
      PAPERWORK_PPM,
    );
    expect(PAPERWORK_PPM + BUILD_PPM).toBe(UNIT_SCALE);
  });

  it("splits $1, $2, $10, $100, and 1,000,000 ppm with zero remainder drift", () => {
    for (const total of [1_000_000n, 2_000_000n, 10_000_000n, 100_000_000n]) {
      expectExactSplit(total);
    }
    expectExactSplit(1_000_000n);
    const micro = usdDecimalToMicroUnits("$2.00");
    expect(micro).toBe(2_000_000n);
    const twoDollars = allocateEnvelopes(micro);
    expect(twoDollars.final_audit).toBe(40_000n);
    expect(paperworkOf(twoDollars)).toBe(400_000n);
    expect(twoDollars.build).toBe(1_600_000n);
    expect(usdDecimalToMicroUnits("$1")).toBe(1_000_000n);
    expect(usdDecimalToMicroUnits("$10.00")).toBe(10_000_000n);
    expect(usdDecimalToMicroUnits("$100")).toBe(100_000_000n);
  });

  it("gives tiny budgets a minimum quantum without crossing the 20% ceiling", () => {
    for (const total of [0n, 1n, 7n, 49n]) {
      const envelopes = allocateEnvelopes(total);
      const paperwork = paperworkOf(envelopes);
      const sum = ENVELOPE_IDS.reduce((acc, id) => acc + envelopes[id], 0n);
      expect(sum).toBe(total);
      expect(paperwork).toBeLessThanOrEqual((total * PAPERWORK_PPM) / UNIT_SCALE);
      expect(envelopes.build).toBeGreaterThanOrEqual((total * BUILD_PPM) / UNIT_SCALE);
    }
    const seven = allocateEnvelopes(7n);
    expect(paperworkOf(seven)).toBe(1n);
    expect(seven.planning).toBe(1n);
    expect(seven.build).toBe(6n);
    const fortyNine = allocateEnvelopes(49n);
    expect(fortyNine.final_audit).toBe(1n);
    expect(paperworkOf(fortyNine)).toBe(9n);
    expect(fortyNine.build).toBe(40n);
  });

  it("splits each envelope across waves with no drift", () => {
    const allocator = new PaperworkBudgetEnvelopeAllocator();
    const allocation = allocator.allocate({
      currency: "usd",
      totalUnits: usdDecimalToMicroUnits("$10"),
      weights: [
        { key: "upfront", weight: 8n },
        { key: "wave:1", weight: 3n },
        { key: "wave:2", weight: 3n },
        { key: "completion", weight: 1n },
      ],
    });
    expect(allocation.paperworkUnits + allocation.buildUnits).toBe(10_000_000n);
    for (const id of ENVELOPE_IDS) {
      const bucketSum = allocation.buckets.reduce((sum, bucket) => sum + bucket.envelopes[id], 0n);
      expect(bucketSum).toBe(allocation.envelopes[id]);
    }
  });

  it("warns at 85% and compresses optional research at 100% without touching build or planning", () => {
    const allocator = new PaperworkBudgetEnvelopeAllocator();
    const allocation = allocator.allocate({
      currency: "allowance_ppm",
      totalUnits: 1_000_000n,
      weights: [{ key: "project", weight: 1n }],
    });
    expect(allocation.envelopes.research).toBe(30_000n);
    expect(allocation.envelopes.planning).toBe(60_000n);
    expect(allocation.envelopes.build).toBe(800_000n);
    const below = allocator.admit({
      bucket: "project",
      envelope: "research",
      amountUnits: 25_200n,
      callClass: "mandatory_research",
    });
    expect(below.admitted).toBe(true);
    expect(below.warning).toBeNull();
    const atEightyFive = allocator.admit({
      bucket: "project",
      envelope: "research",
      amountUnits: 300n,
      callClass: "mandatory_research",
    });
    expect(atEightyFive.admitted).toBe(true);
    expect(atEightyFive.warning).toMatchObject({
      name: "paperwork_envelope_pressure",
      envelope: "research",
      threshold: "85_percent",
      ratioPpm: 850_000n,
    });
    const fill = allocator.admit({
      bucket: "project",
      envelope: "research",
      amountUnits: 4_500n,
      callClass: "mandatory_research",
    });
    expect(fill.admitted).toBe(true);
    expect(allocator.spentUnits("project", "research")).toBe(30_000n);
    const capped = allocator.admit({
      bucket: "project",
      envelope: "research",
      amountUnits: 1n,
      callClass: "optional_web_fetch",
      userApprovedBuildRaid: true,
    });
    expect(capped.admitted).toBe(false);
    expect(capped.reason).toBe("compressed_optional");
    expect(allocator.remainingUnits("project", "build")).toBe(800_000n);
    expect(allocator.remainingUnits("project", "planning")).toBe(60_000n);
    expect(allocator.spentUnits("project", "research")).toBe(30_000n);
  });

  it("refuses to skip a sealed oracle and raids build only with explicit approval", () => {
    const allocator = new PaperworkBudgetEnvelopeAllocator();
    allocator.allocate({
      currency: "usd",
      totalUnits: 1_000_000n,
      weights: [{ key: "project", weight: 1n }],
    });
    allocator.admit({
      bucket: "project",
      envelope: "planning",
      amountUnits: 60_000n,
      callClass: "sealed_oracle",
    });
    const blocked = allocator.admit({
      bucket: "project",
      envelope: "planning",
      amountUnits: 5n,
      callClass: "determinism_gate",
    });
    expect(blocked.admitted).toBe(false);
    expect(blocked.reason).toBe("needs_explicit_build_approval");
    expect(allocator.remainingUnits("project", "build")).toBe(800_000n);
    const approved = allocator.admit({
      bucket: "project",
      envelope: "planning",
      amountUnits: 5n,
      callClass: "determinism_gate",
      userApprovedBuildRaid: true,
    });
    expect(approved.admitted).toBe(true);
    expect(approved.reason).toBe("admitted_with_explicit_build_raid");
    expect(approved.buildRaidedUnits).toBe(5n);
    expect(allocator.remainingUnits("project", "build")).toBe(799_995n);
    expect(allocator.spentUnits("project", "planning")).toBe(60_000n);
  });

  it("compresses advisory taste review at the envelope and does not skip a mandatory review", () => {
    const allocator = new PaperworkBudgetEnvelopeAllocator();
    allocator.allocate({
      currency: "usd",
      totalUnits: 1_000_000n,
      weights: [{ key: "project", weight: 1n }],
    });
    allocator.admit({
      bucket: "project",
      envelope: "integration_review",
      amountUnits: 40_000n,
      callClass: "mandatory_review",
    });
    const taste = allocator.admit({
      bucket: "project",
      envelope: "integration_review",
      amountUnits: 1n,
      callClass: "advisory_taste_review",
      userApprovedBuildRaid: true,
    });
    expect(taste.admitted).toBe(false);
    expect(taste.reason).toBe("compressed_optional");
    expect(allocator.remainingUnits("project", "build")).toBe(800_000n);
    const mandatory = allocator.admit({
      bucket: "project",
      envelope: "integration_review",
      amountUnits: 1n,
      callClass: "mandatory_review",
    });
    expect(mandatory.admitted).toBe(false);
    expect(mandatory.reason).toBe("needs_explicit_build_approval");
    expect(allocator.remainingUnits("project", "build")).toBe(800_000n);
  });
});
