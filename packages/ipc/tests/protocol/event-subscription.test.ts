import { describe, expect, it } from "vitest";
import { EventSubscriptionServer } from "../../src/protocol/event-subscription-server.js";
import type { EventsBatch } from "../../src/protocol/envelopes.js";
import { MemoryConnection } from "./fakes.js";
import { MemoryOutbox, directory } from "./world.js";

function batches(conn: MemoryConnection): EventsBatch[] {
  const found: EventsBatch[] = [];
  for (const message of conn.sent) {
    if (message.method !== "events.batch" || !message.params || typeof message.params !== "object") continue;
    found.push(message.params as EventsBatch);
  }
  return found;
}

function seqs(conn: MemoryConnection): number[] {
  return batches(conn).flatMap((batch) => batch.events.map((event) => event.seq));
}

describe("EventSubscriptionServer", () => {
  it("closes the replay-to-live seam without gaps or duplicates", async () => {
    const outbox = new MemoryOutbox();
    const server = new EventSubscriptionServer({ outboxes: directory({ p: outbox }) });
    const first = outbox.add({ id: "e1", type: "TaskAccepted", topic: "board" });
    const second = outbox.add({ id: "e2", type: "TaskAccepted", topic: "board" });
    outbox.onReplay = () => {
      const third = outbox.add({ id: "e3", type: "TaskAccepted", topic: "board" });
      server.publishDomain("p", second);
      server.publishDomain("p", third);
    };
    const conn = new MemoryConnection("main");
    const result = await server.subscribe(conn, { project: "p", topics: [], since_seq: 0 });
    expect(result.status).toBe("live");
    expect(seqs(conn)).toEqual([first.seq, second.seq, 3]);
    expect(seqs(conn).filter((seq) => seq === 2)).toHaveLength(1);
    const fourth = outbox.add({ id: "e4", type: "TaskAccepted", topic: "board" });
    server.publishDomain("p", fourth);
    expect(seqs(conn)).toEqual([1, 2, 3, 4]);
  });

  it("returns resync_required for a new stream_epoch even when latest_seq matches", async () => {
    const outbox = new MemoryOutbox();
    outbox.highWater = 5;
    outbox.epoch = "epoch-b";
    const server = new EventSubscriptionServer({ outboxes: directory({ p: outbox }) });
    const conn = new MemoryConnection("main");
    const result = await server.subscribe(conn, {
      project: "p",
      topics: [],
      since_seq: 5,
      stream_epoch: "epoch-a",
    });
    expect(result).toEqual({
      status: "resync_required",
      current_stream_epoch: "epoch-b",
      latest_seq: 5,
    });
    expect(outbox.replayCalls).toBe(0);
    expect(conn.sent).toHaveLength(0);
    expect(server.getMetrics().forClient("main", "p")?.resyncCount).toBe(1);
  });

  it("returns resync_required when since_seq fell behind retained outbox history", async () => {
    const outbox = new MemoryOutbox();
    outbox.highWater = 500;
    outbox.events.push({ seq: 500, id: "e500", type: "TaskAccepted", payload: {}, topic: "board" });
    const server = new EventSubscriptionServer({ outboxes: directory({ p: outbox }) });
    const conn = new MemoryConnection("main");
    const behind = await server.subscribe(conn, { project: "p", topics: [], since_seq: 10, stream_epoch: "epoch-1" });
    expect(behind).toMatchObject({ status: "resync_required", latest_seq: 500, current_stream_epoch: "epoch-1" });
    expect(outbox.replayCalls).toBe(0);

    const fresh = new MemoryConnection("fresh");
    const caught = await server.subscribe(fresh, { project: "p", topics: [], since_seq: 499, stream_epoch: "epoch-1" });
    expect(caught.status).toBe("live");
    expect(seqs(fresh)).toEqual([500]);

    const zero = new MemoryConnection("zero");
    const freshProject = new MemoryOutbox();
    const freshServer = new EventSubscriptionServer({ outboxes: directory({ p: freshProject }) });
    const opened = await freshServer.subscribe(zero, { project: "p", topics: [], since_seq: 0 });
    expect(opened.status).toBe("live");

    const pruned = new MemoryConnection("pruned-zero");
    const prunedZero = await server.subscribe(pruned, { project: "p", topics: [], since_seq: 0, stream_epoch: "epoch-1" });
    expect(prunedZero).toMatchObject({ status: "resync_required", latest_seq: 500, current_stream_epoch: "epoch-1" });
  });

  it("marks topic skips in from_seq/to_seq and fans the same seqs out to two windows", async () => {
    const outbox = new MemoryOutbox();
    outbox.add({ id: "e1", type: "BoardUpdated", topic: "board" });
    outbox.add({ id: "e2", type: "OfficeUpdated", topic: "office" });
    outbox.add({ id: "e3", type: "BoardUpdated", topic: "board" });
    const server = new EventSubscriptionServer({ outboxes: directory({ p: outbox }) });
    const main = new MemoryConnection("main");
    const office = new MemoryConnection("office");
    await server.subscribe(main, { project: "p", topics: ["board"], since_seq: 0 });
    await server.subscribe(office, { project: "p", topics: [], since_seq: 0 });
    const mainBatches = batches(main);
    expect(mainBatches[0]).toMatchObject({ from_seq: 1, to_seq: 3 });
    expect(mainBatches.flatMap((batch) => batch.events.map((event) => event.seq))).toEqual([1, 3]);
    expect(seqs(office)).toEqual([1, 2, 3]);
    const live = outbox.add({ id: "e4", type: "BoardUpdated", topic: "board" });
    server.publishDomain("p", live);
    expect(seqs(main)).toEqual([1, 3, 4]);
    expect(seqs(office)).toEqual([1, 2, 3, 4]);
    const officeLive = batches(office).at(-1);
    const mainLive = batches(main).at(-1);
    expect(officeLive?.events.map((event) => event.id)).toEqual(mainLive?.events.map((event) => event.id));
  });

  it("aborts a replay when the socket closes and does not read the next page", async () => {
    const outbox = new MemoryOutbox();
    outbox.add({ id: "e1", type: "TaskAccepted", topic: "board" });
    outbox.add({ id: "e2", type: "TaskAccepted", topic: "board" });
    outbox.add({ id: "e3", type: "TaskAccepted", topic: "board" });
    outbox.add({ id: "e4", type: "TaskAccepted", topic: "board" });
    const server = new EventSubscriptionServer({
      outboxes: directory({ p: outbox }),
      replayPageSize: 2,
    });
    const conn = new MemoryConnection("main");
    conn.closeOnSend = true;
    const result = await server.subscribe(conn, { project: "p", topics: [], since_seq: 0 });
    expect(result.status).toBe("aborted");
    expect(outbox.replayCalls).toBe(1);
    expect(batches(conn)).toHaveLength(1);
  });

  it("sheds oldest telemetry for a slow client and still delivers every domain batch in order", async () => {
    const outbox = new MemoryOutbox();
    const server = new EventSubscriptionServer({
      outboxes: directory({ p: outbox }),
      maxQueuedTelemetry: 4,
    });
    const conn = new MemoryConnection("slow");
    await server.subscribe(conn, { project: "p", topics: [], since_seq: 0 });
    conn.setWritable(false);
    for (let index = 0; index < 20; index += 1) {
      server.publishTelemetry("p", { kind: "token.count", payload: { n: index } });
    }
    for (let seq = 1; seq <= 5; seq += 1) {
      server.publishDomain("p", { seq, id: `d${seq}`, type: "TaskAccepted", payload: {}, topic: "board" });
    }
    expect(server.getMetrics().forClient("slow", "p")?.subscriptionLagEvents).toBe(5);
    expect(server.getMetrics().forClient("slow", "p")?.droppedTelemetryCount).toBe(16);
    conn.setWritable(true);
    const methods = conn.sent.map((message) => message.method);
    const firstTelemetry = methods.indexOf("telemetry");
    const lastDomain = methods.lastIndexOf("events.batch");
    expect(lastDomain).toBeGreaterThanOrEqual(0);
    expect(firstTelemetry).toBeGreaterThan(lastDomain);
    expect(seqs(conn)).toEqual([1, 2, 3, 4, 5]);
    const telemetry = conn.sent.filter((message) => message.method === "telemetry");
    expect(telemetry).toHaveLength(4);
    expect(telemetry.map((message) => (message.params as { payload: { n: number } }).payload.n)).toEqual([16, 17, 18, 19]);
    expect(server.getMetrics().forClient("slow", "p")?.subscriptionLagEvents).toBe(0);
    let previous = 0;
    for (const batch of batches(conn)) {
      expect(batch.from_seq).toBe(previous + 1);
      previous = batch.to_seq;
    }
  });

  it("records replay duration", async () => {
    const outbox = new MemoryOutbox();
    outbox.add({ id: "e1", type: "TaskAccepted", topic: "board" });
    let now = 1_000;
    outbox.onReplay = () => {
      now += 25;
    };
    const server = new EventSubscriptionServer({
      outboxes: directory({ p: outbox }),
      now: () => now,
    });
    const conn = new MemoryConnection("main");
    await server.subscribe(conn, { project: "p", topics: [], since_seq: 0 });
    expect(server.getMetrics().forClient("main", "p")?.replayDurationMs).toBe(25);
  });
});
