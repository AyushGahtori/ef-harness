import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasLayoutRepo, bindKnowledgeGraph, openProjectStateDb } from "@ef-harness/db";
import { dispatchCanvasDaemon, openCanvasDaemonSession } from "../../src/canvas/session.js";

const closers: Array<() => Promise<void> | void> = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

describe("canvas daemon session", () => {
  it("persists a pinned canvas coordinate across restart and toggles dictation", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-canvas-daemon-"));
    dirs.push(rootDir);
    const profileDir = path.join(rootDir, "profile");
    const projectId = "C64Daemon";
    const state = openProjectStateDb({ projectId, rootDir });
    closers.unshift(() => {
      if (!state.isClosed()) state.close();
    });
    bindKnowledgeGraph(state).commitChangeSet({
      origin: "kernel",
      author: "tester",
      createdAt: 1,
      nodes: [{ op: "create", id: "F1", kind: "feature", title: "Kitchen", text: "", fields: { feature: "F1" } }],
    });
    const session = openCanvasDaemonSession({ state, profileDir });
    closers.unshift(() => session.close());
    const saved = dispatchCanvasDaemon(session, "canvas.layout.upsert", {
      nodeId: "F1",
      viewLevel: 2,
      x: 220,
      y: 120,
      pinnedByUser: true,
    });
    expect(saved.handled).toBe(true);
    const focus = dispatchCanvasDaemon(session, "composer.focus.begin", {
      draftId: "single-composer",
      inputStartedAt: "2026-01-01T00:00:00.000Z",
      activeTab: "canvas",
      selectedCanvasNodeIds: ["F1"],
      openQuestionCardId: null,
      openQuestionOptionsVersion: null,
      focusedFeatureId: "F1",
      inspectedTaskId: null,
      previewSelectedElement: null,
    });
    expect(focus.handled && focus.result).toMatchObject({
      draftId: "single-composer",
      selectedCanvasNodeIds: ["F1"],
    });
    const recording = await session.setRecording(true);
    expect(recording.recording).toBe(true);
    expect(recording.mode === "os" || recording.mode === "whisper").toBe(true);
    const stopped = await session.setRecording(false);
    expect(stopped.recording).toBe(false);
    await session.close();
    state.close();

    const reopened = openProjectStateDb({ projectId, rootDir });
    closers.unshift(() => {
      if (!reopened.isClosed()) reopened.close();
    });
    expect(new CanvasLayoutRepo(reopened.writer).loadAll(2)).toEqual([
      { nodeId: "F1", viewLevel: 2, x: 220, y: 120, pinnedByUser: true },
    ]);
  });

  it("reads spec outline and canonical impact_walk through canvas IPC", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-canvas-tabs-"));
    dirs.push(rootDir);
    const state = openProjectStateDb({ projectId: "C65Daemon", rootDir });
    closers.unshift(() => {
      if (!state.isClosed()) state.close();
    });
    const session = openCanvasDaemonSession({ state, profileDir: path.join(rootDir, "profile") });
    closers.unshift(() => session.close());
    const inserted = dispatchCanvasDaemon(session, "canvas.tabs.insertNodes", {
      nodes: [
        { id: "F-Orders", kind: "feature", title: "Orders", fields: { feature: "F-Orders", slug: "orders" } },
        {
          id: "R17",
          kind: "decision",
          title: "Cutoff",
          text: "Orders stop at cutoff",
          fields: { feature: "F-Orders", basis: "explicit" },
        },
        { id: "T-05", kind: "task", title: "Order form", fields: { feature: "F-Orders" } },
      ],
    });
    expect(inserted.handled && inserted.result).toEqual({ inserted: 3 });
    const linked = dispatchCanvasDaemon(session, "canvas.tabs.linkEdge", {
      src: "T-05",
      type: "depends_on",
      dst: "R17",
    });
    expect(linked.handled && linked.result).toEqual({ linked: true });
    const outline = dispatchCanvasDaemon(session, "canvas.tabs.readOutline", {});
    expect(outline.handled).toBe(true);
    if (!outline.handled) return;
    const body = outline.result as { decisions: { id: string }[]; features: { id: string }[] };
    expect(body.decisions.map((item) => item.id)).toContain("R17");
    expect(body.features.map((item) => item.id)).toContain("F-Orders");
    const impact = dispatchCanvasDaemon(session, "canvas.intent.impact", { startId: "R17" });
    expect(impact.handled && impact.result).toMatchObject({
      nodes: expect.arrayContaining([
        { id: "R17", depth: 0 },
        { id: "T-05", depth: 1 },
      ]),
    });
    const vocab = dispatchCanvasDaemon(session, "canvas.intent.vocabulary", { heard: "11:15", intended: "11:50" });
    expect(vocab.handled && vocab.result).toMatchObject({ promoted: false, occurrenceCount: 1 });
    const policy = dispatchCanvasDaemon(session, "canvas.intent.autoStart", {
      deltaTasks: 9,
      deltaCostMicroUsd: 0,
      needsOwner: true,
    });
    expect(policy.handled && policy.result).toMatchObject({ needsOwner: true });
  });
});
