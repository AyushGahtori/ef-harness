import { describe, expect, it } from "vitest";
import {
  FreeFormChatRejectedError,
  HandoffRuntime,
  LocalTaskHoldsPort,
  OutOfScopeWriteError,
  RoleAddressError,
  SchemaValidationError,
  assertOwnedWrite,
} from "../../src/handoffs/index.js";
import { clock, tempDbPath } from "./helpers.js";

function ask(requestingTaskId: string, question = "missing field submitted_at") {
  return {
    kind: "ContractClarificationRequest" as const,
    targetRole: "owner:Order",
    targetOwnerTaskId: "W-Owner",
    contractId: "Order",
    requestingTaskId,
    payload: {
      requestingTaskId,
      contractId: "Order",
      question,
    },
  };
}

describe("DurableRoleMailbox", () => {
  it("deduplicates the same owner question and wakes every waiter together", () => {
    const runtime = HandoffRuntime.open({ stateDbPath: ":memory:", now: clock().now });
    const first = runtime.mailbox.submit(ask("T1"));
    const second = runtime.mailbox.submit(ask("T2"));
    const third = runtime.mailbox.submit(ask("T3"));
    expect(second.deduped).toBe(true);
    expect(third.deduped).toBe(true);
    expect(third.message.mailboxId).toBe(first.message.mailboxId);
    expect(third.message.waiters).toEqual(["T1", "T2", "T3"]);
    expect(runtime.mailbox.listOpen("owner:Order")).toHaveLength(1);
    const wakes = runtime.mailbox.resolve(first.message.mailboxId, { answer: "column added" });
    expect(wakes.map((wake) => wake.waiterTaskId)).toEqual(["T1", "T2", "T3"]);
    expect(new Set(wakes.map((wake) => JSON.stringify(wake.resolution))).size).toBe(1);
    expect(runtime.mailbox.listOpen("owner:Order")).toHaveLength(0);
    expect(runtime.mailbox.wakes("T2")[0]?.resolution).toEqual({ answer: "column added" });
    runtime.close();
  });

  it("keeps role-addressed requests for a replacement worker after reopen", () => {
    const stateDbPath = tempDbPath();
    const time = clock();
    const first = HandoffRuntime.open({ stateDbPath, now: time.now });
    const sent = first.mailbox.submit(ask("T1", "who owns dietary_note"));
    expect(() =>
      first.mailbox.submit({
        ...ask("T9"),
        targetRole: "4321",
      }),
    ).toThrow(RoleAddressError);
    expect(() =>
      first.mailbox.submit({
        kind: "chat" as "ContractClarificationRequest",
        targetRole: "owner:Order",
        targetOwnerTaskId: "W-Owner",
        contractId: "Order",
        requestingTaskId: "T9",
        payload: { text: "hello" },
      }),
    ).toThrow(SchemaValidationError);
    first.close();
    const second = HandoffRuntime.open({ stateDbPath, now: time.now });
    const claim = second.mailbox.claim("owner:Order", "W-Owner-2");
    expect(claim.workerId).toBe("W-Owner-2");
    expect(claim.mailboxIds).toEqual([sent.message.mailboxId]);
    expect(second.mailbox.listOpen("owner:Order")[0]?.targetRole).toBe("owner:Order");
    expect(second.db.listClaims("owner:Order").map((item) => item.workerId)).toEqual(["W-Owner-2"]);
    second.close();
  });

  it("escalates when the owner is held, out of turns, or past the ttl", () => {
    const holds = new LocalTaskHoldsPort();
    const time = clock(10_000);
    const runtime = HandoffRuntime.open({
      stateDbPath: ":memory:",
      now: time.now,
      holds,
      ttl: { maxAgeMs: 1_000, maxOwnerTurns: 2 },
    });
    holds.hold("W-Owner");
    const blocked = runtime.mailbox.submit(ask("T1", "blocked question"));
    const escalated = runtime.mailbox.sweep();
    expect(escalated.map((item) => item.mailboxId)).toContain(blocked.message.mailboxId);
    expect(runtime.mailbox.get(blocked.message.mailboxId)?.status).toBe("escalated");
    expect(runtime.mailbox.notices("coordinator").some((notice) => notice.reason === "owner_blocked")).toBe(true);
    expect(runtime.mailbox.notices("user-inbox").some((notice) => notice.reason === "owner_blocked")).toBe(true);
    expect(runtime.mailbox.wakes("T1")[0]?.resolution).toMatchObject({ status: "escalated" });

    holds.release("W-Owner");
    const turning = runtime.mailbox.submit(ask("T4", "turn question"));
    runtime.mailbox.recordOwnerTurn("W-Owner");
    expect(runtime.mailbox.sweep()).toHaveLength(0);
    runtime.mailbox.recordOwnerTurn("W-Owner");
    expect(runtime.mailbox.sweep().map((item) => item.mailboxId)).toContain(turning.message.mailboxId);

    time.advance(1_000);
    const expired = runtime.mailbox.submit(ask("T5", "old question"));
    time.advance(1_000);
    expect(runtime.mailbox.sweep().map((item) => item.mailboxId)).toContain(expired.message.mailboxId);
    expect(runtime.mailbox.notices("user-inbox").some((notice) => notice.reason === "ttl_expired")).toBe(true);
    runtime.close();
  });
});

