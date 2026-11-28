import { describe, expect, it } from "vitest";
import { HandoffRuntime, WaitGraphDeadlockError, minimalCycle } from "../../src/handoffs/index.js";
import { clock } from "./helpers.js";

function clarification(requestingTaskId: string, ownerTaskId: string, question: string) {
  return {
    kind: "ContractClarificationRequest" as const,
    targetRole: `owner:${ownerTaskId}`,
    targetOwnerTaskId: ownerTaskId,
    contractId: "Order",
    requestingTaskId,
    payload: {
      requestingTaskId,
      contractId: "Order",
      question,
    },
  };
}

describe("WaitGraphCycleDetector", () => {
  it("finds the minimal cycle before the new edge is committed", () => {
    expect(minimalCycle([{ kind: "waits_on", fromNode: "A", toNode: "B" }], "B", "A")).toEqual(["B", "A", "B"]);
    expect(
      minimalCycle(
        [
          { kind: "waits_on", fromNode: "A", toNode: "B" },
          { kind: "depends_on", fromNode: "B", toNode: "C" },
          { kind: "waits_on", fromNode: "C", toNode: "A" },
        ],
        "D",
        "A",
      ),
    ).toBeNull();
  });

  it("rejects a 2-node wait and a 4-node wait before either edge is stored", () => {
    const runtime = HandoffRuntime.open({ stateDbPath: ":memory:", now: clock().now });
    runtime.mailbox.submit(clarification("W-A", "W-B", "need MenuItem.dietary_note"));
    expect(() => runtime.mailbox.submit(clarification("W-B", "W-A", "need Order.total"))).toThrow(WaitGraphDeadlockError);
    expect(runtime.waitGraph.hasEdge("waits_on", "W-B", "W-A")).toBe(false);
    expect(runtime.waitGraph.hasEdge("waits_on", "W-A", "W-B")).toBe(true);
    const mutual = runtime.waitGraph.breaks()[0];
    expect(mutual?.cycle).toEqual(["W-B", "W-A", "W-B"]);
    expect(mutual?.escalatedTo).toBe("coordinator");
    expect(runtime.mailbox.notices("coordinator").some((notice) => notice.reason === "wait_graph_deadlock")).toBe(true);
    expect(runtime.mailbox.notices("contract-owner").length).toBeGreaterThan(0);

    runtime.waitGraph.addWait("A", "B");
    runtime.waitGraph.addWait("B", "C");
    runtime.waitGraph.addWait("C", "D");
    expect(() => runtime.waitGraph.addWait("D", "A")).toThrow(WaitGraphDeadlockError);
    expect(runtime.waitGraph.hasEdge("waits_on", "D", "A")).toBe(false);
    expect(runtime.waitGraph.breaks().at(-1)?.cycle).toEqual(["D", "A", "B", "C", "D"]);

    runtime.waitGraph.addWait("P", "Q");
    runtime.waitGraph.addWait("Q", "R");
    expect(() => runtime.waitGraph.addWait("R", "P")).toThrow(WaitGraphDeadlockError);
    expect(runtime.waitGraph.breaks().at(-1)?.cycle).toEqual(["R", "P", "Q", "R"]);
    runtime.close();
  });

  it("treats depends_on edges as part of the wait graph", () => {
    const runtime = HandoffRuntime.open({ stateDbPath: ":memory:", now: clock().now });
    runtime.waitGraph.addDependsOn("W-A", "W-B");
    expect(() => runtime.waitGraph.addWait("W-B", "W-A")).toThrow(WaitGraphDeadlockError);
    expect(runtime.waitGraph.hasEdge("waits_on", "W-B", "W-A")).toBe(false);
    runtime.close();
  });

  it("escalates a human decision to the developer inbox", () => {
    const runtime = HandoffRuntime.open({
      stateDbPath: ":memory:",
      now: clock().now,
      needsHumanDecision: () => true,
    });
    runtime.waitGraph.addWait("W-A", "W-B");
    expect(() => runtime.waitGraph.addWait("W-B", "W-A")).toThrow(WaitGraphDeadlockError);
    expect(runtime.waitGraph.breaks()[0]?.escalatedTo).toBe("developer");
    expect(runtime.mailbox.notices("user-inbox").length).toBeGreaterThan(0);
    runtime.close();
  });
});
