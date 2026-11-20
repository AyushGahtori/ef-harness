import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE_NAME,
  ManualClock,
  RedisClient,
  RedisCompatibleProvider,
  RedisDbIndexAllocator,
  RedisProtocolServer,
  ServiceStartFailedError,
  encodeRespCommand,
  isDangerousSharedRedisCommand,
  renderRedisIsolationConfig,
  resolveRedisServerChoice,
  type JobHandle,
  type RedisClusterLauncher,
  type RedisLaunchRequest,
  type RedisServerRuntime,
} from "../../src/services/index.js";
import { envRequest, makeTemp, removeTemp } from "./helpers.js";

class FakeRedisLauncher implements RedisClusterLauncher {
  calls = 0;
  stops = 0;
  readonly jobs: JobHandle[] = [];
  readonly configs: string[] = [];
  failWith: string | null = null;
  private readonly servers: RedisProtocolServer[] = [];

  async launch(request: RedisLaunchRequest): Promise<RedisServerRuntime> {
    this.calls += 1;
    this.jobs.push(request.job);
    this.configs.push(request.configText);
    if (this.failWith) throw new Error(this.failWith);
    const server = new RedisProtocolServer({ enforceDangerousCommandBan: false });
    const port = await server.start();
    this.servers.push(server);
    const stop = async (): Promise<void> => {
      this.stops += 1;
      await server.stop();
    };
    return {
      pid: 50_000 + this.calls,
      backendPort: port,
      stderr: () => "",
      onExit() {
        return undefined;
      },
      stop,
    };
  }

  async stopAll(): Promise<void> {
    for (const server of this.servers) await server.stop();
  }
}

