import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { adaptDiscovery, SqliteWorkItemStore } from "../../src/opening/index.js";

describe("sqlite work items", () => {
  it("reopens work_items from state.db", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-wi-"));
    const options = { projectId: "opening-wi", rootDir };
    const store = new SqliteWorkItemStore(options);
    store.insertWorkItem({
      id: "wi-1",
      dbKind: "fix",
      kind: "bug_fix",
      title: "Fix login redirect",
      status: "discovering",
      createdAtMs: 1,
    });
    store.close();

    const again = SqliteWorkItemStore.reopen(options);
    expect(again.listWorkItems()).toEqual([
      {
        id: "wi-1",
        dbKind: "fix",
        kind: "bug_fix",
        title: "Fix login redirect",
        status: "discovering",
        createdAtMs: 1,
      },
    ]);
    again.close();
  });

  it("maps observed pre-settlements onto the discovery coordinator", () => {
    const seen: string[] = [];
    const port = adaptDiscovery({
      preSettleObservedCriteria(input) {
        seen.push(input.workItemId);
        return { settledCriterionIds: input.settlements.map((row) => row.criterionId) };
      },
    });
    const result = port.preSettleObservedCriteria({
      workItemId: "wi-1",
      settlements: [
        {
          criterionId: "stack.language",
          value: "typescript",
          basis: "observed",
          evidence: ["package.json"],
        },
      ],
    });
    expect(seen).toEqual(["wi-1"]);
    expect(result.applied).toBe(1);
    expect(result.skippedGreenfieldStackQuestions).toBe(true);
  });
});
