import { describe, expect, it } from "vitest";
import {
  TaskDifficultyClassifier,
  featuresFromGraphTask,
} from "../../src/crew-levels/index.js";
import { blankTask } from "./fixtures.js";

const classifier = new TaskDifficultyClassifier();

describe("TaskDifficultyClassifier", () => {
  it("scores an empty mechanical task as trivial", () => {
    const first = classifier.classify(blankTask());
    const second = classifier.classify(blankTask());
    expect(first).toEqual(second);
    expect(first.tier).toBe("trivial");
    expect(first.score).toBe(0);
    expect(first.greenfield).toBe(true);
    expect(first.contributions.map((item) => item.feature)).toEqual([
      "file_count",
      "must_density",
      "risk_tags",
      "migration",
      "conflict_merge",
      "contract_fan_in",
      "file_rank",
      "retry_history",
    ]);
  });

  it("raises the score for file count, MUST density, fan-in, retries, and file_rank", () => {
    const base = classifier.classify(blankTask());
    expect(classifier.classify(blankTask({ fileCount: 12 })).score).toBeGreaterThan(base.score);
    expect(
      classifier.classify(blankTask({ fileCount: 4, mustBandTokens: 20_000 })).score,
    ).toBeGreaterThan(base.score);
    expect(classifier.classify(blankTask({ contractFanIn: 10 })).score).toBeGreaterThan(
      base.score,
    );
    expect(classifier.classify(blankTask({ priorFailedAttempts: 3 })).score).toBeGreaterThan(
      base.score,
    );
    const brownfield = classifier.classify(
      blankTask({ fileRanks: [{ path: "src/auth.ts", score: 0.42 }] }),
    );
    expect(brownfield.greenfield).toBe(false);
    expect(brownfield.score).toBeGreaterThan(base.score);
  });

  it("classifies auth, payments, migrations, destructive changes, conflicts, and oracle-author as critical", () => {
    expect(classifier.classify(blankTask({ riskTags: ["auth"] })).tier).toBe("critical");
    expect(classifier.classify(blankTask({ riskTags: ["payments"] })).tier).toBe("critical");
    expect(classifier.classify(blankTask({ riskTags: ["migrations"] })).tier).toBe("critical");
    expect(classifier.classify(blankTask({ migrationKind: "destructive" })).tier).toBe(
      "critical",
    );
    expect(classifier.classify(blankTask({ migrationKind: "expand-contract" })).tier).toBe(
      "critical",
    );
    expect(classifier.classify(blankTask({ crossFeatureConflictMerge: true })).tier).toBe(
      "critical",
    );
    expect(classifier.classify(blankTask({ roleId: "oracle-author@1" })).criticalMarkers).toContain(
      "oracle-author@1",
    );
  });

  it("lifts concurrency and security to at least complex without calling a model", () => {
    expect(classifier.classify(blankTask({ riskTags: ["concurrency"] })).tier).toBe("complex");
    expect(classifier.classify(blankTask({ riskTags: ["security"] })).tier).toBe("complex");
  });

  it("reads compiled graph tasks, touches, and file_rank rows", () => {
    const features = featuresFromGraphTask(
      {
        id: "T-auth",
        primaryFiles: ["src/session.ts", "src/pay.ts"],
        mustBandTokens: 4_000,
        touches: ["authn", "money", "concurrent_edit", "migration", "personal_data"],
        implements: ["Contract.Pay", "Contract.Session"],
        obeys: ["X-01"],
        createsMigration: true,
        migrationIntentSlot: "expand-contract users.email",
        mutatesSharedContract: true,
        taskKind: "integration",
        roleId: "oracle-author@1",
      },
      [{ path: "src/session.ts", score: 0.31 }],
      "ts",
    );
    const assessment = classifier.classify(features);
    expect(features.fileCount).toBe(2);
    expect(features.contractFanIn).toBe(3);
    expect(features.riskTags).toEqual([
      "auth",
      "payments",
      "concurrency",
      "migrations",
      "security",
    ]);
    expect(features.migrationKind).toBe("expand-contract");
    expect(features.crossFeatureConflictMerge).toBe(true);
    expect(
      featuresFromGraphTask({
        id: "T-drop",
        createsMigration: true,
        migrationIntentSlot: "drop users.password",
        touches: ["migration"],
      }).migrationKind,
    ).toBe("destructive");
    expect(assessment.tier).toBe("critical");
    expect(assessment.greenfield).toBe(false);
  });
});
