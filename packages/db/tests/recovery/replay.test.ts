import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FilesystemReplaySourceAdapter,
  findAcceptedCommitsSince,
  parseHarnessTrailers,
  replayPostBackupState,
  selectNewestCheckpointParks,
} from "../../src/recovery/index.js";
import { createDatabaseFromSchema, readSchema } from "../../src/recovery/sqlite-io.js";
import { makeTempRoot, removeTempRoot } from "./fixture.js";

describe("replay hooks", { timeout: 60_000 }, () => {
  it("parses Harness trailers, history segments, and the newest checkpoint per task", () => {
    const trailers = parseHarnessTrailers(
      [
        "Accept kitchen print",
        "",
        "Harness-Feature: F12",
        "Harness-Task: T07",
        "Harness-Attempt: A0014",
        "Harness-Checks: AC-31, AC-32",
        "Harness-Checks: AC-33",
      ].join("\n"),
    );
    expect(trailers).toEqual({
      task: "T07",
      checks: ["AC-31", "AC-32", "AC-33"],
      feature: "F12",
      attempt: "A0014",
    });

    const commits = findAcceptedCommitsSince(
      [
        { sha: "backup", committedAt: 1_000, message: "snapshot\n\nHarness-Task: T01\nHarness-Checks: AC-1\n" },
        { sha: "later", committedAt: 2_000, message: "accepted\n\nHarness-Task: T07\nHarness-Checks: AC-31\n" },
        { sha: "note", committedAt: 3_000, message: "no trailers" },
      ],
      { backupSha: "backup" },
    );
    expect(commits).toEqual([
      {
        taskId: "T07",
        checks: ["AC-31"],
        commitSha: "later",
        attemptId: null,
        feature: null,
      },
    ]);

    const parked = selectNewestCheckpointParks([
      { ref: "refs/harness/checkpoints/T07/A1", sha: "old", committedAt: 10 },
      { ref: "refs/harness/checkpoints/T07/A2", sha: "new", committedAt: 20 },
      { ref: "refs/harness/checkpoints/T03/A9", sha: "other", committedAt: 15 },
      { ref: "refs/heads/main", sha: "nope", committedAt: 99 },
    ]);
    expect(parked).toEqual([
      {
        taskId: "T03",
        attemptId: "A9",
        checkpointRef: "refs/harness/checkpoints/T03/A9",
        sha: "other",
      },
      {
        taskId: "T07",
        attemptId: "A2",
        checkpointRef: "refs/harness/checkpoints/T07/A2",
        sha: "new",
      },
    ]);
  });

  it("replays jsonl change sets after last_rev and schedules re-verification", () => {
    const root = makeTempRoot();
    try {
      const historyDir = path.join(root, "history");
      fs.mkdirSync(historyDir);
      fs.writeFileSync(
        path.join(historyDir, "000001-000002.jsonl"),
        [
          JSON.stringify({
            rev: 1,
            changeSetId: "cs-1",
            origin: "import",
            author: "history",
            createdAt: 10,
            summary: "already in the backup",
          }),
          JSON.stringify({
            rev: 2,
            changeSet: {
              id: "cs-2",
              origin: "kernel",
              author: "history",
              created_at: 20,
              summary: "after backup",
            },
            nodes: [
              {
                id: "R2",
                kind: "rule",
                version: 1,
                contentHash: "hash-r2",
                title: "Replayed rule",
                text: "from history",
                fields: {},
                createdRev: 2,
                updatedRev: 2,
              },
            ],
          }),
          "",
        ].join("\n"),
      );
      const dbPath = path.join(root, "state.db");
      const db = createDatabaseFromSchema(dbPath, readSchema("state.sql"));
      db.prepare("INSERT INTO meta(key, value) VALUES ('last_rev', '1')").run();
      const adapter = new FilesystemReplaySourceAdapter({
        historyDir,
        commits: [
          {
            sha: "abc",
            committedAt: 5_000,
            message: "Harness-Task: T07\nHarness-Checks: AC-31\nHarness-Attempt: A0014\n",
          },
        ],
        checkpoints: [
          { ref: "refs/harness/checkpoints/T07/A0014", sha: "def", committedAt: 6_000 },
        ],
      });
      const replay = replayPostBackupState({
        db,
        projectId: "proj-1",
        afterRev: 1,
        backupAt: 4_000,
        backupSha: null,
        historyDir,
        adapter,
      });
      expect(replay.changeSets.map((change) => change.changeSetId)).toEqual(["cs-2"]);
      expect(replay.changeSets[0]?.applied).toBe(true);
      expect(replay.tasks).toEqual([
        {
          taskId: "T07",
          checks: ["AC-31"],
          commitSha: "abc",
          attemptId: "A0014",
          feature: null,
        },
      ]);
      expect(replay.parked).toEqual([
        {
          taskId: "T07",
          attemptId: "A0014",
          checkpointRef: "refs/harness/checkpoints/T07/A0014",
          sha: "def",
        },
      ]);
      expect(db.prepare("SELECT title FROM nodes WHERE id = 'R2'").get()).toEqual({
        title: "Replayed rule",
      });
      expect(db.prepare("SELECT value FROM meta WHERE key = 'last_rev'").get()).toEqual({
        value: "2",
      });
      db.close();
    } finally {
      removeTempRoot(root);
    }
  });

  it("reports a git lookup failure without throwing", () => {
    const adapter = new FilesystemReplaySourceAdapter({
      repoDir: "C:/missing-repo",
      git: () => ({ status: 1, stdout: "", stderr: "not a repository" }),
    });
    expect(
      adapter.findAcceptedCommitsSince({ projectId: "proj-1", backupAt: null, backupSha: null }),
    ).toEqual([]);
    expect(adapter.warnings.join("\n")).toContain("not a repository");
    expect(adapter.parkInFlightAtCheckpoints({ projectId: "proj-1" })).toEqual([]);
  });
});
