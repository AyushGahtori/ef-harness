import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasLayoutNodeMissingError, CanvasLayoutRepo } from "../../src/canvas/index.js";
import { bindKnowledgeGraph } from "../../src/knowledge/index.js";
import { openProjectStateDb } from "../../src/state-db/index.js";

const closers: Array<() => void> = [];
const dirs: string[] = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function openState(projectId: string) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-canvas-layout-"));
  dirs.push(rootDir);
  const state = openProjectStateDb({ projectId, rootDir });
  closers.unshift(() => {
    if (!state.isClosed()) state.close();
  });
  return { rootDir, state };
}

describe("canvas_layout persistence", () => {
  it("keeps a user-pinned coordinate after the state database is reopened", () => {
    const projectId = "C64Canvas";
    const first = openState(projectId);
    bindKnowledgeGraph(first.state).commitChangeSet({
      origin: "kernel",
      author: "tester",
      createdAt: 1,
      nodes: [{ op: "create", id: "F1", kind: "feature", title: "Kitchen", text: "", fields: { feature: "F1" } }],
    });
    const repo = new CanvasLayoutRepo(first.state.writer);
    repo.upsert({ nodeId: "F1", viewLevel: 2, x: 220, y: 120, pinnedByUser: true });
    repo.upsert({ nodeId: "F1", viewLevel: 2, x: 40, y: 16, pinnedByUser: false });
    repo.upsert({ nodeId: "F1", viewLevel: 2, x: 220, y: 120, pinnedByUser: true });
    first.state.close();

    const second = openProjectStateDb({ projectId, rootDir: first.rootDir });
    closers.unshift(() => {
      if (!second.isClosed()) second.close();
    });
    const loaded = new CanvasLayoutRepo(second.writer).loadAll(2);
    expect(loaded).toEqual([{ nodeId: "F1", viewLevel: 2, x: 220, y: 120, pinnedByUser: true }]);
  });

  it("refuses a pin for a node that is not in state.db", () => {
    const { state } = openState("C64CanvasMissing");
    const repo = new CanvasLayoutRepo(state.writer);
    expect(() => repo.upsert({ nodeId: "missing", viewLevel: 1, x: 1, y: 2, pinnedByUser: true })).toThrow(
      CanvasLayoutNodeMissingError,
    );
  });
});
