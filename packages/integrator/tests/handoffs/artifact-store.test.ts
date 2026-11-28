import { describe, expect, it } from "vitest";
import {
  CatalogSlicePinPort,
  HandoffRuntime,
  ImmutableHandoffError,
  InvalidPinError,
  MemoryCasBlobStore,
  PinMismatchError,
  SchemaValidationError,
  UnverifiedSliceError,
  type ArtifactType,
} from "../../src/handoffs/index.js";
import { BASE, BASE_NEXT, SLICE, SLICE_NEXT, clock, handoffInput, tempDbPath } from "./helpers.js";

describe("ArtifactHandoffStore", () => {
  it("stores an immutable content-addressed handoff pinned to base and slice", () => {
    const cas = new MemoryCasBlobStore();
    const runtime = HandoffRuntime.open({ stateDbPath: ":memory:", cas, now: clock().now });
    const stored = runtime.store.put(handoffInput("HO-1"));
    expect(stored.blobSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.pinnedBaseCommitSha).toBe(BASE);
    expect(stored.pinnedSliceSha256).toBe(SLICE);
    expect(cas.puts).toHaveLength(1);
    expect(Buffer.from(runtime.store.readBlob(stored.blobSha256))).toEqual(Buffer.from("totals-v1"));
    expect(() => runtime.store.put(handoffInput("HO-1"))).toThrow(ImmutableHandoffError);
    const attempt = runtime.store.bindAttempt({
      attemptId: "AT-1",
      taskId: "T-1",
      role: "worker:T-1",
      workerId: "W-1",
      pinnedBaseCommitSha: BASE,
      pinnedSliceSha256: SLICE,
      handoffId: "HO-1",
    });
    expect(attempt.boundHandoffId).toBe("HO-1");
    expect(() =>
      runtime.store.bindAttempt({
        attemptId: "AT-2",
        taskId: "T-1",
        role: "worker:T-1",
        workerId: "W-1",
        pinnedBaseCommitSha: BASE_NEXT,
        pinnedSliceSha256: SLICE,
        handoffId: "HO-1",
      }),
    ).toThrow(PinMismatchError);
    expect(runtime.db.getAttempt("AT-2")).toBeNull();
    runtime.close();
  });

  it("rejects unpinned digests, unknown slices, and free-form artifact types", () => {
    const slices = new CatalogSlicePinPort(new Set([SLICE]));
    const runtime = HandoffRuntime.open({ stateDbPath: ":memory:", slices, now: clock().now });
    expect(() => runtime.store.put(handoffInput("HO-BAD", { pinnedBaseCommitSha: "abc" }))).toThrow(InvalidPinError);
    expect(() => runtime.store.put(handoffInput("HO-SLICE", { pinnedSliceSha256: SLICE_NEXT }))).toThrow(
      UnverifiedSliceError,
    );
    expect(() =>
      runtime.store.put(handoffInput("HO-CHAT", { artifactType: "chat" as ArtifactType })),
    ).toThrow(SchemaValidationError);
    runtime.close();
  });

  it("stamps superseded_by, keeps the old CAS bytes, and wakes watchers with the fresh pins", () => {
    const time = clock();
    const runtime = HandoffRuntime.open({ stateDbPath: ":memory:", now: time.now });
    const original = runtime.store.put(handoffInput("HO-1"));
    runtime.store.watch("HO-1", "T-1");
    runtime.store.bindAttempt({
      attemptId: "AT-1",
      taskId: "T-1",
      role: "worker:T-1",
      workerId: "W-1",
      pinnedBaseCommitSha: BASE,
      pinnedSliceSha256: SLICE,
      handoffId: "HO-1",
    });
    time.advance(5);
    const next = runtime.store.supersede("HO-1", {
      handoffId: "HO-2",
      fromRole: "planner",
      toRole: "worker:T-1",
      fromTaskId: "planner-task",
      toTaskId: "T-1",
      artifactType: "planner_to_worker",
      pinnedBaseCommitSha: BASE_NEXT,
      pinnedSliceSha256: SLICE_NEXT,
      schemaVersion: 2,
      summary: { headline: "order totals revised" },
      payload: Buffer.from("totals-v2"),
    });
    const old = runtime.store.require("HO-1");
    expect(old.summary).toEqual({ headline: "order totals" });
    expect(old.blobSha256).toBe(original.blobSha256);
    expect(old.supersededBy).toBe("HO-2");
    expect(Buffer.from(runtime.store.readBlob(old.blobSha256))).toEqual(Buffer.from("totals-v1"));
    expect(next.artifact.supersedes).toBe("HO-1");
    expect(next.artifact.priorHandoffId).toBe("HO-1");
    expect(next.wakes).toEqual([
      expect.objectContaining({
        taskId: "T-1",
        previousHandoffId: "HO-1",
        freshHandoffId: "HO-2",
        freshPinnedBaseCommitSha: BASE_NEXT,
        freshPinnedSliceSha256: SLICE_NEXT,
      }),
    ]);
    expect(runtime.db.getAttempt("AT-1")?.pinnedBaseCommitSha).toBe(BASE);
    expect(runtime.db.getAttempt("AT-1")?.pinnedSliceSha256).toBe(SLICE);
    expect(() =>
      runtime.store.supersede("HO-1", {
        handoffId: "HO-3",
        fromRole: "planner",
        toRole: "worker:T-1",
        fromTaskId: "planner-task",
        toTaskId: "T-1",
        artifactType: "planner_to_worker",
        pinnedBaseCommitSha: BASE_NEXT,
        pinnedSliceSha256: SLICE_NEXT,
        schemaVersion: 3,
        summary: { headline: "again" },
        payload: Buffer.from("totals-v3"),
      }),
    ).toThrow(ImmutableHandoffError);
    runtime.close();
  });

  it("keeps payloads in the content-addressed store and pointer rows in state.db", () => {
    const runtime = HandoffRuntime.open({ stateDbPath: ":memory:", now: clock().now });
    const stored = runtime.store.put(handoffInput("HO-CAS"));
    expect(stored.blobSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(runtime.db.tables()).toContain("handoff_artifacts");
    expect(runtime.db.tables()).toContain("role_mailbox");
    expect(runtime.db.tables()).not.toContain("cas_blobs");
    expect(runtime.db.tables()).not.toContain("graph_edges");
    expect(runtime.db.tables()).not.toContain("contract_owners");
    runtime.waitGraph.addDependsOn("planner-task", "T-1");
    expect(runtime.waitGraph.hasEdge("depends_on", "planner-task", "T-1")).toBe(true);
    runtime.close();
  });

  it("reopens the same state.db and still returns the pinned blob", () => {
    const stateDbPath = tempDbPath();
    const time = clock();
    const first = HandoffRuntime.open({ stateDbPath, now: time.now });
    const stored = first.store.put(handoffInput("HO-RESTART"));
    first.close();
    const second = HandoffRuntime.open({ stateDbPath, now: time.now });
    const reloaded = second.store.require("HO-RESTART");
    expect(reloaded.blobSha256).toBe(stored.blobSha256);
    expect(Buffer.from(second.store.readBlob(reloaded.blobSha256))).toEqual(Buffer.from("totals-v1"));
    second.close();
  });
});
