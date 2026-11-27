import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FrameCodec } from "../src/bootstrap/frame-codec.js";
import { PipeClientBridge, type PortLike } from "../src/bootstrap/pipe-client.js";

describe("PipeClientBridge", () => {
  it("delivers a coalesced hello and event to two windows without dropping or duplicating bytes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-pipe-"));
    const sock = path.join(dir, "pipe.sock");
    const helloBody = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }));
    const firstBody = Buffer.from(JSON.stringify({ jsonrpc: "2.0", method: "events.batch", params: { n: 1 } }));
    const secondBody = Buffer.from(JSON.stringify({ jsonrpc: "2.0", method: "events.batch", params: { n: 2 } }));
    const hello = FrameCodec.encodeJson(helloBody);
    const first = FrameCodec.encodeJson(firstBody);
    const second = FrameCodec.encodeJson(secondBody);
    const server = net.createServer((socket) => {
      socket.on("data", () => {
        socket.write(Buffer.concat([hello, first, second.subarray(0, 3)]));
        setTimeout(() => {
          socket.write(second.subarray(3));
        }, 30);
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(sock, () => resolve());
    });
    fs.writeFileSync(path.join(dir, "session.token"), "session-token\n");
    const left = new RecordingPort();
    const right = new RecordingPort();
    const bridge = new PipeClientBridge({ profileDir: dir, pipePath: sock });
    bridge.bindWindow("main", left);
    bridge.bindWindow("popout", right);
    const deadline = Date.now() + 3_000;
    while (left.frames().length < 2 && Date.now() < deadline) {
      await delay(20);
    }
    bridge.stop();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    expect(left.statuses).toEqual(["connected"]);
    expect(right.statuses).toEqual(["connected"]);
    expect(left.frames().map((frame) => Buffer.from(frame.payload).toString("utf8"))).toEqual([
      firstBody.toString("utf8"),
      secondBody.toString("utf8"),
    ]);
    expect(right.frames().map((frame) => Buffer.from(frame.payload).toString("utf8"))).toEqual([
      firstBody.toString("utf8"),
      secondBody.toString("utf8"),
    ]);
    expect(left.rawPayloads.join("")).not.toContain('"id":1');
    expect(right.rawPayloads.join("")).not.toContain('"id":1');
  });
});

class RecordingPort implements PortLike {
  readonly statuses: string[] = [];
  readonly rawPayloads: string[] = [];
  private readonly codec = new FrameCodec();

  start(): void {}

  postMessage(message: unknown): void {
    if (!message || typeof message !== "object") return;
    const record = message as { type?: string; status?: string; payload?: string };
    if (record.type === "status" && typeof record.status === "string") {
      this.statuses.push(record.status);
      return;
    }
    if (record.type === "bytes" && typeof record.payload === "string") {
      this.rawPayloads.push(record.payload);
    }
  }

  on(): void {}

  frames(): ReturnType<FrameCodec["push"]> {
    const decoded = [];
    for (const payload of this.rawPayloads) {
      decoded.push(...this.codec.push(Buffer.from(payload, "base64")));
    }
    return decoded;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
