import { describe, expect, it } from "vitest";
import {
  CHANNEL0_MAX_FRAME_BYTES,
  JSON_RPC_SNAPSHOT_ITEM_TOO_LARGE,
  MAX_SNAPSHOT_FRAME_BYTES,
  MAX_SNAPSHOT_SECTION_BYTES,
} from "../../src/protocol/constants.js";
import { utf8Size } from "../../src/protocol/byte-size.js";
import type { KeysetReader, ReadModelRepo, SnapshotRow } from "../../src/protocol/ports.js";
import { snapshotSourceFromReadModels } from "../../src/protocol/snapshot-assembler.js";
import { createSessionProtocol } from "../../src/protocol/session-protocol.js";
import { MemoryConnection, rpc } from "./fakes.js";
import { FrozenSnapshots, MemoryOutbox, directory } from "./world.js";
import type { JsonRpcResponse } from "../../src/protocol/ports.js";
import { SerialQueue } from "./serial-queue.js";

interface SnapshotBody {
  status?: string;
  as_of_seq: number;
  stream_epoch: string;
  sections: Record<string, unknown>;
  nextCursor: string | null;
  current_stream_epoch?: string;
  latest_seq?: number;
}

function resultOf(response: JsonRpcResponse | null): SnapshotBody {
  if (!response || !("result" in response)) throw new Error("expected snapshot result");
  return response.result as SnapshotBody;
}

