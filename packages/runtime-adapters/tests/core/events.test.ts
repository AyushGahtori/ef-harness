import { describe, expect, it } from "vitest";
import {
  AGENT_RUNTIME_ADAPTER_METHODS,
  BOARD_CONSUMER,
  INSPECTOR_CONSUMER,
  LocalPacketSecurityRedactor,
  LocalWorkerEventSchema,
  NORMALIZED_EVENT_TYPES,
  NormalizedRuntimeEventBus,
  normalizeUsage,
} from "../../src/core/index.js";

describe("NormalizedRuntimeEventBus", () => {
  it("keeps the canonical 13-event taxonomy and the 10-method adapter contract", () => {
    expect([...NORMALIZED_EVENT_TYPES]).toEqual([
      "turn_started",
      "assistant_delta",
      "tool_call_requested",
      "tool_call_started",
      "tool_call_finished",
      "file_edited",
      "permission_requested",
      "permission_decided",
      "usage_reported",
      "rate_limited",
      "turn_completed",
      "session_error",
      "session_exited",
    ]);
    expect([...AGENT_RUNTIME_ADAPTER_METHODS]).toEqual([
      "probe",
      "authStatus",
      "startSession",
      "sendTurn",
      "steer",
      "interrupt",
      "resume",
      "events",
      "respondPermission",
      "usage",
    ]);
  });

  it("maps ACP, Codex, Claude, Copilot, Cursor, and worker streams into one taxonomy", () => {
    const bus = new NormalizedRuntimeEventBus(new LocalPacketSecurityRedactor(), () => "2026-01-01T00:00:00.000Z");
    const acp = bus.ingest("s", {
      source: "acp",
      method: "session/update",
      params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } } },
    });
    expect(acp.map((event) => event.type)).toEqual(["assistant_delta"]);

    const plan = bus.ingest("s", {
      source: "acp",
      method: "session/update",
      params: { update: { sessionUpdate: "plan", entries: [{ content: "edit orders" }] } },
    });
    expect(plan[0]?.type).toBe("assistant_delta");
    if (plan[0]?.type === "assistant_delta") expect(plan[0].channel).toBe("plan");

    const codex = bus.ingest("s", {
      source: "codex",
      method: "item/commandExecution",
      params: { id: "c1", command: "vitest", status: "in_progress" },
    });
    expect(codex[0]?.type).toBe("tool_call_started");

    const claude = bus.ingest("s", {
      source: "claude",
      event: {
        type: "assistant",
        message: { content: [{ type: "text", text: "thinking" }, { type: "tool_use", id: "t1", name: "Edit" }] },
      },
    });
    expect(claude.map((event) => event.type)).toEqual(["assistant_delta", "tool_call_requested"]);

    const result = bus.ingest("s", {
      source: "claude",
      event: {
        type: "result",
        stop_reason: "end_turn",
        total_cost_usd: 2,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 3,
          cache_creation_input_tokens: 1,
        },
      },
    });
    expect(result.map((event) => event.type)).toEqual(["usage_reported", "turn_completed"]);
    if (result[0]?.type === "usage_reported") {
      expect(result[0].usage).toMatchObject({
        inputTokens: 10,
        cachedInputTokens: 4,
        outputTokens: 5,
        cacheReadInputTokens: 3,
        cacheCreationInputTokens: 1,
        costMicroUsd: 2_000_000,
      });
    }

    const copilot = bus.ingest("s", {
      source: "copilot",
      event: { type: "usage", metrics: { promptTokens: 9, completionTokens: 8, cachedTokens: 3 } },
    });
    if (copilot[0]?.type === "usage_reported") {
      expect(copilot[0].usage).toMatchObject({ inputTokens: 9, outputTokens: 8, cachedInputTokens: 3 });
    }

    const cursor = bus.ingest("s", {
      source: "cursor",
      event: {
        type: "usage",
        usage: { inputTokens: 6, outputTokens: 1, reasoningTokens: 5, cacheReadTokens: 2 },
      },
    });
    if (cursor[0]?.type === "usage_reported") {
      expect(cursor[0].usage).toMatchObject({
        inputTokens: 6,
        outputTokens: 1,
        reasoningTokens: 5,
        cachedInputTokens: 2,
      });
    }

    const openai = normalizeUsage({
      input_tokens: 11,
      output_tokens: 7,
      input_tokens_details: { cached_tokens: 4 },
      output_tokens_details: { reasoning_tokens: 2 },
    });
    expect(openai).toMatchObject({
      inputTokens: 11,
      outputTokens: 7,
      cachedInputTokens: 4,
      reasoningTokens: 2,
    });

    const worker = bus.ingest("s", { source: "worker", event: { type: "message.delta", text: "native" } });
    expect(worker[0]?.type).toBe("assistant_delta");

    const limited = bus.ingest("s", {
      source: "codex",
      method: "account/rateLimits/read",
      params: { primary: { usedPercent: 92, resetsAt: "2026-01-02T00:00:00.000Z" } },
    });
    expect(limited[0]?.type).toBe("rate_limited");
    if (limited[0]?.type === "rate_limited") expect(limited[0].usedPercent).toBe(92);

    const crashed = bus.ingest("s", { source: "codex", method: "exit", params: { exitCode: 137 } });
    expect(crashed[0]?.type).toBe("session_exited");
    if (crashed[0]?.type === "session_exited") {
      expect(crashed[0].disposition).toBe("abnormal");
      expect(crashed[0].handoff).toBe("Task 150");
    }
    const accessViolation = bus.ingest("s", {
      source: "codex",
      method: "exit",
      params: { exitCode: 0xc0000005 },
    });
    if (accessViolation[0]?.type === "session_exited") expect(accessViolation[0].disposition).toBe("abnormal");

    const ignored = bus.ingest("s", {
      source: "claude",
      event: { type: "system", subtype: "init", session_id: "s" },
    });
    expect(ignored).toEqual([]);
    expect(bus.ignoredCount).toBeGreaterThan(0);
  });

  it("projects events into event@1 worker records for the board and inspector", () => {
    const bus = new NormalizedRuntimeEventBus(new LocalPacketSecurityRedactor(), () => "2026-01-01T00:00:00.000Z");
    const schema = new LocalWorkerEventSchema();
    bus.ingest("worker-1", {
      source: "worker",
      event: { type: "file.changed", paths: ["src/api/orders.ts"] },
    });
    bus.ingest("worker-1", {
      source: "codex",
      method: "item/commandExecution",
      params: { command: "vitest", status: "in_progress" },
    });
    const records = bus.workerHistory("worker-1").map((event) => schema.validate(event));
    expect(records[0]?.payload.statusLine).toBe("Editing src/api/orders.ts");
    expect(records[1]?.payload.statusLine).toBe("Running vitest");
    for (const record of records) {
      expect(record.schema).toBe("event@1");
      expect(record.consumers).toEqual(expect.arrayContaining([BOARD_CONSUMER, INSPECTOR_CONSUMER]));
      expect(record.payload.redacted).toBe(true);
      expect(record.payload.summary.startsWith("{")).toBe(false);
    }
    expect(() =>
      schema.validate({
        schema: "event@1",
        id: "x",
        seq: 1,
        type: "turn_started",
        revision: 1,
        subject: "s",
        consumers: [],
        created: "2026-01-01T00:00:00.000Z",
        payload: { summary: "x", statusLine: null, activity: null, redacted: true, body: {} },
      }),
    ).toThrow(/consumers/);
  });

  it("redacts registered secrets before events are emitted", () => {
    const redactor = new LocalPacketSecurityRedactor();
    const secret = "session-credential-value";
    redactor.register("SESSION_TOKEN", secret);
    const bus = new NormalizedRuntimeEventBus(redactor, () => "2026-01-01T00:00:00.000Z");
    const [event] = bus.ingest("s", {
      source: "copilot",
      event: { type: "text_delta", text: `token ${secret} leaked` },
    });
    expect(event?.type).toBe("assistant_delta");
    if (event?.type === "assistant_delta") {
      expect(event.text).toContain("[REDACTED:SESSION_TOKEN]");
      expect(event.text).not.toContain(secret);
    }
    expect(JSON.stringify(bus.toWorkerEvent(event!))).not.toContain(secret);
    expect(event?.redacted).toBe(true);
  });
});
