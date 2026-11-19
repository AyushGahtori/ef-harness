import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sha256File, verifyArchive } from "../src/binaries.ts";
import { POSTGRES_TEMPLATE_CLONE_SQL, PORT_MAX, PORT_MIN } from "../src/constants.ts";
import { SpikeError, ReadinessTimeoutError } from "../src/errors.ts";
import { InProcessMailpit } from "../src/mailpit-fake.ts";
import { searchMail, sendSmtp } from "../src/mail-client.ts";
import { clearStalePostmasterLock, initdbArgs, readPostmasterPid } from "../src/postgres.ts";
import { assertLoopbackHost, canConnect, reserveLoopbackPort } from "../src/ports.ts";
import { InProcessRedis } from "../src/redis-fake.ts";
import { probeRedisBasics } from "../src/redis-client.ts";
import { waitUntilReady } from "../src/readiness.ts";

describe("service wrappers", () => {
  it("reserves distinct loopback ports inside 41000-48999 and retries EADDRINUSE", async () => {
    const blocked = await reserveLoopbackPort();
    let first = true;
    const next = await reserveLoopbackPort({
      nextPort: () => {
        if (first) {
          first = false;
          return blocked.port;
        }
        return blocked.port + 1;
      },
    });
    expect(next.port).toBeGreaterThanOrEqual(PORT_MIN);
    expect(next.port).toBeLessThanOrEqual(PORT_MAX);
    expect(next.port).not.toBe(blocked.port);
    await next.release();
    await blocked.release();
  });

  it("refuses a non-loopback bind", () => {
    expect(() => assertLoopbackHost("0.0.0.0")).toThrow(SpikeError);
    expect(() => assertLoopbackHost("::")).toThrow(/127\.0\.0\.1/);
  });

  it("returns captured logs when a readiness probe times out", async () => {
    const error = await waitUntilReady({
      service: "example",
      timeoutMs: 40,
      intervalMs: 10,
      probe: async () => false,
      logs: () => "stderr: missing runtime",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ReadinessTimeoutError);
    expect(String(error)).toContain("missing runtime");
  });

  it("clears a dead postmaster.pid and keeps a live one", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ef-postmaster-"));
    try {
      expect(clearStalePostmasterLock(dir)).toBe("absent");
      writeFileSync(path.join(dir, "postmaster.pid"), "999999\n");
      expect(clearStalePostmasterLock(dir)).toBe("cleared");
      expect(readPostmasterPid(dir)).toBeNull();
      writeFileSync(path.join(dir, "postmaster.pid"), `${process.pid}\n`);
      expect(clearStalePostmasterLock(dir)).toBe("live");
      expect(readPostmasterPid(dir)).toBe(process.pid);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds template clone SQL that terminates backends and freezes the template", () => {
    expect(POSTGRES_TEMPLATE_CLONE_SQL).toContain("pg_terminate_backend");
    expect(POSTGRES_TEMPLATE_CLONE_SQL).toContain("datallowconn = false");
    expect(POSTGRES_TEMPLATE_CLONE_SQL).toContain("CREATE DATABASE env_1 TEMPLATE tpl_spike");
    expect(POSTGRES_TEMPLATE_CLONE_SQL).toContain("CREATE DATABASE env_2 TEMPLATE tpl_spike");
    expect(initdbArgs("D:\\data")).toEqual([
      "-D",
      "D:\\data",
      "--username=spike",
      "--auth=trust",
      "--encoding=UTF8",
      "--locale=C",
      "--no-instructions",
    ]);
  });

  it("refuses an archive whose SHA-256 does not match the pin", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ef-hash-"));
    const file = path.join(dir, "component.bin");
    try {
      writeFileSync(file, "not-the-pinned-bytes");
      const actual = await sha256File(file);
      await expect(verifyArchive(file, "a".repeat(64))).rejects.toThrow(/SHA-256 mismatch/);
      expect(actual).not.toBe("a".repeat(64));
      expect(readFileSync(file, "utf8")).toBe("not-the-pinned-bytes");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("isolates redis database indexes and mail recipients in the in-process fakes", async () => {
    const redisPort = await reserveLoopbackPort();
    const smtp = await reserveLoopbackPort();
    const http = await reserveLoopbackPort();
    await redisPort.unhold();
    await smtp.unhold();
    await http.unhold();
    const redis = await InProcessRedis.start(redisPort.port);
    const mail = await InProcessMailpit.start(smtp.port, http.port);
    try {
      const probed = await probeRedisBasics(redis.port);
      expect(probed.selectIsolated).toBe(true);
      expect(probed.commands.find((command) => command.command === "GET")?.ok).toBe(true);
      expect(probed.commands.find((command) => command.command === "HSET")?.ok).toBe(true);
      expect(probed.commands.find((command) => command.command === "ZADD")?.ok).toBe(true);
      expect(probed.commands.find((command) => command.command === "EXPIRE")?.ok).toBe(true);
      expect(probed.commands.find((command) => command.command === "EVAL")?.ok).toBe(true);
      expect(probed.commands.find((command) => command.command === "PUBLISH")?.ok).toBe(true);
      expect(probed.commands.find((command) => command.command === "SUBSCRIBE")?.ok).toBe(true);
      expect(await canConnect("::1", redis.port, 300)).toBe(false);
      await sendSmtp({
        port: mail.smtpPort,
        from: "spike@example.test",
        to: "one@env1.test",
        subject: "env1",
        body: "hello env1",
      });
      await sendSmtp({
        port: mail.smtpPort,
        from: "spike@example.test",
        to: "two@env2.test",
        subject: "env2",
        body: "hello env2",
      });
      const env1 = await searchMail(mail.httpPort, "to:one@env1.test");
      const env2 = await searchMail(mail.httpPort, "to:two@env2.test");
      expect(env1.messages.map((message) => message.Subject)).toEqual(["env1"]);
      expect(env2.messages.map((message) => message.Subject)).toEqual(["env2"]);
      expect(env1.messages.some((message) => message.Snippet.includes("env2"))).toBe(false);
    } finally {
      await redis.stop();
      await mail.stop();
      await redisPort.release();
      await smtp.release();
      await http.release();
    }
  });
});
