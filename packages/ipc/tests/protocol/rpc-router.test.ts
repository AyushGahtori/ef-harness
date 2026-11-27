import { describe, expect, it } from "vitest";
import { OpIdReusedError } from "../../src/protocol/errors.js";
import {
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_OP_ID_REUSED,
  JSON_RPC_PARSE_ERROR,
  RPC_NAMESPACES,
} from "../../src/protocol/index.js";
import type {
  CoordinatorWriteQueue,
  QueueLatencyMetrics,
  WriteOperation,
} from "../../src/protocol/ports.js";
import { createSessionProtocol } from "../../src/protocol/session-protocol.js";
import { MemoryConnection, rpc } from "./fakes.js";
import { MemoryOutbox, directory, emptySnapshots } from "./world.js";

class SerialWriteQueue implements CoordinatorWriteQueue {
  readonly log: { via: "operation" | "barrier"; operation: WriteOperation }[] = [];
  executions = 0;
  private tail: Promise<void> = Promise.resolve();
  private readonly stored = new Map<string, { hash: string; result: unknown }>();

  submitOperation(operation: WriteOperation): Promise<unknown> {
    return this.enqueue("operation", operation);
  }

  submitKnowledgeBarrier(operation: WriteOperation): Promise<unknown> {
    return this.enqueue("barrier", operation);
  }

  pruneOldOperations(): Promise<number> {
    return Promise.resolve(0);
  }

  getQueueMetrics(): QueueLatencyMetrics {
    return { p50Ms: 0, p95Ms: 0, p99Ms: 0, depth: 0 };
  }

