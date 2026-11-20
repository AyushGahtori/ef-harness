import { describe, expect, it } from "vitest";
import { ClientStateSyncer, type ClientTransport } from "../../src/protocol/client-state-syncer.js";
import {
  MAX_SNAPSHOT_FRAME_BYTES,
  MAX_SNAPSHOT_SECTION_BYTES,
} from "../../src/protocol/constants.js";
import { utf8Size } from "../../src/protocol/byte-size.js";
import { decodeDaemonMessage } from "../../src/protocol/jsonrpc.js";
import type { JsonRpcNotification, SnapshotRow } from "../../src/protocol/ports.js";
import { ProjectSyncRegistry } from "../../src/protocol/project-sync-registry.js";
import type { SnapshotViewName } from "../../src/protocol/constants.js";
import { createSessionProtocol, type SessionProtocol } from "../../src/protocol/session-protocol.js";
import { MemoryConnection, rpc } from "./fakes.js";
import { SerialQueue } from "./serial-queue.js";
import { FrozenSnapshots, MemoryOutbox, directory, emptySnapshots } from "./world.js";

function ids(syncer: ClientStateSyncer): string[] {
  return syncer.appliedEvents.map((event) => event.id);
}

function seqs(syncer: ClientStateSyncer): number[] {
  return syncer.appliedEvents.map((event) => event.seq);
}

class WindowTransport implements ClientTransport {
  private listener: ((message: unknown) => void) | null = null;
  private generation = 1;
  private requestId = 1;
  conn: MemoryConnection;
  readonly snapshotFrames: number[] = [];
  readonly snapshotSeqs: number[] = [];

  constructor(
    private readonly protocol: SessionProtocol,
    connectionId: string,
  ) {
    this.conn = this.bind(connectionId);
  }

  dropSocket(): void {
    this.conn.close();
  }

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.conn.isClosed()) {
      this.generation += 1;
      this.conn = this.bind(`${this.conn.connectionId}-${this.generation}`);
    }
    const response = await this.protocol.router.handle(this.conn, rpc(method, params, this.requestId));
    this.requestId += 1;
    if (!response || !("result" in response)) throw new Error(`${method} failed`);
    if (method === "snapshot.get") {
      this.snapshotFrames.push(utf8Size(response));
      const body = response.result as { as_of_seq?: number; sections?: Record<string, unknown> };
      if (typeof body.as_of_seq === "number") this.snapshotSeqs.push(body.as_of_seq);
      for (const section of Object.values(body.sections ?? {})) {
        expect(utf8Size(section)).toBeLessThanOrEqual(MAX_SNAPSHOT_SECTION_BYTES);
      }
      expect(utf8Size(response)).toBeLessThanOrEqual(MAX_SNAPSHOT_FRAME_BYTES);
      expect(utf8Size(response)).toBeLessThanOrEqual(MAX_SNAPSHOT_SECTION_BYTES);
    }
    return response.result;
  }

  subscribeNotifications(listener: (message: unknown) => void): () => void {
    this.listener = listener;
    this.conn.onSend = (message) => this.listener?.(message);
    return () => {
      this.listener = null;
    };
  }

  private bind(connectionId: string): MemoryConnection {
    const conn = new MemoryConnection(connectionId);
    conn.onSend = (message: JsonRpcNotification) => this.listener?.(message);
    return conn;
  }
}

function session(outbox: MemoryOutbox, snapshots: FrozenSnapshots): SessionProtocol {
  return createSessionProtocol({
    writeQueue: new SerialQueue(),
    outboxes: directory({ p: outbox }),
    snapshots,
  });
}

function syncerFor(
  transport: ClientTransport,
  topics: readonly string[],
  views: readonly SnapshotViewName[],
): ClientStateSyncer {
  return new ClientStateSyncer({
    projectId: "p",
    topics,
    views,
    transport,
  });
}

