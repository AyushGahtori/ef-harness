import { describe, expect, it } from "vitest";
import { HandoffRuntime } from "../../src/handoffs/index.js";
import { BASE, SLICE, clock, handoffInput } from "./helpers.js";

describe("HandoffAuditTrail", () => {
  it("reconstructs planner to merge-queue lineage", () => {
    const runtime = HandoffRuntime.open({ stateDbPath: ":memory:", now: clock().now });
    runtime.store.put(
      handoffInput("HO-P", {
        fromRole: "planner",
        toRole: "worker:T-1",
        fromTaskId: "planner-task",
        toTaskId: "T-1",
        artifactType: "planner_to_worker",
      }),
    );
    runtime.store.put(
      handoffInput("HO-W", {
        fromRole: "worker:T-1",
        toRole: "verifier",
        fromTaskId: "T-1",
        toTaskId: "verifier-task",
        artifactType: "worker_to_verifier",
        priorHandoffId: "HO-P",
        summary: { headline: "candidate" },
        payload: Buffer.from("candidate"),
      }),
    );
    runtime.store.put(
      handoffInput("HO-V", {
        fromRole: "verifier",
        toRole: "feature-integrator",
        fromTaskId: "verifier-task",
        toTaskId: "integrator-task",
        artifactType: "verification_receipt",
        priorHandoffId: "HO-W",
        summary: { headline: "verified" },
        payload: Buffer.from("verified"),
      }),
    );
    runtime.store.put(
      handoffInput("HO-I", {
        fromRole: "feature-integrator",
        toRole: "merge-queue",
        fromTaskId: "integrator-task",
        toTaskId: "merge-task",
        artifactType: "feature_to_merge_queue",
        priorHandoffId: "HO-V",
        summary: { headline: "ready" },
        payload: Buffer.from("ready"),
      }),
    );
    const lineage = runtime.audit.lineage("HO-I");
    expect(lineage.artifacts.map((artifact) => artifact.handoffId)).toEqual(["HO-P", "HO-W", "HO-V", "HO-I"]);
    expect(lineage.roles).toEqual(["planner", "worker:T-1", "verifier", "feature-integrator", "merge-queue"]);
    expect(runtime.audit.forTask("T-1").map((artifact) => artifact.handoffId)).toEqual(["HO-P", "HO-W"]);
    expect(lineage.artifacts[0]?.pinnedBaseCommitSha).toBe(BASE);
    expect(lineage.artifacts[0]?.pinnedSliceSha256).toBe(SLICE);
    runtime.close();
  });
});
