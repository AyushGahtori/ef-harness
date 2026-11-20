import { describe, expect, it } from "vitest";
import {
  CRITERION_STATUSES,
  CriterionStatusSchema,
  HOLD_REASONS,
  isCriterionStatus,
  isHoldReason,
  isSettledBasis,
  isTaskState,
  SETTLED_BASES,
  SettledBasisSchema,
  TASK_STATES,
  TaskStateSchema,
} from "../../src/vocabularies/index.js";

describe("basis and status vocabularies", () => {
  it("keeps bases and statuses disjoint at runtime", () => {
    for (const basis of SETTLED_BASES) {
      expect(isSettledBasis(basis)).toBe(true);
      expect(SettledBasisSchema.safeParse(basis).success).toBe(true);
      expect(isCriterionStatus(basis)).toBe(false);
      expect(CriterionStatusSchema.safeParse(basis).success).toBe(false);
    }
    for (const status of CRITERION_STATUSES) {
      expect(isCriterionStatus(status)).toBe(true);
      expect(CriterionStatusSchema.safeParse(status).success).toBe(true);
      expect(isSettledBasis(status)).toBe(false);
      expect(SettledBasisSchema.safeParse(status).success).toBe(false);
    }
    expect(
      SETTLED_BASES.filter((basis) => (CRITERION_STATUSES as readonly string[]).includes(basis)),
    ).toEqual([]);
  });

  it("rejects legacy basis wording and status strings used as bases", () => {
    for (const legacy of ["chosen under delegation", "asked", "open"]) {
      expect(isSettledBasis(legacy)).toBe(false);
      expect(SettledBasisSchema.safeParse(legacy).success).toBe(false);
    }
    expect(isSettledBasis("EXPLICIT")).toBe(false);
    expect(isCriterionStatus("ASKED")).toBe(false);
    expect(isCriterionStatus("asked")).toBe(true);
    expect(isCriterionStatus("open")).toBe(true);
    expect(isSettledBasis("delegated")).toBe(true);
  });

  it("does not model HELD as a task state", () => {
    expect(TASK_STATES.map((row) => row.state)).not.toContain("HELD");
    expect(isTaskState("HELD")).toBe(false);
    expect(isTaskState("held")).toBe(false);
    expect(TaskStateSchema.safeParse("HELD").success).toBe(false);
    expect(TaskStateSchema.safeParse("DRAFTED").success).toBe(true);
    expect(HOLD_REASONS).not.toContain("HELD");
    expect(isHoldReason("HELD")).toBe(false);
    expect(isHoldReason("user_pause")).toBe(true);
    expect(isTaskState("user_pause")).toBe(false);
  });
});