  private enqueue(via: "operation" | "barrier", operation: WriteOperation): Promise<unknown> {
    const run = this.tail.then(() => this.run(via, operation));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async run(via: "operation" | "barrier", operation: WriteOperation): Promise<unknown> {
    this.log.push({ via, operation });
    const hash = stableStringify(operation.request);
    const previous = this.stored.get(operation.opId);
    if (previous) {
      if (previous.hash !== hash) throw new OpIdReusedError(operation.opId);
      return previous.result;
    }
    this.executions += 1;
    const result = await operation.execute();
    this.stored.set(operation.opId, { hash, result });
    return result;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort((left, right) =>
      left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0,
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function stack(handlers?: Record<string, (params: Record<string, unknown>) => Promise<unknown> | unknown>) {
  const queue = new SerialWriteQueue();
  const outbox = new MemoryOutbox();
  const protocol = createSessionProtocol({
    writeQueue: queue,
    outboxes: directory({ p: outbox }),
    snapshots: emptySnapshots("p"),
    ...(handlers
      ? {
          handlers: Object.fromEntries(
            Object.entries(handlers).map(([method, handler]) => [
              method,
              (_ctx: unknown, params: Record<string, unknown>) => handler(params),
            ]),
          ),
        }
      : {}),
  });
  return { queue, outbox, protocol, conn: new MemoryConnection("window-a") };
}

function sample(method: string): { params: Record<string, unknown>; opId?: string } {
  const opId = `op-${method}`;
  switch (method) {
    case "session.hello":
      return { params: { token: "token", protocol: "1.1", client: { name: "test", version: "1" } } };
    case "session.ping":
    case "project.list":
    case "plan.preview":
    case "inbox.list":
    case "settings.get":
      return { params: {} };
    case "project.open":
    case "project.close":
    case "build.start":
    case "build.pauseAll":
    case "build.stop":
    case "preview.start":
      return { params: { project_id: "p" }, opId };
    case "chat.send":
      return { params: { target: "discovery", text: "hi", clauses: [] }, opId };
    case "question.answer":
      return { params: { question_id: "q1", answer: "yes" }, opId };
    case "batch.accept":
      return { params: { batch_id: "b1" }, opId };
    case "node.get":
      return { params: { id: "R1" } };
    case "node.search":
      return { params: { query: "login" } };
    case "graph.view":
      return { params: { view: "board" } };
    case "impact.preview":
      return { params: { change: { id: "R1" } } };
    case "task.retry":
    case "task.takeOver":
      return { params: { task: "T1" }, opId };
    case "inbox.resolve":
      return { params: { id: "i1", resolution: "answered" }, opId };
    case "artifact.open":
      return { params: { id: "a1" } };
    case "diff.get":
      return { params: { task: "T1", file: "src/app.ts" } };
    case "preview.url":
      return { params: { project_id: "p" } };
    case "settings.set":
      return { params: { key: "theme", value: "dark" }, opId };
    case "diag.export":
      return { params: {}, opId };
    case "events.subscribe":
      return { params: { project: "p", topics: ["board"], since_seq: 0 } };
    case "snapshot.get":
      return { params: { project: "p", views: ["board"] } };
    default:
      throw new Error(`no sample for ${method}`);
  }
}

describe("RpcRouter", () => {
  it("dispatches every documented namespace and requires op_id only on mutations", async () => {
    const { protocol, queue, conn } = stack();
    expect(protocol.protocolVersion).toBe("1.1");
    for (const namespace of RPC_NAMESPACES) {
      expect(namespace.length).toBeGreaterThan(0);
    }
    const methods = [
      "session.hello",
      "session.ping",
      "project.list",
      "project.open",
      "project.close",
      "chat.send",
      "question.answer",
      "batch.accept",
      "node.get",
      "node.search",
      "graph.view",
      "impact.preview",
      "plan.preview",
      "build.start",
      "build.pauseAll",
      "build.stop",
      "task.retry",
      "task.takeOver",
      "inbox.list",
      "inbox.resolve",
      "artifact.open",
      "diff.get",
      "preview.start",
      "preview.url",
      "settings.get",
      "settings.set",
      "diag.export",
      "events.subscribe",
      "snapshot.get",
    ];
    let id = 1;
    for (const method of methods) {
      const spec = sample(method);
      const response = await protocol.router.handle(conn, rpc(method, spec.params, id, spec.opId));
      id += 1;
      expect(response && "error" in response ? response.error.code : 0).not.toBe(JSON_RPC_METHOD_NOT_FOUND);
      expect(response && "result" in response).toBe(true);
    }
    const mutating = queue.log.map((entry) => entry.operation.kind);
    expect(mutating).toContain("chat.send");
    expect(mutating).toContain("build.stop");
    expect(mutating).not.toContain("project.list");
    expect(mutating).not.toContain("node.get");
    expect(mutating).not.toContain("artifact.open");
    expect(mutating).toContain("diag.export");
    expect(queue.log.find((entry) => entry.operation.kind === "batch.accept")?.via).toBe("barrier");
    expect(queue.log.find((entry) => entry.operation.kind === "build.stop")?.via).toBe("operation");
    expect(queue.log.find((entry) => entry.operation.kind === "chat.send")?.via).toBe("operation");
  });

  it("rejects a missing op_id before the write queue and replays a stored result", async () => {
    let runs = 0;
    const { protocol, queue, conn } = stack({
      "chat.send": async () => {
        runs += 1;
        return { turn: "t1" };
      },
    });
    const missing = await protocol.router.handle(
      conn,
      rpc("build.stop", { project_id: "p" }, 1),
    );
    expect(missing && "error" in missing && missing.error.code).toBe(JSON_RPC_INVALID_PARAMS);
    expect(queue.log).toHaveLength(0);

    const first = await protocol.router.handle(
      conn,
      rpc("chat.send", { target: "discovery", text: "hi", clauses: [] }, 2, "same"),
    );
    const second = await protocol.router.handle(
      conn,
      rpc("chat.send", { target: "discovery", text: "hi", clauses: [] }, 3, "same"),
    );
    expect(first && "result" in first && first.result).toEqual({ turn: "t1" });
    expect(second && "result" in second && second.result).toEqual({ turn: "t1" });
    expect(runs).toBe(1);
    expect(queue.executions).toBe(1);

    const reused = await protocol.router.handle(
      conn,
      rpc("chat.send", { target: "discovery", text: "changed", clauses: [] }, 4, "same"),
    );
    expect(reused && "error" in reused && reused.error.code).toBe(JSON_RPC_OP_ID_REUSED);
    expect(runs).toBe(1);
  });

  it("serializes mutating calls from two windows through the write queue", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false;
    let releaseEntered: () => void = () => {};
    const enteredGate = new Promise<void>((resolve) => {
      releaseEntered = () => {
        entered = true;
        resolve();
      };
    });
    let startedSecond = false;
    const { protocol, queue } = stack({
      "build.start": async () => {
        releaseEntered();
        await gate;
        return { started: true };
      },
      "task.retry": async () => {
        startedSecond = true;
        return { retried: true };
      },
    });
    const first = new MemoryConnection("main");
    const second = new MemoryConnection("office");
    const a = protocol.router.handle(first, rpc("build.start", { project_id: "p" }, 1, "a"));
    await enteredGate;
    expect(entered).toBe(true);
    const b = protocol.router.handle(second, rpc("task.retry", { task: "T1" }, 2, "b"));
    expect(startedSecond).toBe(false);
    release();
    const [aResult, bResult] = await Promise.all([a, b]);
    expect(aResult && "result" in aResult && aResult.result).toEqual({ started: true });
    expect(bResult && "result" in bResult && bResult.result).toEqual({ retried: true });
    expect(queue.log.map((entry) => entry.operation.opId)).toEqual(["a", "b"]);
    expect(startedSecond).toBe(true);
  });

  it("rejects unknown request fields, camelCase aliases, and a different protocol major", async () => {
    const { protocol, conn } = stack();
    const additive = await protocol.router.handle(
      conn,
      rpc("events.subscribe", { project: "p", topics: ["board"], since_seq: 0, futureField: { n: 1 } }, 1),
    );
    expect(additive && "error" in additive && additive.error.code).toBe(JSON_RPC_INVALID_PARAMS);
    const camel = await protocol.router.handle(
      conn,
      rpc("question.answer", { questionId: "q1", answer: "yes" }, 7, "op-camel"),
    );
    expect(camel && "error" in camel && camel.error.code).toBe(JSON_RPC_INVALID_PARAMS);
    const readOnlyOp = await protocol.router.handle(
      conn,
      rpc("artifact.open", { id: "a1" }, 8, "op-open"),
    );
    expect(readOnlyOp && "error" in readOnlyOp && readOnlyOp.error.code).toBe(JSON_RPC_INVALID_PARAMS);
    const emptyTopics = await protocol.router.handle(
      conn,
      rpc("events.subscribe", { project: "p", topics: [], since_seq: 0 }, 9),
    );
    expect(emptyTopics && "error" in emptyTopics && emptyTopics.error.code).toBe(JSON_RPC_INVALID_PARAMS);
    const rejected = await protocol.router.handle(
      conn,
      rpc("session.hello", { token: "t", protocol: "2.0", client: { name: "test", version: "1" } }, 2),
    );
    expect(rejected && "error" in rejected && rejected.error.code).toBe(JSON_RPC_INVALID_PARAMS);
    const parsed = await protocol.router.handle(conn, "{");
    expect(parsed && "error" in parsed && parsed.error.code).toBe(JSON_RPC_PARSE_ERROR);
    const invalid = await protocol.router.handle(conn, { jsonrpc: "1.0", id: 3, method: "session.ping" });
    expect(invalid && "error" in invalid && invalid.error.code).toBe(JSON_RPC_INVALID_REQUEST);
    const missing = await protocol.router.handle(conn, rpc("nope.nope", {}, 4));
    expect(missing && "error" in missing && missing.error.code).toBe(JSON_RPC_METHOD_NOT_FOUND);
    const previousMinor = await protocol.router.handle(
      conn,
      rpc("session.hello", { token: "t", protocol: "1.0", client: { name: "window", version: "1" } }, 5),
    );
    expect(previousMinor && "result" in previousMinor).toBe(true);
    const newerMinor = await protocol.router.handle(
      conn,
      rpc("session.hello", { token: "t", protocol: "1.2", client: { name: "window", version: "1" } }, 6),
    );
    expect(newerMinor && "error" in newerMinor && newerMinor.error.code).toBe(JSON_RPC_INVALID_PARAMS);
  });
});
