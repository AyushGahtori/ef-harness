import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteQuarantinedTestsStore } from "../../src/test-health/index.js";

describe("sqlite quarantined tests", () => {
  it("reopens quarantined_tests from state.db", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-q-"));
    const options = { projectId: "baseline-q", rootDir };
    const store = new SqliteQuarantinedTestsStore(options);
    await store.replaceAll([
      {
        testId: "orders.slow",
        filePath: "src/orders.test.ts",
        errorFingerprint: "timeout",
        baselineCommitSha: "abc123",
        classification: "known_failing",
      },
    ]);
    store.close();

    const again = new SqliteQuarantinedTestsStore(options);
    await expect(again.listAll()).resolves.toEqual([
      {
        testId: "orders.slow",
        filePath: "src/orders.test.ts",
        errorFingerprint: "timeout",
        baselineCommitSha: "abc123",
        classification: "known_failing",
      },
    ]);
    again.close();
  });
});