describe("snapshot.get", () => {
  it("pages a large project under 2 MB and reconstructs one consistent as_of_seq", async () => {
    expect(MAX_SNAPSHOT_SECTION_BYTES).toBe(2 * 1024 * 1024);
    expect(MAX_SNAPSHOT_FRAME_BYTES).toBe(CHANNEL0_MAX_FRAME_BYTES);
    expect(MAX_SNAPSHOT_FRAME_BYTES).toBeLessThanOrEqual(MAX_SNAPSHOT_SECTION_BYTES);
    const payload = "x".repeat(400_000);
    const rows: SnapshotRow[] = [1, 2, 3].map((index) => ({
      id: `inbox-${index}`,
      kind: "fyi",
      payload,
    }));
    const snapshots = new FrozenSnapshots("p", {
      epoch: "epoch-1",
      latest: 40,
      rows: { inbox: rows },
    });
    const protocol = createSessionProtocol({
      writeQueue: new SerialQueue(),
      outboxes: directory({ p: new MemoryOutbox() }),
      snapshots,
    });
    const conn = new MemoryConnection("main");
    const pages: SnapshotBody[] = [];
    let cursor: string | undefined;
    let id = 1;
    do {
      const response = await protocol.router.handle(
        conn,
        rpc("snapshot.get", { project: "p", views: ["inbox"], ...(cursor ? { cursor } : {}) }, id),
      );
      id += 1;
      const body = resultOf(response);
      expect(body.status).toBeUndefined();
      const frame = utf8Size(response);
      expect(frame).toBeLessThanOrEqual(MAX_SNAPSHOT_FRAME_BYTES);
      expect(frame).toBeLessThanOrEqual(MAX_SNAPSHOT_SECTION_BYTES);
      for (const section of Object.values(body.sections)) {
        expect(utf8Size(section)).toBeLessThanOrEqual(MAX_SNAPSHOT_SECTION_BYTES);
      }
      pages.push(body);
      cursor = body.nextCursor ?? undefined;
    } while (cursor);
    expect(pages.length).toBeGreaterThan(1);
    const asOf = pages[0]?.as_of_seq;
    expect(pages.every((page) => page.as_of_seq === asOf && page.stream_epoch === "epoch-1")).toBe(true);
    const ids = pages.flatMap((page) => {
      const inbox = page.sections.inbox;
      return Array.isArray(inbox) ? inbox.map((item) => (item as { id: string }).id) : [];
    });
    expect(ids).toEqual(["inbox-1", "inbox-2", "inbox-3"]);
  });

  it("returns resync_required when a commit moves past the pagination buffer", async () => {
    const rows: SnapshotRow[] = [1, 2, 3, 4].map((index) => ({
      id: `inbox-${index}`,
      payload: "y".repeat(400),
    }));
    const snapshots = new FrozenSnapshots("p", {
      epoch: "epoch-1",
      latest: 8,
      rows: { inbox: rows },
    });
    const protocol = createSessionProtocol({
      writeQueue: new SerialQueue(),
      outboxes: directory({ p: new MemoryOutbox() }),
      snapshots,
      seqBuffer: 0,
      maxFrameBytes: 900,
    });
    const conn = new MemoryConnection("main");
    const first = resultOf(
      await protocol.router.handle(conn, rpc("snapshot.get", { project: "p", views: ["inbox"] }, 1)),
    );
    expect(first.nextCursor).toEqual(expect.any(String));
    snapshots.latest = 9;
    const second = resultOf(
      await protocol.router.handle(
        conn,
        rpc("snapshot.get", { project: "p", views: ["inbox"], cursor: first.nextCursor ?? "" }, 2),
      ),
    );
    expect(second).toMatchObject({
      status: "resync_required",
      current_stream_epoch: "epoch-1",
      latest_seq: 9,
    });
  });

  it("rejects a single section item that cannot fit in a channel-0 frame", async () => {
    const snapshots = new FrozenSnapshots("p", {
      epoch: "epoch-1",
      latest: 1,
      rows: { inbox: [{ id: "huge", payload: "z".repeat(1_200_000) }] },
    });
    const protocol = createSessionProtocol({
      writeQueue: new SerialQueue(),
      outboxes: directory({ p: new MemoryOutbox() }),
      snapshots,
    });
    const response = await protocol.router.handle(
      new MemoryConnection("main"),
      rpc("snapshot.get", { project: "p", views: ["inbox"] }, 1),
    );
    expect(response && "error" in response && response.error.code).toBe(JSON_RPC_SNAPSHOT_ITEM_TOO_LARGE);
  });

  it("reads Board and feature progress through the ReadModelRepo adapter", async () => {
    let boardCalls = 0;
    const readModels: Pick<ReadModelRepo, "getBoardSummary" | "getFeatureProgress"> = {
      async getBoardSummary() {
        boardCalls += 1;
        return { lanes: [{ feature: "F1", state: "READY", n: 2 }] };
      },
      async getFeatureProgress() {
        return [{ feature: "F1", requirements: [{ status: "passing", n: 3 }] }];
      },
    };
    const inbox: KeysetReader = {
      async readAfter(afterKey) {
        if (afterKey !== null) return { items: [], done: true };
        return { items: [{ id: "in-1", kind: "question" }], done: true };
      },
    };
    const holds: KeysetReader = {
      async readAfter(afterKey) {
        if (afterKey !== null) return { items: [], done: true };
        return { items: [{ id: "hold-1", reason: "question" }], done: true };
      },
    };
    const runtime: KeysetReader = {
      async readAfter(afterKey) {
        if (afterKey !== null) return { items: [], done: true };
        return { items: [{ id: "feature:F1", state: "building" }], done: true };
      },
    };
    const budget: KeysetReader = {
      async readAfter(afterKey) {
        if (afterKey !== null) return { items: [], done: true };
        return { items: [{ id: "project", spent: 1, reserved: 2 }], done: true };
      },
    };
    const outbox = new MemoryOutbox();
    outbox.highWater = 12;
    outbox.epoch = "epoch-9";
    const source = snapshotSourceFromReadModels((projectId) =>
      projectId === "p" ? { readModels, inbox, holds, runtime, budget, outbox } : undefined,
    );
    const protocol = createSessionProtocol({
      writeQueue: new SerialQueue(),
      outboxes: directory({ p: outbox }),
      snapshots: source,
    });
    const body = resultOf(
      await protocol.router.handle(
        new MemoryConnection("main"),
        rpc(
          "snapshot.get",
          { project: "p", views: ["board", "feature_progress", "inbox", "holds", "runtime", "budget"] },
          1,
        ),
      ),
    );
    expect(body.as_of_seq).toBe(12);
    expect(body.stream_epoch).toBe("epoch-9");
    expect(body.sections.board).toEqual([{ id: "board", lanes: [{ feature: "F1", state: "READY", n: 2 }] }]);
    expect(body.sections.feature_progress).toEqual([
      { id: "F1", feature: "F1", requirements: [{ status: "passing", n: 3 }] },
    ]);
    expect(body.sections.inbox).toEqual([{ id: "in-1", kind: "question" }]);
    expect(body.sections.holds).toEqual([{ id: "hold-1", reason: "question" }]);
    expect(body.sections.runtime).toEqual([{ id: "feature:F1", state: "building" }]);
    expect(body.sections.budget).toEqual([{ id: "project", spent: 1, reserved: 2 }]);
    expect(boardCalls).toBe(1);
    expect(body.nextCursor).toBeNull();
  });
});
