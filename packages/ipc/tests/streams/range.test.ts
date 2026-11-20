import { describe, expect, it } from "vitest";
import { JSON_RPC_MAX_BYTES } from "../../src/streams/constants.js";
import { ArtifactNotFoundError, PayloadExceedsJsonCapError } from "../../src/streams/errors.js";
import { jsonByteLength } from "../../src/streams/json-guard.js";
import type { ArtifactLogReader, DiffHunkBody, DiffSource, DiffSummary } from "../../src/streams/ports.js";
import { RangeDiffHandler } from "../../src/streams/range-diff-handler.js";
import { RangeLogHandler } from "../../src/streams/range-log-handler.js";

function header(index: number): DiffSummary["hunks"][number] {
  return {
    index,
    header: `@@ -${String(index)},1 +${String(index)},1 @@`,
    oldStart: index,
    oldCount: 1,
    newStart: index,
    newCount: 1,
    insertions: 1,
    deletions: 0,
  };
}

describe("viewport log and diff handlers", () => {
  it("delegates log.range and log.search without widening the requested span", async () => {
    const calls: Array<{ method: string; args: readonly unknown[] }> = [];
    const logs: ArtifactLogReader = {
      readLogRange(artifactId, startLine, endLine) {
        calls.push({ method: "readLogRange", args: [artifactId, startLine, endLine] });
        if (endLine - startLine > 5) throw new Error("handler requested more than the viewport");
        return {
          lines: ["line-10", "line-11"],
          totalLines: 5000,
          truncated: false,
          framesDecompressed: 1,
          indexSource: "sidecar",
        };
      },
      queryLogStream(artifactId, pattern, maxMatches) {
        calls.push({ method: "queryLogStream", args: [artifactId, pattern, maxMatches] });
        return {
          matches: [{ lineNumber: 4, text: "match" }],
          truncated: false,
          capped: true,
          framesDecompressed: 1,
        };
      },
    };
    const handler = new RangeLogHandler(logs, (artifactId) => artifactId === "log-1");
    const range = await handler.logRange({ artifactId: "log-1", startLine: 10, endLine: 11 });
    expect(range.lines).toEqual(["line-10", "line-11"]);
    expect(calls[0]).toEqual({ method: "readLogRange", args: ["log-1", 10, 11] });
    const search = await handler.logSearch({ artifactId: "log-1", query: "match", maxMatches: 3 });
    expect(search.matches).toEqual([{ lineNumber: 4, text: "match" }]);
    expect(calls[1]).toEqual({ method: "queryLogStream", args: ["log-1", "match", 3] });
    await expect(handler.logRange({ artifactId: "other", startLine: 1, endLine: 1 })).rejects.toBeInstanceOf(
      ArtifactNotFoundError,
    );
  });

  it("returns hunk headers first and loads only the requested hunk bodies", async () => {
    const hunks = Array.from({ length: 5000 }, (_, index) => header(index));
    let readIndexes: readonly number[] | null = null;
    const diffs: DiffSource = {
      summarize(projectId) {
        if (projectId !== "proj-a") return null;
        const summary: DiffSummary = {
          projectId,
          path: "src/app.ts",
          insertions: 5000,
          deletions: 20,
          hunks,
        };
        return summary;
      },
      readHunks(_projectId, _task, _file, indexes) {
        readIndexes = indexes;
        return indexes.map((index): DiffHunkBody => ({ ...header(index), lines: ["+visible"] }));
      },
    };
    const handler = new RangeDiffHandler("proj-a", diffs);
    const summary = await handler.diffGet({ task: "task-9", file: "src/app.ts" });
    expect(summary.bodies).toBe("omitted");
    expect(summary.hunks).toHaveLength(5000);
    expect(summary.insertions).toBe(5000);
    expect(summary.hunks.every((hunk) => hunk.lines === undefined)).toBe(true);
    expect(jsonByteLength(summary)).toBeLessThan(JSON_RPC_MAX_BYTES);
    expect(readIndexes).toBeNull();

    const viewport = await handler.diffGet({ task: "task-9", file: "src/app.ts", hunks: [3] });
    expect(readIndexes).toEqual([3]);
    expect(viewport.bodies).toBe("viewport");
    expect(viewport.hunks[3]?.lines).toEqual(["+visible"]);
    expect(viewport.hunks[0]?.lines).toBeUndefined();

    const huge: DiffSource = {
      summarize: () => ({
        projectId: "proj-a",
        path: "src/huge.ts",
        insertions: 1,
        deletions: 0,
        hunks: [header(0)],
      }),
      readHunks: () => [{ ...header(0), lines: ["+".concat("x".repeat(200)).repeat(20)] }],
    };
    const overflowing = new RangeDiffHandler("proj-a", huge);
    const lines = Array.from({ length: 8000 }, () => "x".repeat(200));
    const fat: DiffSource = {
      summarize: () => ({
        projectId: "proj-a",
        path: "src/huge.ts",
        insertions: lines.length,
        deletions: 0,
        hunks: [header(0)],
      }),
      readHunks: () => [{ ...header(0), lines }],
    };
    await expect(
      new RangeDiffHandler("proj-a", fat).diffGet({ task: "task-9", file: "src/huge.ts", hunks: [0] }),
    ).rejects.toBeInstanceOf(PayloadExceedsJsonCapError);
    await expect(overflowing.diffGet({ task: "task-9", file: "src/huge.ts" })).resolves.toMatchObject({
      bodies: "omitted",
    });

    const other = new RangeDiffHandler("proj-b", diffs);
    await expect(other.diffGet({ task: "task-9", file: "src/app.ts" })).rejects.toBeInstanceOf(
      ArtifactNotFoundError,
    );
    let bodiesRead = false;
    const leaky: DiffSource = {
      summarize: () => ({
        projectId: "proj-a",
        path: "src/app.ts",
        insertions: 1,
        deletions: 0,
        hunks: [header(0)],
      }),
      readHunks: () => {
        bodiesRead = true;
        return [];
      },
    };
    await expect(
      new RangeDiffHandler("proj-b", leaky).diffGet({ task: "task-9", file: "src/app.ts", hunks: [0] }),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError);
    expect(bodiesRead).toBe(false);
  });
});
