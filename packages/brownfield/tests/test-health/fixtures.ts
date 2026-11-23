import type { DetectedRepoScripts } from "../../src/test-health/types.js";

export const HEALTHY_VITEST_JSON = JSON.stringify({
  numTotalTests: 2,
  testResults: [
    {
      name: "tests/healthy.test.ts",
      assertionResults: [
        { fullName: "healthy > adds numbers", status: "passed", duration: 3 },
        { fullName: "healthy > greets", status: "passed", duration: 1 },
      ],
    },
  ],
});

export const MIXED_VITEST_JSON = JSON.stringify({
  numTotalTests: 4,
  testResults: [
    {
      name: "tests/mixed.test.ts",
      assertionResults: [
        { fullName: "mixed > always passes", status: "passed", duration: 2 },
        { fullName: "mixed > broken invariant", status: "failed", failureMessages: ["expected 1 to be 2"], duration: 4 },
        { fullName: "mixed > stale assertion", status: "failed", failureMessages: ["timeout"], duration: 50 },
        { fullName: "mixed > flaky timer", status: "failed", failureMessages: ["flaky"], duration: 8 },
      ],
    },
  ],
});

export const FLAKE_RERUN_JSON = JSON.stringify({
  testResults: [
    {
      name: "tests/mixed.test.ts",
      assertionResults: [{ fullName: "mixed > flaky timer", status: "passed", duration: 2 }],
    },
  ],
});

export const ZERO_TEST_SCRIPTS: DetectedRepoScripts = {
  typecheck: ["pnpm", "typecheck"],
  lint: null,
  build: ["pnpm", "build"],
  test: null,
  testFileCount: 0,
};

export const HEALTHY_SCRIPTS: DetectedRepoScripts = {
  typecheck: ["pnpm", "typecheck"],
  lint: ["pnpm", "lint"],
  build: ["pnpm", "build"],
  test: ["pnpm", "test", "--reporter=json"],
  testFileCount: 2,
};

export const BROKEN_TS_OUTPUT = "error TS2322: Type 'string' is not assignable to type 'number'.\nsrc/broken.ts(4,5)";

export const CHAR_BASELINE_JSON = JSON.stringify({
  testResults: [
    {
      name: "tests/char.test.ts",
      assertionResults: [
        { fullName: "characterizes current behavior of calculateTax.ts", status: "passed", duration: 1 },
        { fullName: "characterizes current behavior of formatUsd.ts", status: "passed", duration: 1 },
        { fullName: "characterizes edge case 3 in calculateTax.ts", status: "passed", duration: 1 },
      ],
    },
  ],
});