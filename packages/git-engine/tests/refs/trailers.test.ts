import { describe, expect, it } from "vitest";

import { parseHarnessTrailers } from "../../src/refs/index.js";

describe("parseHarnessTrailers", () => {
  it("reads the trailing harness trailer block", () => {
    const message = [
      "Land the task",
      "",
      "Harness-Feature: F12",
      "Harness-Task: T03b",
      "Harness-Attempt: 2",
      "Harness-Checks: receipt-abc",
      "",
    ].join("\n");

    expect(parseHarnessTrailers(message)).toEqual({
      feature: "F12",
      task: "T03b",
      attempt: "2",
      checks: "receipt-abc",
    });
  });

  it("keeps the last trailer when a decoy appears earlier in the block", () => {
    const message = [
      'Land the "widget" for $5 (100%)',
      "",
      "Harness-Task: DECOY",
      "Still the body.",
      "",
      "Harness-Feature: F12",
      "Harness-Task: T03b",
      "Harness-Attempt: 2",
      "Harness-Checks: receipt-abc",
    ].join("\n");

    expect(parseHarnessTrailers(message).task).toBe("T03b");
    expect(parseHarnessTrailers(message).checks).toBe("receipt-abc");
  });

  it("joins a folded trailer continuation", () => {
    const message = "Subject\n\nHarness-Checks: receipt\n more-detail\nHarness-Task: T01\n";
    expect(parseHarnessTrailers(message).checks).toBe("receipt more-detail");
    expect(parseHarnessTrailers(message).task).toBe("T01");
    expect(parseHarnessTrailers(message).feature).toBeNull();
  });
});
