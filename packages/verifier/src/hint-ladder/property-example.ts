import { createHash } from "node:crypto";
import type { HiddenExample, PropertyExampleRequest } from "./types.js";

export function localPropertyExample(request: PropertyExampleRequest): HiddenExample {
  const digest = createHash("sha256")
    .update(`${request.ruleId}\n${request.seed}\n${request.ruleText}`)
    .digest("hex")
    .slice(0, 16);
  const sealed = new Set(request.sealedCheckIds);
  let checkId = `gen-${request.ruleId}-${digest}`;
  let suffix = 1;
  while (sealed.has(checkId)) {
    suffix += 1;
    checkId = `gen-${request.ruleId}-${digest}-${suffix}`;
  }
  return {
    checkId,
    input: {
      kind: "property_generated",
      ruleId: request.ruleId,
      seed: request.seed,
    },
    expectedOutput: {
      kind: "property_generated",
      ruleId: request.ruleId,
      ruleText: request.ruleText,
    },
  };
}