describe("OwnerResolutionCoordinator", () => {
  it("routes a contract question only to the canonical owner", () => {
    const runtime = HandoffRuntime.open({ stateDbPath: ":memory:", now: clock().now });
    runtime.owners.registerOwner({
      contractId: "MenuItem",
      ownerRole: "owner:MenuItem",
      ownerTaskId: "W-Menu",
    });
    expect(() =>
      runtime.owners.registerOwner({
        contractId: "MenuItem",
        ownerRole: "owner:MenuItem",
        ownerTaskId: "W-Orders",
      }),
    ).toThrow(/canonical owner/);
    const routed = runtime.owners.request({
      requestingTaskId: "W-Orders",
      requestingRole: "worker:orders",
      contractId: "MenuItem",
      kind: "ContractClarificationRequest",
      payload: {
        requestingTaskId: "W-Orders",
        contractId: "MenuItem",
        question: "add dietary_note",
        missingField: "dietary_note",
      },
    });
    expect(routed.targetRole).toBe("owner:MenuItem");
    expect(routed.targetOwnerTaskId).toBe("W-Menu");
    expect(routed.peerMessages).toEqual([]);
    expect(routed.deduped).toBe(false);
    expect(runtime.mailbox.listOpen("worker:menu")).toHaveLength(0);
    expect(runtime.mailbox.listOpen("W-Menu")).toHaveLength(0);
    expect(runtime.mailbox.listOpen("owner:MenuItem")).toHaveLength(1);
    const again = runtime.owners.request({
      requestingTaskId: "W-Reports",
      requestingRole: "worker:reports",
      contractId: "MenuItem",
      kind: "ContractClarificationRequest",
      payload: {
        requestingTaskId: "W-Reports",
        contractId: "MenuItem",
        question: "add dietary_note",
        missingField: "dietary_note",
      },
    });
    expect(again.deduped).toBe(true);
    expect(again.mailbox.waiters).toEqual(["W-Orders", "W-Reports"]);
    expect(() => runtime.surface.dispatch("send_message", { taskId: "W-Orders", role: "worker:orders" }, { to: "W-Menu", text: "hey" })).toThrow(
      FreeFormChatRejectedError,
    );
    expect(() => assertOwnedWrite("packages/menu/MenuItem.ts", ["packages/orders/**"])).toThrow(OutOfScopeWriteError);
    expect(() => assertOwnedWrite("packages/orders/totals.ts", ["packages/orders/**"])).not.toThrow();
    runtime.close();
  });
});