describe("RedisCompatibleProvider", () => {
  const dirs: string[] = [];
  const providers: RedisCompatibleProvider[] = [];
  const launchers: FakeRedisLauncher[] = [];

  afterEach(async () => {
    for (const provider of providers) await provider.closeProject("project-a");
    providers.length = 0;
    for (const launcher of launchers) await launcher.stopAll();
    launchers.length = 0;
    for (const dir of dirs) await removeTemp(dir);
    dirs.length = 0;
  });

  it("chooses Garnet until a spike decision or env override says otherwise", () => {
    expect(resolveRedisServerChoice({ envValue: "", decisionText: null })).toBe("garnet");
    expect(resolveRedisServerChoice({ envValue: "memurai" })).toBe("memurai");
    expect(resolveRedisServerChoice({ decisionText: "Chosen server: Memurai\n" })).toBe("memurai");
    const config = renderRedisIsolationConfig({ server: "garnet", port: 6379, dataDir: "C:\\data" });
    expect(config).toContain('rename-command FLUSHALL ""');
    expect(config).toContain('rename-command SHUTDOWN ""');
    expect(config).toContain('rename-command CONFIG ""');
    expect(isDangerousSharedRedisCommand("flushall")).toBe(true);
    expect(isDangerousSharedRedisCommand("FLUSHDB")).toBe(false);
  });

  it("assigns distinct indexes, opens another server past 15, and rejects FLUSHALL", async () => {
    const allocator = new RedisDbIndexAllocator();
    const seen = new Set<string>();
    for (let index = 0; index < 16; index += 1) {
      const assigned = allocator.assign(`env-${index}`, 1);
      expect(assigned.placements[0]?.serverKey).toBe("redis-0");
      seen.add(String(assigned.placements[0]?.indexes[0]));
    }
    expect(seen.size).toBe(16);
    const overflow = allocator.assign("env-16", 1);
    expect(overflow.placements[0]?.serverKey).toBe("redis-1");
    const wide = new RedisDbIndexAllocator().assign("wide", 20);
    expect(wide.placements).toHaveLength(2);
    expect(wide.placements.reduce((total, placement) => total + placement.indexes.length, 0)).toBe(20);

    const root = await makeTemp("redis-guard-");
    dirs.push(root);
    const launcher = new FakeRedisLauncher();
    launchers.push(launcher);
    const provider = new RedisCompatibleProvider({
      launcher,
      home: root,
      idleGraceMs: 0,
      server: "garnet",
      envValue: "",
      decisionText: null,
    });
    providers.push(provider);
    const first = await provider.create(envRequest(root, "one"));
    const second = await provider.create(envRequest(root, "two"));
    expect(launcher.calls).toBe(1);
    expect(launcher.jobs[0]?.killOnCloseFlag).toBe(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE_NAME);
    expect(launcher.configs[0]).toContain('rename-command FLUSHALL ""');
    expect(first.dbIndex).not.toBe(second.dbIndex);
    expect(first.port).toBe(second.port);
    const left = await RedisClient.connect(first.port);
    const right = await RedisClient.connect(second.port);
    try {
      expect((await left.command(["SELECT", String(first.dbIndex)])).type).toBe("simple");
      expect((await right.command(["SELECT", String(second.dbIndex)])).type).toBe("simple");
      expect((await left.command(["SET", "token", "alpha"])).type).toBe("simple");
      expect((await right.command(["SET", "token", "beta"])).type).toBe("simple");
      const flushed = await left.command(["FLUSHALL"]);
      expect(flushed.type).toBe("error");
      expect(flushed.type === "error" ? flushed.text : "").toContain("disabled on the shared Redis server");
      expect(await left.command(["GET", "token"])).toMatchObject({ type: "bulk", text: "alpha" });
      expect(await right.command(["GET", "token"])).toMatchObject({ type: "bulk", text: "beta" });
      await provider.resetData("one");
      expect(await left.command(["GET", "token"])).toMatchObject({ type: "bulk", text: null });
      expect(await right.command(["GET", "token"])).toMatchObject({ type: "bulk", text: "beta" });
    } finally {
      left.close();
      right.close();
    }
    await provider.destroy("one");
    const survivor = await RedisClient.connect(second.port);
    try {
      await survivor.command(["SELECT", String(second.dbIndex)]);
      expect(await survivor.command(["GET", "token"])).toMatchObject({ type: "bulk", text: "beta" });
      await survivor.command(["SELECT", String(first.dbIndex)]);
      expect(await survivor.command(["GET", "token"])).toMatchObject({ type: "bulk", text: null });
    } finally {
      survivor.close();
    }
  });

  it("uses the in-process fake only for an explicit Tier 1 request and spills to a second server", async () => {
    const root = await makeTemp("redis-fake-");
    dirs.push(root);
    const launcher = new FakeRedisLauncher();
    launchers.push(launcher);
    const provider = new RedisCompatibleProvider({
      launcher,
      home: root,
      idleGraceMs: 0,
      server: "memurai",
      envValue: "",
      decisionText: null,
    });
    providers.push(provider);
    await expect(provider.create(envRequest(root, "early", { inProcessFake: true }))).rejects.toThrow(
      /Tier 1/,
    );
    expect(launcher.calls).toBe(0);
    const ports = new Set<number>();
    for (let index = 0; index < 17; index += 1) {
      const connection = await provider.create(
        envRequest(root, `e${index}`, { tier: 1, inProcessFake: true }),
      );
      ports.add(connection.port);
      expect(connection.inProcess).toBe(true);
    }
    expect(launcher.calls).toBe(0);
    expect(ports.size).toBe(2);
  });

  it("holds the dependent task when the redis binary cannot start", async () => {
    const root = await makeTemp("redis-missing-");
    dirs.push(root);
    const provider = new RedisCompatibleProvider({
      home: root,
      idleGraceMs: 0,
      server: "garnet",
      envValue: "",
      decisionText: null,
    });
    providers.push(provider);
    await expect(provider.create(envRequest(root, "one"))).rejects.toMatchObject({
      hint: "Offer Docker fallback",
      holdDependentTaskOnly: true,
      workerQualityPenalty: false,
    });
    const launcher = new FakeRedisLauncher();
    launcher.failWith = "antivirus quarantine blocked GarnetServer.exe";
    launchers.push(launcher);
    const failing = new RedisCompatibleProvider({
      launcher,
      home: root,
      idleGraceMs: 0,
      envValue: "",
      decisionText: null,
    });
    providers.push(failing);
    try {
      await failing.create(envRequest(root, "two"));
      expect.fail("redis start should have failed");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceStartFailedError);
      expect((error as ServiceStartFailedError).message).toContain("Offer Docker fallback");
      expect((error as ServiceStartFailedError).logs).toContain("antivirus quarantine");
    }
  });

  it("shuts the shared redis server down after the idle grace hits zero environments", async () => {
    const root = await makeTemp("redis-idle-");
    dirs.push(root);
    const clock = new ManualClock();
    const launcher = new FakeRedisLauncher();
    launchers.push(launcher);
    const provider = new RedisCompatibleProvider({
      launcher,
      home: root,
      clock,
      idleGraceMs: 500,
      envValue: "",
      decisionText: null,
    });
    providers.push(provider);
    expect(launcher.calls).toBe(0);
    await provider.create(envRequest(root, "one"));
    await provider.create(envRequest(root, "two"));
    expect(launcher.calls).toBe(1);
    await provider.destroy("one");
    await provider.destroy("two");
    await clock.advance(499);
    expect(launcher.calls).toBe(1);
    const stillThere = await RedisClient.connect(
      (await provider.create(envRequest(root, "three"))).port,
    );
    stillThere.close();
    expect(launcher.calls).toBe(1);
    await provider.destroy("three");
    expect(launcher.stops).toBe(0);
    await clock.advance(500);
    expect(launcher.stops).toBe(1);
  });

  it("answers a ping that arrives one byte at a time and keeps databases isolated in-process", async () => {
    const server = new RedisProtocolServer({ enforceDangerousCommandBan: true });
    const port = await server.start();
    try {
      const socket = net.connect({ host: "127.0.0.1", port });
      const chunks: Buffer[] = [];
      socket.on("data", (chunk: Buffer) => chunks.push(chunk));
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", () => resolve());
        socket.once("error", reject);
      });
      const payload = encodeRespCommand(["PING"]);
      for (const byte of payload) {
        socket.write(Buffer.from([byte]));
      }
      const started = Date.now();
      while (!Buffer.concat(chunks).toString("utf8").includes("+PONG")) {
        if (Date.now() - started > 1_000) {
          throw new Error(`redis reply was ${JSON.stringify(Buffer.concat(chunks).toString("utf8"))}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const client = await RedisClient.connect(port);
      try {
        await client.command(["SELECT", "0"]);
        await client.command(["SET", "k", "zero"]);
        await client.command(["SELECT", "1"]);
        await client.command(["SET", "k", "one"]);
        const denied = await client.command(["SHUTDOWN"]);
        expect(denied.type).toBe("error");
        await client.command(["SELECT", "0"]);
        expect(await client.command(["GET", "k"])).toMatchObject({ text: "zero" });
        await client.command(["FLUSHDB"]);
        expect(await client.command(["GET", "k"])).toMatchObject({ text: null });
        await client.command(["SELECT", "1"]);
        expect(await client.command(["GET", "k"])).toMatchObject({ text: "one" });
      } finally {
        client.close();
      }
      expect(server.stats().flushDbCount).toBe(1);
      expect(server.stats().rejectedDangerous).toBe(1);
    } finally {
      await server.stop();
    }
  });
});
