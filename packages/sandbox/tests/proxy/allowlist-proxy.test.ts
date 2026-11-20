import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import {
  AllowlistProxyServer,
  BIND_HOST,
  HEADER_READ_TIMEOUT_MS,
  MAX_HEADER_BYTES,
  PORT_LEASE_MIN,
  ProxyConfigError,
  type AllowlistProxyServerOptions,
  type HostResolver,
  type PortLease,
} from "../../src/proxy/index.js";

const closers: (() => Promise<void>)[] = [];
const sockets: net.Socket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const close of closers.splice(0).reverse()) await close();
});

function joinParts(parts: readonly string[]): string {
  return parts.join("");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lease(port: number, expiresAt: number | null = null): PortLease {
  return {
    port,
    projectId: "project-proxy",
    environment: "test",
    leasedAt: 1_000,
    expiresAt,
  };
}

async function allocateLeasePort(): Promise<number> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const port = PORT_LEASE_MIN + Math.floor(Math.random() * 8_000);
    try {
      await new Promise<void>((resolve, reject) => {
        const probe = net.createServer();
        probe.once("error", reject);
        probe.listen(port, BIND_HOST, () => probe.close(() => resolve()));
      });
      return port;
    } catch {
      continue;
    }
  }
  throw new Error("no free leased port");
}

async function startProxy(
  options: Omit<AllowlistProxyServerOptions, "portLease"> & { portLease?: PortLease } = {},
): Promise<AllowlistProxyServer> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const server = new AllowlistProxyServer({
      ...options,
      portLease: options.portLease ?? lease(await allocateLeasePort()),
    });
    try {
      await server.start();
      closers.push(() => server.stop());
      return server;
    } catch (error) {
      lastError = error;
      await server.stop().catch(() => undefined);
    }
  }
  throw lastError;
}

function loopbackResolver(): HostResolver {
  return async () => [{ address: "127.0.0.1", family: 4 }];
}

async function startWeb(
  onRequest: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ port: number; hits: () => number }> {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    onRequest(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, BIND_HOST, () => resolve()));
  closers.push(
    () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("upstream has no port");
  return { port: address.port, hits: () => hits };
}

async function startEcho(): Promise<number> {
  const server = net.createServer((socket) => {
    socket.on("error", () => socket.destroy());
    socket.pipe(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, BIND_HOST, () => resolve()));
  closers.push(
    () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("echo has no port");
  return address.port;
}

function track(socket: net.Socket): net.Socket {
  socket.on("error", () => undefined);
  sockets.push(socket);
  return socket;
}

async function readText(socket: net.Socket, timeoutMs = 2_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("timed out reading proxy response"));
    }, timeoutMs);
    const finish = (): void => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", finish);
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function proxyRequest(input: {
  port: number;
  method: string;
  url: string;
  auth?: string;
  headers?: Readonly<Record<string, string>>;
  body?: string;
}): Promise<{ status: number; raw: string; body: string }> {
  const socket = track(net.connect(input.port, BIND_HOST));
  const pending = readText(socket);
  await once(socket, "connect");
  const headers = [
    `${input.method} ${input.url} HTTP/1.1`,
    `Host: ${new URL(input.url).host}`,
    "Connection: close",
  ];
  if (input.auth) headers.push(`Proxy-Authorization: ${input.auth}`);
  for (const [name, value] of Object.entries(input.headers ?? {}))
    headers.push(`${name}: ${value}`);
  if (input.body) headers.push(`Content-Length: ${Buffer.byteLength(input.body)}`);
  socket.write(`${headers.join("\r\n")}\r\n\r\n${input.body ?? ""}`);
  const raw = await pending;
  const status = Number(/^HTTP\/1\.[01] (\d+)/.exec(raw)?.[1] ?? "0");
  const body = raw.split("\r\n\r\n").slice(1).join("\r\n\r\n");
  return { status, raw, body };
}

