import { describe, expect, it } from "vitest";
import * as brownfield from "../src/index.js";

describe("brownfield barrel", () => {
  it("exports l0, l1, l2, opening, and test-health", () => {
    expect(brownfield.l0Scan).toBeTypeOf("object");
    expect(brownfield.l1Codemap).toBeTypeOf("object");
    expect(brownfield.l2Cards).toBeTypeOf("object");
    expect(brownfield.opening).toBeTypeOf("object");
    expect(brownfield.testHealth).toBeTypeOf("object");
  });
});
