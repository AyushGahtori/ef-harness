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

function sample(method: string): Record<string, unknown> {
  const op = { op_id: `op-${method}` };
  switch (method) {
    case "session.hello":
      return { token: "token", protocol: "1.1", client: "test" };
    case "session.ping":
    case "project.list":
    case "plan.preview":
    case "inbox.list":
    case "preview.url":
    case "settings.get":
    case "diag.export":
      return {};
    case "project.open":
    case "project.close":
      return { ...op, project: "p" };
    case "chat.send":
      return { ...op, target: "discovery", text: "hi", clauses: [] };
    case "question.answer":
      return { ...op, questionId: "q1", answer: "yes" };
    case "batch.accept":
      return { ...op, batchId: "b1" };
    case "node.get":
      return { id: "R1" };
    case "node.search":
      return { query: "login" };
    case "graph.view":
      return { view: "board" };
    case "impact.preview":
      return { change: { id: "R1" } };
    case "build.start":
    case "build.pauseAll":
    case "build.stop":
    case "preview.start":
      return { ...op };
    case "task.retry":
    case "task.takeOver":
      return { ...op, task: "T1" };
    case "inbox.resolve":
      return { ...op, id: "i1", resolution: "done" };
    case "artifact.open":
      return { ...op, id: "a1" };
    case "diff.get":
      return { task: "T1", file: "src/app.ts" };
    case "settings.set":
      return { ...op, key: "theme", value: "dark" };
    case "events.subscribe":
      return { project: "p", topics: [], since_seq: 0 };
    case "snapshot.get":
      return { project: "p", views: ["board"] };
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
      const response = await protocol.router.handle(conn, rpc(method, sample(method), id));
      id += 1;
      expect(response && "error" in response ? response.error.code : 0).not.toBe(JSON_RPC_METHOD_NOT_FOUND);
      expect(response && "result" in response).toBe(true);
    }
    const mutating = queue.log.map((entry) => entry.operation.kind);
    expect(mutating).toContain("chat.send");
    expect(mutating).toContain("build.stop");
    expect(mutating).not.toContain("project.list");
    expect(mutating).not.toContain("node.get");
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
      rpc("build.stop", {}, 1),
    );
    expect(missing && "error" in missing && missing.error.code).toBe(JSON_RPC_INVALID_PARAMS);
    expect(queue.log).toHaveLength(0);

    const first = await protocol.router.handle(
      conn,
      rpc("chat.send", { op_id: "same", target: "discovery", text: "hi", clauses: [] }, 2),
    );
    const second = await protocol.router.handle(
      conn,
      rpc("chat.send", { op_id: "same", target: "discovery", text: "hi", clauses: [] }, 3),
    );
    expect(first && "result" in first && first.result).toEqual({ turn: "t1" });
    expect(second && "result" in second && second.result).toEqual({ turn: "t1" });
    expect(runs).toBe(1);
    expect(queue.executions).toBe(1);

    const reused = await protocol.router.handle(
      conn,
      rpc("chat.send", { op_id: "same", target: "discovery", text: "changed", clauses: [] }, 4),
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
    const a = protocol.router.handle(first, rpc("build.start", { op_id: "a" }, 1));
    await enteredGate;
    expect(entered).toBe(true);
    const b = protocol.router.handle(second, rpc("task.retry", { op_id: "b", task: "T1" }, 2));
    expect(startedSecond).toBe(false);
    release();
    const [aResult, bResult] = await Promise.all([a, b]);
    expect(aResult && "result" in aResult && aResult.result).toEqual({ started: true });
    expect(bResult && "result" in bResult && bResult.result).toEqual({ retried: true });
    expect(queue.log.map((entry) => entry.operation.opId)).toEqual(["a", "b"]);
    expect(startedSecond).toBe(true);
  });

  it("accepts additive request fields and rejects a different protocol major", async () => {
    const { protocol, conn } = stack();
    const accepted = await protocol.router.handle(
      conn,
      rpc("events.subscribe", { project: "p", topics: ["board"], since_seq: 0, futureField: { n: 1 } }, 1),
    );
    expect(accepted && "result" in accepted && (accepted.result as { status: string }).status).toBe("live");
    const rejected = await protocol.router.handle(
      conn,
      rpc("session.hello", { token: "t", protocol: "2.0", client: "test" }, 2),
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
      rpc("session.hello", { token: "t", protocol: "1.0", client: { name: "window", build: 2 } }, 5),
    );
    expect(previousMinor && "result" in previousMinor).toBe(true);
    const newerMinor = await protocol.router.handle(
      conn,
      rpc("session.hello", { token: "t", protocol: "1.2", client: "test" }, 6),
    );
    expect(newerMinor && "error" in newerMinor && newerMinor.error.code).toBe(JSON_RPC_INVALID_PARAMS);
  });
});
