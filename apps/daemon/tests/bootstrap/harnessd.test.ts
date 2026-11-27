import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildDetachedHarnessdSpawn } from "../../src/bootstrap/spawn.js";
import { FrameCodec } from "../../src/bootstrap/frame-codec.js";
import { lockFilePath, profileFromLocalAppData, userPipePath } from "../../src/bootstrap/paths.js";
import { readProcessStartTime } from "../../src/bootstrap/process-lock.js";
import { PipeClient, repoRoot, startDaemon, tempProfile, uniquePipe, waitForExit } from "./support.js";

describe("bootstrap harnessd", () => {
  it("names the per-user pipe and profile, and spawns detached electron-as-node", () => {
    expect(userPipePath("Ada Lovelace")).toBe("\\\\.\\pipe\\efharness-Ada_Lovelace");
    expect(profileFromLocalAppData("C:\\Users\\Ada\\AppData\\Local")).toBe(
      path.join("C:\\Users\\Ada\\AppData\\Local", "EFHarness"),
    );
    const spec = buildDetachedHarnessdSpawn({
      command: "C:\\Program Files\\EF Harness\\electron.exe",
      scriptArgs: ["harnessd-main.js"],
      env: { PATH: "C:\\Windows" },
    });
    expect(spec.options.detached).toBe(true);
    expect(spec.options.stdio).toBe("ignore");
    expect(spec.unref).toBe(true);
    expect(spec.options.env?.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(spec.command).toContain("electron.exe");
  });

  it("reassembles split frames and rejects an oversized length before buffering the body", () => {
    const codec = new FrameCodec();
    const payload = Buffer.from(JSON.stringify({ ok: true }));
    const frame = FrameCodec.encodeJson(payload);
    expect(codec.push(frame.subarray(0, 1))).toEqual([]);
    expect(codec.push(frame.subarray(1, 3))).toEqual([]);
    const decoded = codec.push(frame.subarray(3));
    expect(Buffer.from(decoded[0]?.payload ?? []).toString("utf8")).toBe(payload.toString("utf8"));
    const hostile = new FrameCodec();
    const header = Buffer.alloc(4);
    header.writeUInt32BE(2_000_000, 0);
    expect(() => hostile.push(header)).toThrow(/exceeds/);
  });

  it("rejects a wrong session token and any method before session.hello", async () => {
    const profile = tempProfile("auth");
    const pipe = uniquePipe("auth");
    const daemon = await startDaemon({ profile, pipe, simTask: false, idleMs: 30_000 });
    try {
      const wrong = await rawCall(pipe, {
        jsonrpc: "2.0",
        id: 1,
        method: "session.hello",
        params: { token: "0".repeat(64), protocol: "1.1", client: "test" },
      });
      expect(wrong.error?.code).toBe(-32001);
      const early = await rawCall(pipe, { jsonrpc: "2.0", id: 2, method: "build.stop", params: { op_id: "x" } });
      expect(early.error?.code).toBe(-32001);
    } finally {
      await daemon.stop();
    }
  }, 30_000);

  it("closes a connection that never sends session.hello", async () => {
    const profile = tempProfile("slow");
    const pipe = uniquePipe("slow");
    const daemon = await startDaemon({ profile, pipe, handshakeMs: 300, idleMs: 30_000 });
    try {
      const closed = await new Promise<boolean>((resolve) => {
        const socket = net.connect(pipe);
        socket.on("close", () => resolve(true));
        socket.on("error", () => resolve(true));
        setTimeout(() => resolve(false), 2_000);
      });
      expect(closed).toBe(true);
    } finally {
      await daemon.stop();
    }
  }, 20_000);

  it("survives the parent process exiting", async () => {
    const profile = tempProfile("detach");
    const pipe = uniquePipe("detach");
    const daemon = await startDaemon({ profile, pipe, detachedParent: true, simTask: true, simStepMs: 30, idleMs: 60_000 });
    try {
      expect(alive(daemon.pid)).toBe(true);
      const client = await PipeClient.connect(pipe, daemon.token());
      const status = (await client.request("daemon.status", {})) as { daemonVersion: string; pid: number };
      expect(status.pid).toBe(daemon.pid);
      expect(status.daemonVersion).toBe("0.0.0");
      const ready = JSON.parse(fs.readFileSync(path.join(profile, "harnessd.ready.json"), "utf8")) as {
        electronRunAsNode: boolean;
      };
      expect(ready.electronRunAsNode).toBe(true);
      client.close();
    } finally {
      await daemon.stop();
    }
  }, 30_000);

  it("parks on version mismatch and truncates the WAL", async () => {
    const profile = tempProfile("park");
    const pipe = uniquePipe("park");
    const first = await startDaemon({ profile, pipe, version: "0.1.0", simTask: true, simStepMs: 20, idleMs: 60_000 });
    const client = await PipeClient.connect(pipe, first.token());
    const result = (await client.request("daemon.parkAndExit", { op_id: "park-1" })) as { accepted: boolean };
    expect(result.accepted).toBe(true);
    client.close();
    await waitForExit(first.pid, 8_000);
    const receipt = JSON.parse(fs.readFileSync(path.join(profile, "harnessd.shutdown.json"), "utf8")) as {
      reason: string;
      wal: { global: { busy: number }; state: { busy: number } };
      readersClosed: number;
      closed: string[];
    };
    expect(receipt.reason).toBe("version-mismatch");
    expect(receipt.wal.global.busy).toBe(0);
    expect(receipt.wal.state.busy).toBe(0);
    expect(receipt.readersClosed).toBe(2);
    expect(receipt.closed).toEqual(["global.db", "state.db"]);
    for (const file of ["global.db", path.join("projects", "m1", "state.db")]) {
      const wal = path.join(profile, `${file}-wal`);
      if (fs.existsSync(wal)) expect(fs.statSync(wal).size).toBe(0);
    }
    const second = await startDaemon({ profile, pipe, version: "0.2.0", simTask: false, idleMs: 60_000 });
    try {
      const again = await PipeClient.connect(pipe, second.token());
      const status = (await again.request("daemon.status", {})) as { daemonVersion: string };
      expect(status.daemonVersion).toBe("0.2.0");
      again.close();
    } finally {
      await second.stop();
    }
  }, 40_000);

  it("shuts down on idle only when no window and no active task are left", async () => {
    const profile = tempProfile("idle");
    const pipe = uniquePipe("idle");
    const daemon = await startDaemon({ profile, pipe, simTask: false, idleMs: 400 });
    const client = await PipeClient.connect(pipe, daemon.token());
    client.close();
    await waitForExit(daemon.pid, 5_000);
    const receipt = JSON.parse(fs.readFileSync(path.join(profile, "harnessd.shutdown.json"), "utf8")) as { reason: string };
    expect(receipt.reason).toBe("idle");
  }, 20_000);

  it("stops an active task once and replays the same op_id", async () => {
    const profile = tempProfile("stop");
    const pipe = uniquePipe("stop");
    const daemon = await startDaemon({ profile, pipe, simTask: true, simStepMs: 30_000, idleMs: 60_000 });
    try {
      const client = await PipeClient.connect(pipe, daemon.token());
      const stopped = (await client.request("build.stop", { op_id: "stop-1", project: "m1" })) as {
        stopped: boolean;
        state: string;
      };
      expect(stopped.stopped).toBe(true);
      expect(stopped.state).toBe("PARKED");
      const again = (await client.request("build.stop", { op_id: "stop-1", project: "m1" })) as {
        stopped: boolean;
        state: string;
      };
      expect(again).toEqual(stopped);
      await expect(client.request("build.stop", { op_id: "stop-1", project: "other" })).rejects.toThrow(/conflict/);
      const snap = (await client.request("snapshot.get", { project: "m1" })) as {
        sections: { m1: { state: string; live: boolean } };
      };
      expect(snap.sections.m1.state).toBe("PARKED");
      expect(snap.sections.m1.live).toBe(true);
      client.close();
    } finally {
      await daemon.stop();
    }
  }, 30_000);

  it("keeps running after the viewer disconnects and replays the accepted commit", async () => {
    const profile = tempProfile("survive");
    const pipe = uniquePipe("survive");
    const daemon = await startDaemon({ profile, pipe, simTask: true, simStepMs: 40, idleMs: 60_000 });
    try {
      const first = await PipeClient.connect(pipe, daemon.token());
      first.close();
      expect(alive(daemon.pid)).toBe(true);
      await delay(400);
      const second = await PipeClient.connect(pipe, daemon.token());
      const snap = (await second.request("snapshot.get", { project: "m1" })) as {
        sections: { m1: { state: string; ref: string; visited: string[]; receipt: { trailer: string } | null } };
      };
      const deadline = Date.now() + 5_000;
      let view = snap.sections.m1;
      while (view.state !== "ACCEPTED" && Date.now() < deadline) {
        await delay(40);
        const next = (await second.request("snapshot.get", { project: "m1" })) as typeof snap;
        view = next.sections.m1;
      }
      expect(view.state).toBe("ACCEPTED");
      expect(view.visited.join(" → ")).toContain("LEASED → CODING → STATIC_AUDIT → CLEAN_VERIFY → ACCEPTED");
      expect(view.ref).toBe("harness/f/F12");
      expect(view.receipt?.trailer).toBe("Harness-Task: T03");
      const diff = (await second.request("diff.get", { task: "T03", file: "src/print.ts", hunks: [0] })) as {
        hunks: Array<{ lines: Array<{ text: string }> }>;
      };
      const text = diff.hunks.flatMap((hunk) => hunk.lines.map((line) => line.text)).join("\n");
      expect(text).toContain("toPrintRows");
      second.close();
    } finally {
      await daemon.stop();
    }
  }, 30_000);

  it("streams a candidate diff above 1 MB on channel 1", async () => {
    const profile = tempProfile("diff");
    const pipe = uniquePipe("diff");
    const daemon = await startDaemon({
      profile,
      pipe,
      simTask: false,
      idleMs: 30_000,
      largeDiffBytes: 1_200_000,
    });
    try {
      const client = await PipeClient.connect(pipe, daemon.token());
      const summary = (await client.request("diff.get", { task: "T03", file: "src/print.ts" })) as {
        files: Array<{ hunks: number }>;
      };
      expect(JSON.stringify(summary).length).toBeLessThan(20_000);
      expect(JSON.stringify(summary)).not.toContain("xxxxx");
      const opened = (await client.request("diff.get", { task: "T03", file: "src/print.ts", hunks: [0] })) as {
        streamId: number;
        totalBytes: number;
        sha256: string;
      };
      expect(opened.totalBytes).toBeGreaterThan(1_048_576);
      await client.request("stream.credit", { streamId: opened.streamId, chunks: 64 });
      const deadline = Date.now() + 5_000;
      let bytes = client.binaryBytes(opened.streamId);
      while (bytes.length < opened.totalBytes && Date.now() < deadline) {
        await delay(20);
        bytes = client.binaryBytes(opened.streamId);
      }
      expect(bytes.length).toBe(opened.totalBytes);
      expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe(opened.sha256);
      const notes = JSON.stringify(client.notifications());
      expect(notes).not.toContain("xxxxx");
      client.close();
    } finally {
      await daemon.stop();
    }
  }, 30_000);

  it("isolates two profiles and replaces a stale session token", async () => {
    const first = await startDaemon({ profile: tempProfile("user-a"), pipe: uniquePipe("user-a"), idleMs: 30_000 });
    const second = await startDaemon({ profile: tempProfile("user-b"), pipe: uniquePipe("user-b"), idleMs: 30_000 });
    try {
      const a = await PipeClient.connect(first.pipe, first.token());
      const b = await PipeClient.connect(second.pipe, second.token());
      const statusA = (await a.request("daemon.status", {})) as { pid: number };
      const statusB = (await b.request("daemon.status", {})) as { pid: number };
      expect(statusA.pid).not.toBe(statusB.pid);
      a.close();
      b.close();
    } finally {
      await first.stop();
      await second.stop();
    }
    const stale = fs.readFileSync(path.join(first.profile, "session.token"), "utf8").trim();
    const restarted = await startDaemon({ profile: first.profile, pipe: first.pipe, idleMs: 30_000 });
    try {
      expect(restarted.token()).not.toBe(stale);
      const rejected = await rawCall(first.pipe, {
        jsonrpc: "2.0",
        id: 1,
        method: "session.hello",
        params: { token: stale, protocol: "1.1", client: "test" },
      });
      expect(rejected.error?.code).toBe(-32001);
    } finally {
      await restarted.stop();
    }
  }, 40_000);

  it("replays outbox events in order and asks for a resync on an epoch mismatch", async () => {
    const profile = tempProfile("replay");
    const pipe = uniquePipe("replay");
    const daemon = await startDaemon({ profile, pipe, simTask: true, simStepMs: 30, idleMs: 60_000 });
    try {
      const client = await PipeClient.connect(pipe, daemon.token());
      const subscribed = (await client.request("events.subscribe", {
        project: "m1",
        topics: ["m1"],
        since_seq: 0,
        stream_epoch: 1,
      })) as { status: string };
      expect(subscribed.status).toBe("live");
      const deadline = Date.now() + 5_000;
      let events = batchEvents(client.notifications());
      while (!events.some((event) => event.payload.state === "ACCEPTED") && Date.now() < deadline) {
        await delay(40);
        events = batchEvents(client.notifications());
      }
      expect(events.at(-1)?.payload.state).toBe("ACCEPTED");
      expect(events.map((event) => event.payload.state).join(" → ")).toContain(
        "LEASED → CODING → STATIC_AUDIT → CLEAN_VERIFY → ACCEPTED",
      );
      for (let index = 1; index < events.length; index += 1) {
        expect(events[index]?.seq).toBe((events[index - 1]?.seq ?? 0) + 1);
      }
      const mismatch = (await client.request("events.subscribe", {
        project: "m1",
        since_seq: 0,
        stream_epoch: 99,
      })) as { status: string };
      expect(mismatch.status).toBe("resync_required");
      client.close();
    } finally {
      await daemon.stop();
    }
  }, 30_000);

  it("parks an active task on build.stop and returns the same result for the same op_id", async () => {
    const profile = tempProfile("stop");
    const pipe = uniquePipe("stop");
    const daemon = await startDaemon({ profile, pipe, simTask: true, simStepMs: 10_000, idleMs: 60_000 });
    try {
      const client = await PipeClient.connect(pipe, daemon.token());
      const stopped = (await client.request("build.stop", { op_id: "stop-1", project: "m1" })) as {
        stopped: boolean;
        state: string;
      };
      expect(stopped.stopped).toBe(true);
      expect(stopped.state).toBe("PARKED");
      const again = (await client.request("build.stop", { op_id: "stop-1", project: "m1" })) as {
        stopped: boolean;
        state: string;
      };
      expect(again).toEqual(stopped);
      client.close();
    } finally {
      await daemon.stop();
    }
  }, 20_000);

  it("replaces a reused pid lock and refuses a live process with the same start time", async () => {
    const staleProfile = tempProfile("lock-stale");
    fs.writeFileSync(
      lockFilePath(staleProfile),
      JSON.stringify({ pid: 2_147_483_647, processStartTime: "1" }),
    );
    const stale = await startDaemon({
      profile: staleProfile,
      pipe: uniquePipe("lock-stale"),
      simTask: false,
      idleMs: 30_000,
    });
    await stale.stop();

    const heldProfile = tempProfile("lock-held");
    const start = readProcessStartTime(process.pid);
    expect(start).not.toBeNull();
    fs.writeFileSync(lockFilePath(heldProfile), JSON.stringify({ pid: process.pid, processStartTime: start }));
    await expect(
      startDaemon({ profile: heldProfile, pipe: uniquePipe("lock-held"), simTask: false, idleMs: 30_000 }),
    ).rejects.toThrow(/already in use/);
  }, 30_000);

  it("keeps the M1 viewer on escaped text, strict CSP, and Electron isolation defaults", () => {
    const root = repoRoot();
    const client = fs.readFileSync(path.join(root, "apps/renderer/src/m1-viewer/viewer-client.js"), "utf8");
    const html = fs.readFileSync(path.join(root, "apps/renderer/src/m1-viewer/index.html"), "utf8");
    const security = fs.readFileSync(path.join(root, "apps/desktop/src/bootstrap/security.ts"), "utf8");
    const preload = fs.readFileSync(path.join(root, "apps/desktop/src/bootstrap/preload.ts"), "utf8");
    expect(client).not.toContain("innerHTML");
    expect(client).not.toContain("dangerouslySetInnerHTML");
    expect(client).toContain("textContent");
    expect(client).toContain("Reconnecting to build engine...");
    expect(html).toContain("default-src 'self'");
    expect(html).not.toContain("unsafe-eval");
    expect(security).toContain("contextIsolation: true");
    expect(security).toContain("nodeIntegration: false");
    expect(security).toContain("sandbox: true");
    expect(preload).toContain('window.postMessage("ef-port"');
    expect(preload).not.toContain("child_process");
    expect(preload).not.toContain('require("fs")');
  });
});

async function rawCall(
  pipe: string,
  message: unknown,
): Promise<{ error?: { code?: number }; result?: unknown }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipe);
    const codec = new FrameCodec();
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("raw call timed out"));
    }, 3_000);
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("connect", () => {
      socket.write(FrameCodec.encodeJson(Buffer.from(JSON.stringify(message))));
    });
    socket.on("data", (chunk: Buffer) => {
      const frames = codec.push(chunk);
      for (const frame of frames) {
        if (frame.channel !== 0) continue;
        clearTimeout(timer);
        socket.end();
        resolve(JSON.parse(Buffer.from(frame.payload).toString("utf8")) as { error?: { code?: number } });
        return;
      }
    });
    socket.on("close", () => {
      clearTimeout(timer);
    });
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function batchEvents(notes: readonly unknown[]): Array<{ seq: number; payload: { state: string } }> {
  const events: Array<{ seq: number; payload: { state: string } }> = [];
  for (const note of notes) {
    if (!note || typeof note !== "object") continue;
    const record = note as {
      method?: string;
      params?: { events?: Array<{ seq: number; payload: { state: string } }> };
    };
    if (record.method !== "events.batch" || !record.params?.events) continue;
    events.push(...record.params.events);
  }
  return events;
}
