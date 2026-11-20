import { describe, expect, it } from "vitest";
import { InvalidIntegratorOutputError, parseFeatureIntegratorV1 } from "../../src/feature-integrator/index.js";

describe("feature-integrator@1 local schema port", () => {
  it("accepts a success payload and a blocked exit", () => {
    expect(
      parseFeatureIntegratorV1({
        resolved_conflicts: [{ path: "src/routes.ts", summary: "Kept both route imports" }],
        wiring_done: ["wiring-F-Menu"],
        rerun_checks: ["AC-31"],
      }),
    ).toEqual({
      resolved_conflicts: [{ path: "src/routes.ts", summary: "Kept both route imports" }],
      wiring_done: ["wiring-F-Menu"],
      rerun_checks: ["AC-31"],
    });
    expect(
      parseFeatureIntegratorV1({
        blocked: true,
        reason: "The two route contracts cannot both be kept",
        missing_ids: ["R-Menu"],
      }),
    ).toEqual({
      blocked: true,
      reason: "The two route contracts cannot both be kept",
      missing_ids: ["R-Menu"],
    });
  });

  it("rejects extra keys, blank text, and whitespace ids", () => {
    expect(() =>
      parseFeatureIntegratorV1({
        resolved_conflicts: [],
        wiring_done: [],
        rerun_checks: [],
        approved: true,
      }),
    ).toThrow(InvalidIntegratorOutputError);
    expect(() =>
      parseFeatureIntegratorV1({
        resolved_conflicts: [{ path: " ", summary: "kept" }],
        wiring_done: [],
        rerun_checks: [],
      }),
    ).toThrow(InvalidIntegratorOutputError);
    expect(() =>
      parseFeatureIntegratorV1({
        resolved_conflicts: [],
        wiring_done: ["has space"],
        rerun_checks: [],
      }),
    ).toThrow(InvalidIntegratorOutputError);
    expect(() => parseFeatureIntegratorV1({ blocked: false, reason: "no" })).toThrow(
      InvalidIntegratorOutputError,
    );
  });
});
