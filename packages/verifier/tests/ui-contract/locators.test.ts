import { describe, expect, it } from "vitest";
import {
  assertNoBrittleLocators,
  BrittleLocatorError,
  compileContractChecks,
  missingControlMessage,
  UiInteractionContractSchema,
} from "../../src/ui-contract/index.js";

describe("role and label locators", () => {
  it("compiles contracts to getByRole, getByText, and getByTestId only", () => {
    const checks = compileContractChecks(
      UiInteractionContractSchema.parse({
        contract: "kitchen-list/ui@1",
        route: "/kitchen",
        as: { role: "kitchen_staff" },
        landmarks: [{ heading: "Kitchen totals" }],
        actions: [{ role: "button", testid: "kitchen-row" }],
        testids: ["kitchen-row"],
        states: { empty: { text: "No orders yet" } },
      }),
    );
    expect(checks.every((check) => ["getByRole", "getByLabel", "getByText", "getByTestId"].includes(check.method))).toBe(
      true,
    );
    expect(JSON.stringify(checks)).not.toMatch(/xpath|css=|class=/);
  });

  it("rejects CSS, XPath, and #id selectors", () => {
    expect(() => assertNoBrittleLocators([{ method: "locator", selector: ".print" }])).toThrow(BrittleLocatorError);
    expect(() => assertNoBrittleLocators([{ method: "getByRole", role: "button", selector: "//button" }])).toThrow(
      BrittleLocatorError,
    );
    expect(() => assertNoBrittleLocators([{ method: "getByRole", role: "button", name: "#print" }])).toThrow(
      BrittleLocatorError,
    );
    expect(() => assertNoBrittleLocators([{ method: "getByRole", role: "button", css: ".print" }])).toThrow(
      BrittleLocatorError,
    );
  });

  it("formats the visible contract mismatch for a missing Print button", () => {
    expect(missingControlMessage("button", "Print", "/kitchen")).toBe("No button named 'Print' on /kitchen");
  });
});
