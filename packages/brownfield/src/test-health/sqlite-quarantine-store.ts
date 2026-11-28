import { openProjectStateDb, type ProjectStateDb } from "@ef-harness/db";
import type { QuarantinedTestsStorePort } from "./ports.js";
import type { QuarantinedTestRow } from "./types.js";

export interface SqliteQuarantineStoreOptions {
  readonly projectId: string;
  readonly rootDir: string;
}

interface QuarantineSqlRow {
  test_id: string;
  file_path: string | null;
  error_fingerprint: string | null;
  baseline_commit_sha: string;
  classification: "known_failing" | "baseline_flaky";
}

export class SqliteQuarantinedTestsStore implements QuarantinedTestsStorePort {
  private readonly stateDb: ProjectStateDb;

  constructor(options: SqliteQuarantineStoreOptions) {
    this.stateDb = openProjectStateDb(options);
  }

  async replaceAll(rows: readonly QuarantinedTestRow[]): Promise<void> {
    const writer = this.stateDb.writer;
    writer.exec("BEGIN IMMEDIATE");
    try {
      writer.run("DELETE FROM quarantined_tests");
      for (const row of rows) {
        writer.run(
          `INSERT INTO quarantined_tests
             (test_id, file_path, error_fingerprint, baseline_commit_sha, classification)
           VALUES (?, ?, ?, ?, ?)`,
          [
            row.testId,
            row.filePath,
            row.errorFingerprint,
            row.baselineCommitSha,
            row.classification,
          ],
        );
      }
      writer.exec("COMMIT");
    } catch (error) {
      writer.exec("ROLLBACK");
      throw error;
    }
  }

  async listAll(): Promise<readonly QuarantinedTestRow[]> {
    const rows = this.stateDb.writer.all(
      `SELECT test_id, file_path, error_fingerprint, baseline_commit_sha, classification
       FROM quarantined_tests
       ORDER BY test_id`,
    ) as QuarantineSqlRow[];
    return rows.map((row) => ({
      testId: row.test_id,
      filePath: row.file_path,
      errorFingerprint: row.error_fingerprint,
      baselineCommitSha: row.baseline_commit_sha,
      classification: row.classification,
    }));
  }

  close(): void {
    this.stateDb.close();
  }
}
