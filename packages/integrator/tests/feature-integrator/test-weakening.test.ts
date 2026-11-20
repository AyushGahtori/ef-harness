import { describe, expect, it } from "vitest";
import { TestWeakeningError, assertNoTestWeakening } from "../../src/feature-integrator/index.js";

const before = [
  {
    path: "src/features/menu/menu.test.ts",
    text: [
      'import assert from "node:assert/strict";',
      "export function check(): void {",
      "  assert.equal(1, 1);",
      "  assert.equal(2, 2);",
      "}",
      "",
    ].join("\n"),
  },
];

describe("test-weakening guard", () => {
  it("rejects a patch that adds .skip", () => {
    const after = [
      {
        path: "src/features/menu/menu.test.ts",
        text: [
          'import assert from "node:assert/strict";',
          "export function check(): void {",
          "  assert.equal(1, 1);",
          "  assert.equal(2, 2);",
          "}",
          'it.skip("hidden", () => { assert.equal(1, 1); });',
          "",
        ].join("\n"),
      },
    ];
    expect(() => assertNoTestWeakening(before, after)).toThrow(TestWeakeningError);
    try {
      assertNoTestWeakening(before, after);
    } catch (error) {
      expect(error).toBeInstanceOf(TestWeakeningError);
      expect((error as TestWeakeningError).reason).toBe("skip");
    }
  });

  it("rejects .only and a deleted assertion", () => {
    const only = [
      {
        path: "src/features/menu/menu.test.ts",
        text: 'it.only("one", () => { assert.equal(1, 1); assert.equal(2, 2); });\n',
      },
    ];
    expect(() => assertNoTestWeakening(before, only)).toThrow(TestWeakeningError);

    const deleted = [
      {
        path: "src/features/menu/menu.test.ts",
        text: [
          'import assert from "node:assert/strict";',
          "export function check(): void {",
          "  assert.equal(1, 1);",
          "}",
          "",
        ].join("\n"),
      },
    ];
    try {
      assertNoTestWeakening(before, deleted);
      expect.fail("deleted assertion should be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(TestWeakeningError);
      expect((error as TestWeakeningError).reason).toBe("deleted_assertion");
    }
  });

  it("rejects deleting the test file and allows an unchanged test", () => {
    expect(() => assertNoTestWeakening(before, [])).toThrow(TestWeakeningError);
    expect(() => assertNoTestWeakening(before, before)).not.toThrow();
  });
});
