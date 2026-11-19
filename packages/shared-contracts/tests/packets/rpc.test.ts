import { describe, expect, it } from "vitest";
import {
  DaemonNotificationSchema,
  EventV1Schema,
  FrameHeaderSchema,
  JSON_RPC_CHANNEL,
  JsonRpcRequestSchema,
  JsonRpcSuccessResponseSchema,
  MUTATING_RPC_METHODS,
  READ_ONLY_RPC_METHODS,
  RPC_METHODS,
  StreamCreditGrantSchema,
  TelemetryNotificationSchema,
  decodeFrameHeader,
} from "../../src/packets/index.js";

const readParams = {
  "session.hello": {
    token: "session-token",
    protocol: "1.0",
    client: { name: "window", version: "0.0.1" },
  },
  "session.ping": {},
  "project.list": {},
  "node.get": { id: "N1" },
  "node.search": { query: "orders" },
  "graph.view": { view: "board", filter: { feature: "F12" } },
  "impact.preview": { change: { field: "pickup_slot" } },
  "plan.preview": {},
  "inbox.list": { status: "open" },
  "artifact.open": { id: "ART-1", range: { start: 0, end: 64 } },
  "diff.get": { task: "T07", file: "src/app/kitchen/page.tsx", hunks: [0, 2] },
  "preview.url": { project_id: "P1" },
  "settings.get": {},
  "events.subscribe": { project: "P1", topics: ["ui"], since_seq: 10 },
  "snapshot.get": { project: "P1", views: ["board"] },
} as const;

const mutatingParams = {
  "project.open": { project_id: "P1" },
  "project.close": { project_id: "P1" },
  "chat.send": { target: "Q1", text: "Use 10:45.", clauses: ["cutoff"] },
  "question.answer": { question_id: "Q1", answer: "10:45" },
  "batch.accept": { batch_id: "B1" },
  "build.start": { project_id: "P1" },
  "build.pauseAll": { project_id: "P1" },
  "build.stop": { project_id: "P1" },
  "task.retry": { task: "T07" },
  "task.takeOver": { task: "T07" },
  "inbox.resolve": { id: "IN-1", resolution: "answered" },
  "preview.start": { project_id: "P1" },
  "settings.set": { key: "theme", value: "dark" },
  "diag.export": { from: 10, to: 20 },
} as const;

const event = EventV1Schema.parse({
  schema: "event@1",
  id: "EV-55120",
  seq: 55120,
  type: "FeatureCompleted",
  revision: 214,
  subject: "F12",
  consumers: ["scheduler", "ui", "export"],
  payload: {},
  created: "2026-11-16T13:05:00Z",
});

describe("window daemon RPC", () => {
  it("covers every documented method exactly once", () => {
    expect(new Set(RPC_METHODS).size).toBe(RPC_METHODS.length);
    expect(READ_ONLY_RPC_METHODS).toHaveLength(15);
    expect(MUTATING_RPC_METHODS).toHaveLength(14);
    expect([...READ_ONLY_RPC_METHODS, ...MUTATING_RPC_METHODS].sort()).toEqual(
      [...RPC_METHODS].sort(),
    );
  });

  it("accepts read-only methods without op_id and rejects op_id on them", () => {
    for (const method of READ_ONLY_RPC_METHODS) {
      const params = readParams[method];
      expect(
        JsonRpcRequestSchema.safeParse({ jsonrpc: "2.0", id: 1, method, params }).success,
        method,
      ).toBe(true);
      expect(
        JsonRpcRequestSchema.safeParse({
          jsonrpc: "2.0",
          id: 1,
          method,
          op_id: "op-1",
          params,
        }).success,
        method,
      ).toBe(false);
    }
  });

  it("requires a non-empty op_id on every mutating method", () => {
    for (const method of MUTATING_RPC_METHODS) {
      const params = mutatingParams[method];
      expect(
        JsonRpcRequestSchema.safeParse({ jsonrpc: "2.0", id: "req-1", method, params }).success,
        method,
      ).toBe(false);
      expect(
        JsonRpcRequestSchema.safeParse({
          jsonrpc: "2.0",
          id: "req-1",
          method,
          op_id: "",
          params,
        }).success,
        method,
      ).toBe(false);
      expect(
        JsonRpcRequestSchema.safeParse({
          jsonrpc: "2.0",
          id: "req-1",
          method,
          op_id: "   ",
          params,
        }).success,
        method,
      ).toBe(false);
      expect(
        JsonRpcRequestSchema.safeParse({
          jsonrpc: "2.0",
          id: "req-1",
          method,
          op_id: "op-1",
          params,
        }).success,
        method,
      ).toBe(true);
    }
  });

  it("validates event batches, resync, telemetry without seq, and credit grants", () => {
    expect(
      DaemonNotificationSchema.parse({
        jsonrpc: "2.0",
        method: "events.batch",
        params: { from_seq: 10, to_seq: 10, events: [event] },
      }).method,
    ).toBe("events.batch");
    expect(
      DaemonNotificationSchema.safeParse({
        jsonrpc: "2.0",
        method: "events.batch",
        params: { from_seq: 12, to_seq: 10, events: [event] },
      }).success,
    ).toBe(false);
    expect(
      DaemonNotificationSchema.parse({
        jsonrpc: "2.0",
        method: "resync_required",
        params: { project: "P1", reason: "stream_epoch_changed", stream_epoch: 3 },
        retry_after_ms: 0,
      }),
    ).toMatchObject({ method: "resync_required", retry_after_ms: 0 });
    const telemetry = TelemetryNotificationSchema.parse({
      jsonrpc: "2.0",
      method: "telemetry",
      params: { name: "tokens", fields: { n: 3 } },
    });
    expect(telemetry.params).not.toHaveProperty("seq");
    expect(
      StreamCreditGrantSchema.parse({
        jsonrpc: "2.0",
        method: "stream.credit",
        params: { stream_id: 7, credits: 4 },
      }).params.credits,
    ).toBe(4);
  });

  it("keeps unknown response fields from a newer minor protocol", () => {
    expect(
      JsonRpcSuccessResponseSchema.parse({
        jsonrpc: "2.0",
        id: 4,
        result: { stream_id: 7 },
        trace_id: "t-1",
      }),
    ).toMatchObject({ result: { stream_id: 7 }, trace_id: "t-1" });
  });

  it("decodes JSON-RPC and binary frame headers", () => {
    const jsonFrame = new Uint8Array(5);
    new DataView(jsonFrame.buffer).setUint32(0, 32, false);
    jsonFrame[4] = JSON_RPC_CHANNEL;
    expect(decodeFrameHeader(jsonFrame)).toEqual({ channel: 0, length: 32 });

    const binary = new Uint8Array(9);
    const view = new DataView(binary.buffer);
    view.setUint32(0, 65_536, false);
    binary[4] = 1;
    view.setUint32(5, 7, false);
    expect(decodeFrameHeader(binary)).toEqual({ channel: 1, length: 65_536, stream_id: 7 });
    expect(FrameHeaderSchema.safeParse({ channel: 0, length: 1_048_577 }).success).toBe(false);
    expect(() => decodeFrameHeader(new Uint8Array([0, 0, 0, 1]))).toThrow(/shorter than 5 bytes/);
  });
});
