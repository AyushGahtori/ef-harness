import assert from "node:assert/strict";
import test from "node:test";
import { describeCapacity } from "./main.ts";

test("keeps thinking and execution labels distinct", () => {
  assert.equal(describeCapacity(5, 2), "w5 thinking; execution 2");
});