describe("ClientStateSyncer", () => {
  it("applies the replay-to-live seam once, suppresses duplicates, and resubscribes across a gap", async () => {
    const outbox = new MemoryOutbox();
    const protocol = session(outbox, emptySnapshots("p"));
    const transport = new WindowTransport(protocol, "main");
    const syncer = syncerFor(transport, [], ["board"]);
    outbox.add({ id: "e1", type: "TaskAccepted", topic: "board" });
    const second = outbox.add({ id: "e2", type: "TaskAccepted", topic: "board" });
    let raced = false;
    outbox.onReplay = () => {
      if (raced) return;
      raced = true;
      const third = outbox.add({ id: "e3", type: "TaskAccepted", topic: "board" });
      protocol.subscriptions.publishDomain("p", second);
      protocol.subscriptions.publishDomain("p", third);
    };
    await syncer.start(0);
    expect(seqs(syncer)).toEqual([1, 2, 3]);
    const fourth = outbox.add({ id: "e4", type: "TaskAccepted", topic: "board" });
    protocol.subscriptions.publishDomain("p", fourth);
    expect(seqs(syncer)).toEqual([1, 2, 3, 4]);
    const duplicate = syncer.ingest({
      jsonrpc: "2.0",
      method: "events.batch",
      params: {
        from_seq: 1,
        to_seq: 2,
        events: [
          { seq: 1, id: "e1", type: "TaskAccepted", payload: {}, topic: "board" },
          { seq: 2, id: "e2", type: "TaskAccepted", payload: {}, topic: "board" },
        ],
      },
    });
    expect(duplicate.action).toBe("duplicate");
    expect(seqs(syncer)).toEqual([1, 2, 3, 4]);

    outbox.add({ id: "e5", type: "TaskAccepted", topic: "board" });
    const gap = syncer.ingest({
      jsonrpc: "2.0",
      method: "events.batch",
      params: {
        from_seq: 6,
        to_seq: 6,
        events: [{ seq: 6, id: "skipped", type: "TaskAccepted", payload: {}, topic: "board" }],
      },
    });
    expect(gap.action).toBe("gap");
    expect(syncer.lastApplied).toBe(4);
    await syncer.whenIdle();
    expect(ids(syncer)).toEqual(["e1", "e2", "e3", "e4", "e5"]);
    expect(syncer.lastApplied).toBe(5);
    expect(ids(syncer)).not.toContain("skipped");
  });

  it("advances lastApplied across topic skips without treating them as transport gaps", async () => {
    const outbox = new MemoryOutbox();
    outbox.add({ id: "b1", type: "BoardUpdated", topic: "board" });
    outbox.add({ id: "o1", type: "OfficeUpdated", topic: "office" });
    outbox.add({ id: "b2", type: "BoardUpdated", topic: "board" });
    const protocol = session(outbox, emptySnapshots("p"));
    const syncer = syncerFor(new WindowTransport(protocol, "board"), ["board"], ["board"]);
    await syncer.start(0);
    expect(ids(syncer)).toEqual(["b1", "b2"]);
    expect(syncer.lastApplied).toBe(3);
  });

  it("replays missed domain events after the pipe drops without a snapshot replace", async () => {
    const outbox = new MemoryOutbox();
    outbox.add({ id: "e1", type: "TaskAccepted", topic: "board" });
    const protocol = session(outbox, emptySnapshots("p"));
    const transport = new WindowTransport(protocol, "main");
    const syncer = syncerFor(transport, [], ["board"]);
    await syncer.start(0);
    expect(syncer.streamEpoch).toBe("epoch-1");
    transport.dropSocket();
    outbox.add({ id: "e2", type: "TaskAccepted", topic: "board" });
    outbox.add({ id: "e3", type: "TaskAccepted", topic: "board" });
    await syncer.reconnect();
    expect(syncer.streamEpoch).toBe("epoch-1");
    expect(ids(syncer)).toEqual(["e1", "e2", "e3"]);
    expect(syncer.lastApplied).toBe(3);
    expect(transport.snapshotFrames).toHaveLength(0);
  });

  it("replaces view state from snapshot.get when stream_epoch changes, even if latest_seq matches", async () => {
    const tables: Record<string, readonly SnapshotRow[]> = {
      board: [{ id: "stale", lanes: [{ feature: "old", state: "READY", n: 1 }] }],
    };
    const outbox = new MemoryOutbox();
    outbox.add({ id: "old-event", type: "TaskAccepted", topic: "board" });
    const snapshots = new FrozenSnapshots("p", { epoch: "epoch-1", latest: 1, rows: tables });
    const protocol = session(outbox, snapshots);
    const transport = new WindowTransport(protocol, "main");
    const syncer = syncerFor(transport, [], ["board", "inbox"]);
    await syncer.start(0);
    expect(syncer.streamEpoch).toBe("epoch-1");
    expect(ids(syncer)).toEqual(["old-event"]);

    outbox.epoch = "epoch-2";
    outbox.events.splice(0, outbox.events.length);
    outbox.highWater = 4;
    snapshots.epoch = "epoch-2";
    snapshots.latest = 4;
    tables.board = [{ id: "board", lanes: [{ feature: "F1", state: "READY", n: 2 }] }];
    tables.inbox = [{ id: "in-1", kind: "question" }];
    await syncer.reconnect();
    expect(syncer.streamEpoch).toBe("epoch-2");
    expect(syncer.lastApplied).toBe(4);
    expect(syncer.appliedEvents).toEqual([]);
    expect(syncer.sections.board).toEqual([{ id: "board", lanes: [{ feature: "F1", state: "READY", n: 2 }] }]);
    expect(syncer.sections.inbox).toEqual([{ id: "in-1", kind: "question" }]);
    expect(syncer.sections.stale).toBeUndefined();
    expect(protocol.metrics.forClient("main", "p")?.resyncCount).toBe(1);

    const live = outbox.add({ id: "after", type: "TaskAccepted", topic: "board" });
    protocol.subscriptions.publishDomain("p", live);
    expect(syncer.lastApplied).toBe(5);
    expect(ids(syncer)).toEqual(["after"]);
    expect(syncer.sections.board).toEqual([{ id: "board", lanes: [{ feature: "F1", state: "READY", n: 2 }] }]);
  });

  it("recovers through snapshot.get when since_seq fell behind retained outbox history", async () => {
    const tables: Record<string, readonly SnapshotRow[]> = {
      inbox: [{ id: "kept", kind: "fyi" }],
    };
    const outbox = new MemoryOutbox();
    outbox.add({ id: "e1", type: "TaskAccepted", topic: "board" });
    outbox.add({ id: "e2", type: "TaskAccepted", topic: "board" });
    const snapshots = new FrozenSnapshots("p", { epoch: "epoch-1", latest: 2, rows: tables });
    const protocol = session(outbox, snapshots);
    const syncer = syncerFor(new WindowTransport(protocol, "main"), [], ["inbox"]);
    await syncer.start(0);
    expect(syncer.lastApplied).toBe(2);

    outbox.events.splice(0, outbox.events.length, {
      seq: 20,
      id: "e20",
      type: "TaskAccepted",
      payload: {},
      topic: "board",
    });
    outbox.highWater = 20;
    snapshots.latest = 20;
    await syncer.reconnect();
    expect(syncer.streamEpoch).toBe("epoch-1");
    expect(syncer.lastApplied).toBe(20);
    expect(syncer.appliedEvents).toEqual([]);
    expect(syncer.sections.inbox).toEqual([{ id: "kept", kind: "fyi" }]);
    expect(protocol.metrics.forClient("main", "p")?.resyncCount).toBe(1);
  });

  it("merges every snapshot page under 2 MB into one as_of_seq", async () => {
    const payload = "x".repeat(400_000);
    const rows: SnapshotRow[] = [1, 2, 3].map((index) => ({
      id: `inbox-${index}`,
      kind: "fyi",
      payload,
    }));
    const outbox = new MemoryOutbox();
    outbox.highWater = 40;
    const snapshots = new FrozenSnapshots("p", { epoch: "epoch-1", latest: 40, rows: { inbox: rows } });
    const protocol = session(outbox, snapshots);
    const transport = new WindowTransport(protocol, "main");
    const syncer = syncerFor(transport, [], ["inbox"]);
    await syncer.start(0);
    expect(transport.snapshotFrames.length).toBeGreaterThan(1);
    expect(transport.snapshotSeqs.every((seq) => seq === 40)).toBe(true);
    expect(syncer.lastApplied).toBe(40);
    expect(syncer.streamEpoch).toBe("epoch-1");
    const inbox = syncer.sections.inbox;
    expect(Array.isArray(inbox) ? inbox.map((item) => (item as { id: string }).id) : []).toEqual([
      "inbox-1",
      "inbox-2",
      "inbox-3",
    ]);
  });

  it("gives two windows the same seq stream and keeps Board and Office on one syncer", async () => {
    const outbox = new MemoryOutbox();
    outbox.add({ id: "e1", type: "BoardUpdated", topic: "board" });
    outbox.add({ id: "e2", type: "OfficeUpdated", topic: "office" });
    const protocol = session(outbox, emptySnapshots("p"));
    const main = syncerFor(new WindowTransport(protocol, "main"), [], ["board"]);
    const popped = syncerFor(new WindowTransport(protocol, "office"), [], ["board"]);
    await main.start(0);
    await popped.start(0);
    const live = outbox.add({ id: "e3", type: "BoardUpdated", topic: "board" });
    protocol.subscriptions.publishDomain("p", live);
    expect(seqs(main)).toEqual([1, 2, 3]);
    expect(seqs(popped)).toEqual(seqs(main));
    expect(ids(popped)).toEqual(ids(main));

    const registry = new ProjectSyncRegistry();
    const shared = registry.getOrCreate("p", () => main);
    expect(registry.getOrCreate("p", () => popped)).toBe(shared);
    expect(registry.get("p")).toBe(main);
    protocol.subscriptions.publishTelemetry("p", { kind: "token.count", payload: { n: 4 } });
    expect(main.telemetryCount).toBe(1);
    expect(main.lastApplied).toBe(3);
    expect(popped.telemetryCount).toBe(1);
    expect(popped.lastApplied).toBe(3);
  });

  it("accepts unknown additive fields on notifications and on a newer minor response", async () => {
    expect(
      decodeDaemonMessage({
        jsonrpc: "2.0",
        method: "events.batch",
        params: {
          from_seq: 1,
          to_seq: 1,
          futureBatch: true,
          events: [{ seq: 1, id: "e1", type: "TaskAccepted", payload: { n: 1 }, topic: "board", futureField: 1 }],
        },
      }).kind,
    ).toBe("events.batch");
    expect(
      decodeDaemonMessage({
        jsonrpc: "2.0",
        method: "telemetry",
        params: { project: "p", kind: "token.count", payload: { n: 1 }, meter: "new" },
      }).kind,
    ).toBe("telemetry");
    expect(
      decodeDaemonMessage({
        jsonrpc: "2.0",
        method: "window.future",
        params: { extra: true },
      }).kind,
    ).toBe("notification");

    const transport: ClientTransport = {
      async request(method) {
        if (method === "events.subscribe") {
          return {
            status: "live",
            stream_epoch: "epoch-7",
            last_seq: 0,
            replayed_from: 0,
            replayed_to: 0,
            futureResult: { ok: true },
          };
        }
        throw new Error(method);
      },
      subscribeNotifications(listener) {
        listener({
          jsonrpc: "2.0",
          method: "events.batch",
          params: {
            from_seq: 1,
            to_seq: 1,
            events: [{ seq: 1, id: "e1", type: "TaskAccepted", payload: {}, topic: "board", extra: "keep-going" }],
          },
        });
        return () => undefined;
      },
    };
    const syncer = syncerFor(transport, ["board"], ["board"]);
    await syncer.start(0);
    expect(syncer.streamEpoch).toBe("epoch-7");
    expect(ids(syncer)).toEqual(["e1"]);
    expect(syncer.lastApplied).toBe(1);
    const ignored = syncer.ingest({ jsonrpc: "2.0", method: "diag.future", params: { extra: 1 } });
    expect(ignored.action).toBe("ignored");
    expect(syncer.lastApplied).toBe(1);
  });
});
