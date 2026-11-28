import { describe, expect, it } from "vitest";
import {
  FreeFormChatRejectedError,
  HandoffRuntime,
  READ_RESULT_MAX_BYTES,
  RangeLimitError,
  SUMMARY_PREVIEW_MAX_BYTES,
} from "../../src/handoffs/index.js";
import { clock, handoffInput, tempDbPath, trace } from "./helpers.js";

const MISS = JSON.stringify({ ok: false, code: "NOT_FOUND" });

describe("harness.read_result", () => {
  it("returns the same NOT_FOUND for missing, sealed, and unauthorized reads", () => {
    const runtime = HandoffRuntime.open({ stateDbPath: ":memory:", now: clock().now });
    runtime.store.put(handoffInput("HO-1"));
    runtime.store.put(
      handoffInput("HO-ORACLE-99", {
        fromRole: "verifier",
        toRole: "worker:T-1",
        fromTaskId: "verifier-task",
        toTaskId: "T-1",
        artifactType: "sealed_oracle",
        summary: { hidden: "do not leak" },
        payload: Buffer.from("oracle-secret"),
      }),
    );
    const caller = { taskId: "T-1", role: "worker:T-1" };
    const stranger = { taskId: "W-Menu", role: "worker:menu" };
    const missing = runtime.readResult.read(caller, { handoff_id: "HO-MISSING" });
    const sealed = runtime.readResult.read(caller, { handoff_id: "HO-ORACLE-99", range: { offset: 0, limit: 4 } });
    const hidden = runtime.readResult.read(stranger, { handoff_id: "HO-1" });
    expect(JSON.stringify(missing)).toBe(MISS);
    expect(JSON.stringify(sealed)).toBe(MISS);
    expect(JSON.stringify(hidden)).toBe(MISS);
    expect(Object.keys(sealed)).toEqual(["ok", "code"]);
    const allowed = runtime.readResult.read(caller, { handoff_id: "HO-1" });
    expect(allowed).toMatchObject({ ok: true, mode: "summary", summary: { headline: "order totals" } });
    runtime.waitGraph.addDependsOn("W-Reports", "planner-task");
    const dependent = runtime.readResult.read(
      { taskId: "W-Reports", role: "worker:reports" },
      { handoff_id: "HO-1" },
    );
    expect(dependent).toMatchObject({ ok: true, mode: "summary" });
    runtime.close();
  });

  it("serves a small summary by default and paginates the raw blob at 16 KB", () => {
    const runtime = HandoffRuntime.open({ stateDbPath: tempDbPath(), now: clock().now });
    const payload = trace(2 * 1024 * 1024);
    runtime.store.put(
      handoffInput("HO-TRACE", {
        summary: { headline: "2 MB test trace", bytes: payload.byteLength },
        payload,
      }),
    );
    const caller = { taskId: "T-1", role: "worker:T-1" };
    const summary = runtime.readResult.read(caller, { handoff_id: "HO-TRACE" });
    expect(summary).toMatchObject({
      ok: true,
      mode: "summary",
      truncated: false,
      manifest: { blobBytes: payload.byteLength },
    });
    if (summary.ok && summary.mode === "summary") {
      expect(summary.summaryBytes).toBeLessThanOrEqual(SUMMARY_PREVIEW_MAX_BYTES);
      expect(JSON.stringify(summary).length).toBeLessThan(4_096);
    }
    const page = runtime.surface.dispatch(runtime.surface.toolNames[0], caller, {
      handoff_id: "HO-TRACE",
      range: { offset: 0, limit: READ_RESULT_MAX_BYTES },
    });
    expect(page).toMatchObject({ ok: true, mode: "range", returned: READ_RESULT_MAX_BYTES });
    if (page.ok && page.mode === "range") {
      expect(page.bytes[0]).toBe(0);
      expect(page.bytes.byteLength).toBe(READ_RESULT_MAX_BYTES);
    }
    const next = runtime.readResult.read(caller, {
      handoff_id: "HO-TRACE",
      range: { offset: READ_RESULT_MAX_BYTES, limit: READ_RESULT_MAX_BYTES },
    });
    if (next.ok && next.mode === "range") {
      expect(next.bytes[0]).toBe(READ_RESULT_MAX_BYTES % 251);
    }
    expect(() =>
      runtime.readResult.read(caller, {
        handoff_id: "HO-TRACE",
        range: { offset: 0, limit: READ_RESULT_MAX_BYTES + 1 },
      }),
    ).toThrow(RangeLimitError);
    expect(() => runtime.surface.dispatch("harness.peer_chat", caller, { to: "W-Menu", text: "add the field" })).toThrow(
      FreeFormChatRejectedError,
    );
    expect(runtime.surface.toolNames).toEqual(["harness.read_result"]);
    runtime.close();
  });
});
