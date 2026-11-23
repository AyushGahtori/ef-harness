import { describe, expect, it } from "vitest";

import { ForcePushForbiddenError, assertHarnessStatePushAllowed } from "../../src/rehydration/index.js";

describe("force push guard", () => {
  it("forbids blind force push on harness-state", () => {
    expect(() => assertHarnessStatePushAllowed("git push origin harness-state --force")).toThrow(
      ForcePushForbiddenError,
    );
    expect(() =>
      assertHarnessStatePushAllowed(
        "git push origin harness-state --force-with-lease=refs/heads/harness-state:abc",
      ),
    ).not.toThrow();
  });
});