describe("AllowlistProxyServer", () => {
  it("binds only the leased loopback port", async () => {
    const server = await startProxy();
    expect(server.bindHost).toBe("127.0.0.1");
    expect(server.listeningAddress).toBe("127.0.0.1");
    expect(server.port).toBeGreaterThanOrEqual(PORT_LEASE_MIN);
    expect(server.headerReadTimeoutMs).toBe(HEADER_READ_TIMEOUT_MS);
    expect(server.maxHeaderBytes).toBe(MAX_HEADER_BYTES);
  });

  it("rejects leases outside the machine port range and expired leases", () => {
    expect(() => new AllowlistProxyServer({ portLease: lease(80) })).toThrow(ProxyConfigError);
    expect(() => new AllowlistProxyServer({ portLease: lease(41_000, 1_000) })).toThrow(/expired/);
  });

  it("refuses the test-only private address override in production", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(
        () =>
          new AllowlistProxyServer({
            portLease: lease(41_000),
            testOnlyPrivateIpAllowlist: ["127.0.0.1"],
          }),
      ).toThrow(/production/);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it("denies every coding-worker destination", async () => {
    const server = await startProxy({
      resolveHost: loopbackResolver(),
      testOnlyPrivateIpAllowlist: ["127.0.0.1"],
    });
    const handle = server.registerAttempt({
      attemptId: "worker-1",
      profile: "coding_worker",
      allowedTestEndpoints: [{ host: "api.openai.com", port: 443 }],
      documentationHosts: ["developer.mozilla.org"],
    });
    for (const url of [
      "http://api.openai.com/v1/models",
      "http://registry.npmjs.org/left-pad",
      "http://developer.mozilla.org/en-US/docs/Web",
      "http://127.0.0.1/secret",
    ]) {
      const response = await proxyRequest({
        port: server.port,
        method: "GET",
        url,
        auth: handle.proxyAuthorization,
      });
      expect(response.status, url).toBe(403);
    }
    expect(
      server.auditLog.recent().every((event) => event.reason === "coding_worker_deny_all"),
    ).toBe(true);
  });

  it("allows a wrapped vendor only its exact provider host", async () => {
    const upstream = await startWeb((req, res) => {
      const proxyHeader = req.headers["proxy-authorization"];
      res.end(`host=${req.headers.host};proxy=${proxyHeader ?? ""}`);
    });
    let lookups = 0;
    const server = await startProxy({
      testOnlyPrivateIpAllowlist: ["127.0.0.1"],
      resolveHost: async (hostname) => {
        lookups += 1;
        expect(hostname).toBe("api.openai.com");
        return [{ address: "127.0.0.1", family: 4 }];
      },
    });
    const handle = server.registerAttempt({
      attemptId: "vendor-openai",
      profile: "wrapped_vendor",
      vendor: "openai",
      allowedTestEndpoints: [{ host: "api.openai.com", port: upstream.port }],
    });
    const allowed = await proxyRequest({
      port: server.port,
      method: "GET",
      url: `http://api.openai.com:${upstream.port}/v1/models`,
      auth: handle.proxyAuthorization,
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body).toContain(`host=api.openai.com:${upstream.port}`);
    expect(allowed.body).toContain("proxy=");
    expect(allowed.body).not.toContain(handle.token);
    expect(lookups).toBe(1);
    for (const url of [
      `http://api.openai.com.evil.com:${upstream.port}/v1`,
      `http://evil-api.openai.com:${upstream.port}/v1`,
      `http://api.openai.com@evil.com:${upstream.port}/v1`,
      `http://chatgpt.com:${upstream.port}/`,
      `http://api.anthropic.com:${upstream.port}/`,
    ]) {
      const denied = await proxyRequest({
        port: server.port,
        method: "GET",
        url,
        auth: handle.proxyAuthorization,
      });
      expect(denied.status, url).toBe(403);
    }
  });

  it("keeps researcher reads on GET and HEAD and blocks other methods", async () => {
    const upstream = await startWeb((_req, res) => res.end("docs"));
    const server = await startProxy({
      testOnlyPrivateIpAllowlist: ["127.0.0.1"],
      resolveHost: loopbackResolver(),
    });
    const handle = server.registerAttempt({
      attemptId: "research-1",
      profile: "researcher",
      documentationHosts: ["docs.example.com", ".example.org"],
      allowedTestEndpoints: [
        { host: "docs.example.com", port: upstream.port },
        { host: "docs.example.org", port: upstream.port },
      ],
    });
    const ok = await proxyRequest({
      port: server.port,
      method: "GET",
      url: `http://docs.example.com:${upstream.port}/guide`,
      auth: handle.proxyAuthorization,
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toContain("docs");
    const suffix = await proxyRequest({
      port: server.port,
      method: "GET",
      url: `http://docs.example.org:${upstream.port}/guide`,
      auth: handle.proxyAuthorization,
    });
    expect(suffix.status).toBe(200);
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const denied = await proxyRequest({
        port: server.port,
        method,
        url: `http://docs.example.com:${upstream.port}/leak`,
        auth: handle.proxyAuthorization,
        body: "secret",
      });
      expect(denied.status, method).toBe(405);
    }
    const outside = await proxyRequest({
      port: server.port,
      method: "GET",
      url: "http://notexample.org/page",
      auth: handle.proxyAuthorization,
    });
    expect(outside.status).toBe(403);
    const spoof = await proxyRequest({
      port: server.port,
      method: "GET",
      url: "http://docs.example.com.evil.com/page",
      auth: handle.proxyAuthorization,
    });
    expect(spoof.status).toBe(403);
  });

  it("isolates verifier endpoints by attempt token", async () => {
    const upstream = await startWeb((_req, res) => res.end("stripe-ok"));
    const server = await startProxy({
      testOnlyPrivateIpAllowlist: ["127.0.0.1"],
      resolveHost: loopbackResolver(),
    });
    const alpha = server.registerAttempt({
      attemptId: "verify-a",
      profile: "verifier_test",
      allowedTestEndpoints: [{ host: "api.stripe.com", port: upstream.port }],
    });
    const beta = server.registerAttempt({
      attemptId: "verify-b",
      profile: "verifier_test",
      allowedTestEndpoints: [{ host: "api.other.test", port: upstream.port }],
    });
    const allowed = await proxyRequest({
      port: server.port,
      method: "GET",
      url: `http://api.stripe.com:${upstream.port}/v1/charges`,
      auth: alpha.proxyAuthorization,
    });
    const isolated = await proxyRequest({
      port: server.port,
      method: "GET",
      url: `http://api.stripe.com:${upstream.port}/v1/charges`,
      auth: beta.proxyAuthorization,
    });
    expect(allowed.status).toBe(200);
    expect(isolated.status).toBe(403);
  });

  it("allows kernel installs only through registry hosts", async () => {
    const upstream = await startWeb((_req, res) => res.end("tarball"));
    const server = await startProxy({
      testOnlyPrivateIpAllowlist: ["127.0.0.1"],
      resolveHost: loopbackResolver(),
    });
    const handle = server.registerAttempt({
      attemptId: "install-1",
      profile: "kernel_installer",
      corporateRegistries: ["npm.corp.example"],
      allowedTestEndpoints: [
        { host: "registry.npmjs.org", port: upstream.port },
        { host: "npm.corp.example", port: upstream.port },
      ],
    });
    const registry = await proxyRequest({
      port: server.port,
      method: "GET",
      url: `http://registry.npmjs.org:${upstream.port}/left-pad`,
      auth: handle.proxyAuthorization,
    });
    const corporate = await proxyRequest({
      port: server.port,
      method: "GET",
      url: `http://npm.corp.example:${upstream.port}/left-pad`,
      auth: handle.proxyAuthorization,
    });
    const spoof = await proxyRequest({
      port: server.port,
      method: "GET",
      url: `http://registry.npmjs.org.evil.com:${upstream.port}/left-pad`,
      auth: handle.proxyAuthorization,
    });
    const lookalike = await proxyRequest({
      port: server.port,
      method: "GET",
      url: `http://evil.npmjs.org:${upstream.port}/left-pad`,
      auth: handle.proxyAuthorization,
    });
    expect(registry.status).toBe(200);
    expect(corporate.status).toBe(200);
    expect(spoof.status).toBe(403);
    expect(lookalike.status).toBe(403);
  });

  it("blocks private addresses, metadata addresses, and mixed DNS answers", async () => {
    const cases: { address: string; family: 4 | 6; url: string }[] = [
      { address: "127.0.0.1", family: 4, url: "http://docs.example.com/meta" },
      { address: "10.0.0.1", family: 4, url: "http://docs.example.com/lan" },
      { address: "169.254.169.254", family: 4, url: "http://docs.example.com/cloud" },
      { address: "::1", family: 6, url: "http://docs.example.com/local" },
    ];
    for (const item of cases) {
      const server = await startProxy({
        resolveHost: async () => [{ address: item.address, family: item.family }],
      });
      const handle = server.registerAttempt({
        attemptId: `ssrf-${item.address}`,
        profile: "researcher",
        documentationHosts: ["docs.example.com"],
      });
      const response = await proxyRequest({
        port: server.port,
        method: "GET",
        url: item.url,
        auth: handle.proxyAuthorization,
      });
      expect(response.status, item.address).toBe(403);
      expect(server.auditLog.recent().some((event) => event.reason === "private_ip")).toBe(true);
      await server.stop();
    }
    const mixed = await startProxy({
      testOnlyPrivateIpAllowlist: ["127.0.0.1"],
      resolveHost: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
    });
    const handle = mixed.registerAttempt({
      attemptId: "ssrf-mixed",
      profile: "researcher",
      documentationHosts: ["docs.example.com"],
    });
    const response = await proxyRequest({
      port: mixed.port,
      method: "GET",
      url: "http://docs.example.com/mixed",
      auth: handle.proxyAuthorization,
    });
    expect(response.status).toBe(403);
  });

  it("blocks CONNECT to loopback and undeclared ports", async () => {
    const server = await startProxy();
    const handle = server.registerAttempt({
      attemptId: "connect-block",
      profile: "verifier_test",
      allowedTestEndpoints: [
        { host: "127.0.0.1", port: 5432 },
        { host: "api.stripe.com", port: 443 },
        { host: "::1", port: 443 },
      ],
    });
    for (const authority of [
      "127.0.0.1:5432",
      "[::1]:443",
      "10.0.0.1:443",
      "169.254.169.254:443",
      "api.stripe.com:5432",
    ]) {
      const response = await proxyConnect(server.port, handle.proxyAuthorization, authority);
      expect(response.status, authority).toBe(403);
    }
    const loopback = server.auditLog.recent().find((event) => event.host === "127.0.0.1");
    expect(loopback?.reason).toBe("private_ip");
  });

  it("rejects redirect escapes and passes a same-host redirect", async () => {
    let calls = 0;
    const upstream = await startWeb((_req, res) => {
      calls += 1;
      if (calls === 1) {
        res.statusCode = 302;
        res.setHeader("Location", "http://169.254.169.254/latest/meta-data");
        res.end("go");
        return;
      }
      res.statusCode = 302;
      res.setHeader("Location", "/next");
      res.end("next");
    });
    const server = await startProxy({
      testOnlyPrivateIpAllowlist: ["127.0.0.1"],
      resolveHost: async (hostname) => {
        if (hostname !== "api.stripe.com") throw new Error(`resolved ${hostname}`);
        return [{ address: "127.0.0.1", family: 4 }];
      },
    });
    const handle = server.registerAttempt({
      attemptId: "redirect-1",
      profile: "verifier_test",
      allowedTestEndpoints: [{ host: "api.stripe.com", port: upstream.port }],
    });
    const escaped = await proxyRequest({
      port: server.port,
      method: "GET",
      url: `http://api.stripe.com:${upstream.port}/start`,
      auth: handle.proxyAuthorization,
    });
    expect(escaped.status).toBe(403);
    expect(escaped.raw).not.toContain("169.254.169.254");
    const safe = await proxyRequest({
      port: server.port,
      method: "GET",
      url: `http://api.stripe.com:${upstream.port}/again`,
      auth: handle.proxyAuthorization,
    });
    expect(safe.status).toBe(302);
    expect(safe.raw.toLowerCase()).toContain("location: /next");
    expect(upstream.hits()).toBe(2);
  });

  it("returns 407 without revealing another attempt allowlist", async () => {
    const server = await startProxy();
    const hidden = server.registerAttempt({
      attemptId: "hidden-allow",
      profile: "verifier_test",
      allowedTestEndpoints: [{ host: "api.stripe.com", port: 443 }],
    });
    const missing = await proxyRequest({
      port: server.port,
      method: "GET",
      url: "http://example.com/path",
    });
    const wrong = await proxyRequest({
      port: server.port,
      method: "GET",
      url: "http://example.com/path",
      auth: "Bearer not-a-real-token",
    });
    expect(missing.status).toBe(407);
    expect(wrong.status).toBe(407);
    expect(missing.body).toBe("Proxy Authentication Required");
    expect(wrong.raw).not.toContain("api.stripe.com");
    expect(missing.raw).not.toContain(hidden.token);
    const basic = Buffer.from(`proxy:${hidden.token}`).toString("base64");
    const authed = await proxyRequest({
      port: server.port,
      method: "GET",
      url: "http://example.com/path",
      auth: `Basic ${basic}`,
    });
    expect(authed.status).toBe(403);
  });

  it("blocks secret exfiltration and keeps secrets out of the audit log", async () => {
    const live = joinParts(["sk", "_live_", "abcdefghijklmnopqrst"]);
    const canary = "ef-canary-vault-value-123456";
    const upstream = await startWeb((_req, res) => res.end("provider"));
    const server = await startProxy({
      testOnlyPrivateIpAllowlist: ["127.0.0.1"],
      resolveHost: loopbackResolver(),
    });
    if (server.secretRedactor instanceof Object && "register" in server.secretRedactor) {
      (server.secretRedactor as { register(label: string, value: string): void }).register(
        "canary",
        canary,
      );
    }
    const handle = server.registerAttempt({
      attemptId: "vendor-secret",
      profile: "wrapped_vendor",
      vendor: "openai",
      allowedTestEndpoints: [{ host: "api.openai.com", port: upstream.port }],
    });
    const leaked = await proxyRequest({
      port: server.port,
      method: "GET",
      url: `http://api.openai.com:${upstream.port}/v1?q=${live}`,
      auth: handle.proxyAuthorization,
      headers: { Authorization: `Bearer ${live}` },
    });
    const canaryLeak = await proxyRequest({
      port: server.port,
      method: "GET",
      url: `http://api.openai.com:${upstream.port}/v1?note=${canary}`,
      auth: handle.proxyAuthorization,
    });
    const headerLeak = await proxyRequest({
      port: server.port,
      method: "GET",
      url: `http://api.openai.com:${upstream.port}/v1/models`,
      auth: handle.proxyAuthorization,
      headers: { "X-Api-Key": live },
    });
    const allowed = await proxyRequest({
      port: server.port,
      method: "GET",
      url: `http://api.openai.com:${upstream.port}/v1/models`,
      auth: handle.proxyAuthorization,
      headers: { Authorization: `Bearer ${live}` },
    });
    expect(leaked.status).toBe(403);
    expect(canaryLeak.status).toBe(403);
    expect(headerLeak.status).toBe(403);
    expect(allowed.status).toBe(200);
    const serialized = JSON.stringify({ audit: server.auditLog.recent() });
    expect(serialized).not.toContain(live);
    expect(serialized).not.toContain(canary);
    expect(serialized).not.toContain(handle.token);
    expect(serialized).toContain("[REDACTED:");
  });

  it("tears down an open tunnel when the attempt is fenced", async () => {
    const echoPort = await startEcho();
    const server = await startProxy({
      testOnlyPrivateIpAllowlist: ["127.0.0.1"],
      resolveHost: loopbackResolver(),
    });
    const handle = server.registerAttempt({
      attemptId: "tunnel-1",
      profile: "verifier_test",
      allowedTestEndpoints: [{ host: "api.stripe.com", port: echoPort }],
    });
    const socket = track(net.connect(server.port, BIND_HOST));
    let buffered = "";
    socket.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
    });
    await once(socket, "connect");
    socket.write(
      `CONNECT api.stripe.com:${echoPort} HTTP/1.1\r\nHost: api.stripe.com:${echoPort}\r\nProxy-Authorization: ${handle.proxyAuthorization}\r\n\r\n`,
    );
    await waitFor(() => buffered.includes("200"), 2_000);
    socket.write("ping");
    await waitFor(() => buffered.includes("ping"), 2_000);
    const closed = once(socket, "close");
    server.fenceAttempt(handle.attemptId, "fenced");
    await closed;
    const again = await proxyConnect(
      server.port,
      handle.proxyAuthorization,
      `api.stripe.com:${echoPort}`,
    );
    expect(again.status).toBe(407);
    server.revokeAttempt("missing", "paused");
    const completed = server.registerAttempt({
      attemptId: "tunnel-2",
      profile: "verifier_test",
      allowedTestEndpoints: [{ host: "api.stripe.com", port: echoPort }],
    });
    server.fenceAttempt(completed.attemptId, "completed");
    const afterComplete = await proxyConnect(
      server.port,
      completed.proxyAuthorization,
      `api.stripe.com:${echoPort}`,
    );
    expect(afterComplete.status).toBe(407);
  });

  it("survives malformed bytes, oversized headers, and a slow header read", async () => {
    const server = await startProxy({ headerReadTimeoutMs: 200 });
    const handle = server.registerAttempt({
      attemptId: "malformed-1",
      profile: "coding_worker",
    });
    const garbage = track(net.connect(server.port, BIND_HOST));
    const garbageClosed = once(garbage, "close");
    await once(garbage, "connect");
    garbage.write("@@@@ not-http @@@@");
    await garbageClosed;
    const huge = track(net.connect(server.port, BIND_HOST));
    const hugeClosed = once(huge, "close");
    await once(huge, "connect");
    huge.write(
      `GET http://example.com/ HTTP/1.1\r\nX-Padding: ${"a".repeat(MAX_HEADER_BYTES + 64)}\r\n\r\n`,
    );
    await hugeClosed;
    const slow = track(net.connect(server.port, BIND_HOST));
    const slowClosed = once(slow, "close");
    await once(slow, "connect");
    await slowClosed;
    const stillAlive = await proxyRequest({
      port: server.port,
      method: "GET",
      url: "http://example.com/",
      auth: handle.proxyAuthorization,
    });
    expect(stillAlive.status).toBe(403);
    expect(server.listeningAddress).toBe("127.0.0.1");
  });

  it("caps concurrent tunnels and response bytes per attempt", async () => {
    const echoPort = await startEcho();
    const upstream = await startWeb((_req, res) => res.end("x".repeat(200)));
    const server = await startProxy({
      testOnlyPrivateIpAllowlist: ["127.0.0.1"],
      resolveHost: loopbackResolver(),
    });
    const tunnel = server.registerAttempt({
      attemptId: "limit-tunnel",
      profile: "verifier_test",
      allowedTestEndpoints: [{ host: "api.stripe.com", port: echoPort }],
      limits: { maxConcurrentTunnels: 1 },
    });
    const first = await openConnect(
      server.port,
      tunnel.proxyAuthorization,
      `api.stripe.com:${echoPort}`,
    );
    const second = await proxyConnect(
      server.port,
      tunnel.proxyAuthorization,
      `api.stripe.com:${echoPort}`,
    );
    expect(second.status).toBe(429);
    first.destroy();
    const bytes = server.registerAttempt({
      attemptId: "limit-bytes",
      profile: "verifier_test",
      allowedTestEndpoints: [{ host: "api.stripe.com", port: upstream.port }],
      limits: { maxResponseBytes: 32 },
    });
    const oversized = await proxyRequest({
      port: server.port,
      method: "GET",
      url: `http://api.stripe.com:${upstream.port}/big`,
      auth: bytes.proxyAuthorization,
    });
    expect(oversized.status).toBe(502);
    expect(server.auditLog.recent().some((event) => event.reason === "response_too_large")).toBe(
      true,
    );
  });

  it("records allow and deny decisions for diagnostics", async () => {
    const upstream = await startWeb((_req, res) => res.end("ok"));
    const server = await startProxy({
      testOnlyPrivateIpAllowlist: ["127.0.0.1"],
      resolveHost: loopbackResolver(),
    });
    const handle = server.registerAttempt({
      attemptId: "audit-1",
      profile: "verifier_test",
      allowedTestEndpoints: [{ host: "api.stripe.com", port: upstream.port }],
    });
    await proxyRequest({
      port: server.port,
      method: "GET",
      url: `http://api.stripe.com:${upstream.port}/ok`,
      auth: handle.proxyAuthorization,
    });
    await proxyRequest({
      port: server.port,
      method: "GET",
      url: "http://evil.example/no",
      auth: handle.proxyAuthorization,
    });
    const events = server.auditLog.recent();
    expect(
      events.some((event) => event.decision === "allow" && event.attemptId === "audit-1"),
    ).toBe(true);
    expect(events.some((event) => event.decision === "deny" && event.host === "evil.example")).toBe(
      true,
    );
    for (const event of events) {
      expect(event.profile === "verifier_test" || event.profile === "unknown").toBe(true);
      expect(event.method.length).toBeGreaterThan(0);
      expect(typeof event.port).toBe("number");
      expect(typeof event.bytesIn).toBe("number");
      expect(typeof event.bytesOut).toBe("number");
    }
    expect(server.deniedCount).toBe(server.diagnosticsHealth().deniedCount);
    expect(server.diagnosticsHealth().deniedCount).toBeGreaterThan(0);
  });
});

async function proxyConnect(
  port: number,
  auth: string,
  authority: string,
): Promise<{ status: number; raw: string }> {
  const socket = track(net.connect(port, BIND_HOST));
  const pending = readText(socket);
  await once(socket, "connect");
  socket.write(
    `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\nProxy-Authorization: ${auth}\r\n\r\n`,
  );
  const raw = await pending;
  return { status: Number(/^HTTP\/1\.[01] (\d+)/.exec(raw)?.[1] ?? "0"), raw };
}

async function openConnect(port: number, auth: string, authority: string): Promise<net.Socket> {
  const socket = track(net.connect(port, BIND_HOST));
  let buffered = "";
  socket.on("data", (chunk: Buffer) => {
    buffered += chunk.toString("utf8");
  });
  await once(socket, "connect");
  socket.write(
    `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\nProxy-Authorization: ${auth}\r\n\r\n`,
  );
  await waitFor(() => buffered.includes("200"), 2_000);
  return socket;
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for proxy condition");
    await delay(10);
  }
}
