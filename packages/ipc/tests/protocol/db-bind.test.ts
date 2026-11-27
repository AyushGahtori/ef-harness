import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OutboxTransactionRequiredError, openProjectStateDb } from "@ef-harness/db";
import { bindIpcProject, createSessionProtocol } from "../../src/protocol/index.js";
import type { JsonRpcNotification, ProtocolConnection } from "../../src/protocol/ports.js";
import {
  NamedPipeClient,
  NamedPipeServer,
  SessionTokenStore,
  testPipePath,
} from "../../src/transport/index.js";

const closers: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

class QuietConnection implements ProtocolConnection {
  private closed = false;
  private readonly closeListeners: Array<() => void> = [];

  constructor(readonly connectionId: string) {}

  send(message: JsonRpcNotification): void {
    void message.method;
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.push(listener);
    return () => {
      const index = this.closeListeners.indexOf(listener);
      if (index >= 0) this.closeListeners.splice(index, 1);
    };
  }

  isClosed(): boolean {
    return this.closed;
  }

  isWritable(): boolean {
    return !this.closed;
  }

  onWritable(listener: () => void): () => void {
    return () => {
      void listener;
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of [...this.closeListeners]) listener();
  }
}

describe("ipc project binding", () => {
  it("deduplicates op_id and resyncs a mismatched stream epoch over the named pipe", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-c12-ipc-"));
    const stateDb = openProjectStateDb({ projectId: "C12State", rootDir });
    const binding = bindIpcProject(stateDb, "C12State", { coalesceWindowMs: 0 });
    const protocol = createSessionProtocol({
      writeQueue: binding.writeQueue,
      outboxes: binding.outboxes,
      snapshots: binding.snapshots,
      handlers: {
        "chat.send": () => {
          const event = binding.outbox.appendEvent(
            { id: "EV-1", type: "TaskAccepted", payload: { task: "T12" }, createdAt: 10 },
            ["scheduler"],
          );
          return { seq: event.seq };
        },
      },
    });
    const pipePath = testPipePath();
    const tokenDir = path.join(rootDir, "tokens");
    const server = new NamedPipeServer({
      pipePath,
      tokenStore: new SessionTokenStore({ directory: tokenDir }),
      handshakeTimeoutMs: 1_000,
    });
    const connections = new Map<number, QuietConnection>();
    server.setRequestHandler((request, session) => {
      const existing = connections.get(session.id);
      const connection = existing ?? new QuietConnection(`pipe-${session.id}`);
      if (!existing) connections.set(session.id, connection);
      const response = protocol.router.handle(connection, {
        jsonrpc: "2.0",
        id: request.id,
        method: request.method,
        params: request.params ?? {},
        ...(request.op_id !== undefined ? { op_id: request.op_id } : {}),
      });
      return response.then((message) => {
        if (!message) return {};
        if ("error" in message) return { error: message.error };
        return message.result;
      });
    });
    const client = new NamedPipeClient({
      pipePath,
      tokenPath: path.join(tokenDir, "session.token"),
      heartbeatMs: 0,
      backoffBaseMs: 15,
      backoffMaxMs: 60,
      requestTimeoutMs: 5_000,
      maxRetries: 0,
    });
    closers.unshift(async () => {
      await client.close();
      await server.close();
      for (const connection of connections.values()) connection.close();
      await binding.dbWriteQueue.drainAndClose();
      if (!stateDb.isClosed()) stateDb.close();
      fs.rmSync(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });

    expect(() =>
      binding.outbox.appendEvent({ id: "EV-x", type: "TaskAccepted", payload: { task: "T12" } }, ["scheduler"]),
    ).toThrow(OutboxTransactionRequiredError);

    await server.listen();
    await client.start();
    expect(client.connected).toBe(true);

    const chat = { target: "discovery", text: "hi", clauses: [] as string[] };
    const first = await client.request("chat.send", chat, "op-c12");
    const replay = await client.request("chat.send", chat, "op-c12");
    expect(first).toEqual({ seq: 1 });
    expect(replay).toEqual({ seq: 1 });
    expect(binding.outbox.readSinceSeq("1", 0, 10).events.map((event) => event.id)).toEqual(["EV-1"]);
    expect(binding.outbox.readSinceSeq("1", 0, 10).highWaterSeq).toBe(1);
    expect(binding.outbox.currentStreamEpoch()).toBe("1");
    expect(stateDb.getStreamEpoch()).toBe(1);

    await expect(
      client.request("chat.send", { target: "discovery", text: "changed", clauses: [] }, "op-c12"),
    ).rejects.toThrow(/op_id_reused/u);

    const live = await client.request("events.subscribe", {
      project: "C12State",
      topics: ["TaskAccepted"],
      since_seq: 0,
      stream_epoch: 1,
    });
    expect(live).toMatchObject({
      status: "live",
      stream_epoch: "1",
      last_seq: 1,
      replayed_from: 0,
      replayed_to: 1,
    });

    const mismatched = await client.request("events.subscribe", {
      project: "C12State",
      topics: ["TaskAccepted"],
      since_seq: 1,
      stream_epoch: "2",
    });
    expect(mismatched).toMatchObject({
      status: "resync_required",
      current_stream_epoch: "1",
      latest_seq: 1,
    });
    const stale = binding.outbox.readSinceSeq("2", 0, 10);
    expect(stale.resyncRequired).toBe(true);
    expect(stale.events).toEqual([]);
    expect(stale.highWaterSeq).toBe(1);
    expect(binding.outbox.ackDelivery("EV-1", "scheduler", 20)).toBe(true);
    expect(Array.isArray(binding.readModels.getFeatureRollups())).toBe(true);
  }, 20_000);
});
