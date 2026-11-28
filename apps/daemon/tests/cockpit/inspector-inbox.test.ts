import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openProjectStateDb, GlobalBrokerDb } from "@ef-harness/db";

import {
  fetchDiffRange,
  fetchLogChunk,
  locateLineWindow,
  readResult,
  sliceForTask,
  type InspectorInboxContext,
} from "../../src/cockpit/inspector-inbox.js";
import type { SqlDb, SqlStatement } from "../../src/bootstrap/databases.js";

const closers: Array<() => void> = [];
const dirs: string[] = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("inspector and inbox rpc", () => {
  it("returns a diff range, a capped log window, and a slicer manifest", () => {
    const ctx = openContext();
    const diff = fetchDiffRange(ctx, { attemptId: "att-1", filePath: "src/print.ts", hunkOffset: 0, limit: 1 }) as {
      hunks: unknown[];
      channel: number;
    };
    expect(diff.hunks).toHaveLength(1);
    expect(diff.channel).toBe(0);

    const artifact = path.join(ctx.profileDir, "artifacts");
    fs.mkdirSync(artifact, { recursive: true });
    fs.writeFileSync(path.join(artifact, "log-1"), "one\ntwo\nthree\n");
    const located = locateLineWindow(ctx, {
      artifactId: "log-1",
      startLine: 2,
      maxLines: 2,
      maxBytes: 64,
    }) as { startLine: number; lines: string[]; framesDecompressed: number };
    expect(located.startLine).toBe(2);
    expect(located.lines[0]).toBe("two");
    expect(located.framesDecompressed).toBeGreaterThanOrEqual(0);

    const chunk = fetchLogChunk(ctx, { artifactId: "log-1", byteOffset: 0, limit: 4 }) as { totalBytes: number };
    expect(chunk.totalBytes).toBeGreaterThan(4);

    ctx.state
      .prepare(
        "INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES ('CS-1', 1, 'kernel', 'c50', 0)",
      )
      .run();
    ctx.state
      .prepare(
        `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
         VALUES ('T50', 'task', 1, 'h-T50', 'Print', 'Print the page', '{}', 'CS-1', 1, 1)`,
      )
      .run();
    const sliced = sliceForTask(ctx, { taskId: "T50" }) as { taskId: string; sliceSha256: string; text: string };
    expect(sliced.taskId).toBe("T50");
    expect(sliced.sliceSha256.length).toBeGreaterThan(8);
    expect(sliced.text).toContain("Print");

    expect(readResult(ctx, { handoffId: "HO-missing", taskId: "T50", role: "implementer" })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });
});

function openContext(): InspectorInboxContext {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-c50-inspector-"));
  dirs.push(rootDir);
  const projectId = `c50-${process.pid}`;
  const project = openProjectStateDb({ projectId, rootDir, appVersion: "0.0.0" });
  const broker = GlobalBrokerDb.open({ root: rootDir });
  closers.push(() => {
    project.close();
    broker.close();
  });
  return {
    state: asSql(project.writer),
    project,
    broker,
    profileDir: rootDir,
    diffFile: "src/print.ts",
    diffHunks: [
      {
        index: 0,
        header: "@@ -1 +1 @@",
        lines: [{ kind: "add", text: "+export const ready = 1;" }],
      },
    ],
  };
}

function asSql(conn: { exec(sql: string): void; prepare(sql: string): { run(params?: unknown): { changes: number }; get(params?: unknown): unknown; all(params?: unknown): unknown[] } }): SqlDb {
  return {
    exec(sql: string): void {
      conn.exec(sql);
    },
    prepare(sql: string): SqlStatement {
      const statement = conn.prepare(sql);
      return {
        run(...params: readonly unknown[]): void {
          statement.run(params.length === 0 ? undefined : params);
        },
        get(...params: readonly unknown[]): unknown {
          return statement.get(params.length === 0 ? undefined : params);
        },
        all(...params: readonly unknown[]): unknown[] {
          return statement.all(params.length === 0 ? undefined : params);
        },
      };
    },
  };
}
