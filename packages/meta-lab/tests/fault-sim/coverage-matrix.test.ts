import { describe, expect, it } from "vitest";
import { coverageReportJson, emptyCoverageMatrix, recordFaultHit } from "../../src/fault-sim/index.js";

describe("fault coverage matrix", () => {
  it("reports >0 hits on every registered TX hook after aggregation", () => {
    let matrix = emptyCoverageMatrix();
    for (const hook of [
      "before_begin_immediate",
      "before_sqlite_commit",
      "after_commit_before_git_update_ref",
      "after_git_update_ref_before_cas_pin",
      "after_cas_pin_before_ack",
      "after_effects_dispatched_before_http_response",
      "mid_sqlite_wal_write",
    ] as const) {
      matrix = recordFaultHit(matrix, hook, "tx_crash");
    }
    const json = coverageReportJson(matrix);
    expect(json).toContain("before_sqlite_commit");
    for (const hook of Object.values(matrix.hooks)) {
      expect(hook).toBeGreaterThan(0);
    }
  });
});