import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  DefaultSecretRedactor,
  FilesystemCassetteStore,
  HttpRecordReplayProvider,
  UnrecordedHttpRequestError,
  type CassetteStore,
} from "../../src/services/index.js";
import { envRequest, makeTemp, removeTemp } from "./helpers.js";

function startUpstream(): Promise<{ url: string; hits: () => number; close: () => Promise<void> }> {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    if ((req.url ?? "").startsWith("/v1/profile")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ email: "ada@example.test", password: "hunter2example", ok: true }));
      return;
    }
    if ((req.url ?? "").startsWith("/v1/env-only")) {
      const which = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("env") ?? "";
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(which);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("missing");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("upstream did not bind"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        hits: () => hits,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}

describe("HttpRecordReplayProvider", () => {
  const dirs: string[] = [];
  const providers: HttpRecordReplayProvider[] = [];
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const provider of providers) await provider.closeProject("project-a");
    providers.length = 0;
    for (const close of closers) await close();
    closers.length = 0;
    for (const dir of dirs) await removeTemp(dir);
    dirs.length = 0;
  });

  it("scrubs secrets into CAS and fails offline replay without dialing upstream", async () => {
    const root = await makeTemp("replay-");
    dirs.push(root);
    const upstream = await startUpstream();
    closers.push(() => upstream.close());
    const real = new FilesystemCassetteStore(root);
    const writes: string[] = [];
    const store: CassetteStore = {
      async put(bytes) {
        writes.push(Buffer.from(bytes).toString("utf8"));
        return real.put(bytes);
      },
      get: (key) => real.get(key),
    };
    let fetches = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      fetches += 1;
      return fetch(input, init);
    };
    const provider = new HttpRecordReplayProvider({
      store,
      fetchImpl,
      redactor: new DefaultSecretRedactor(),
    });
    providers.push(provider);
    await expect(
      provider.create(envRequest(root, "rec", { httpMode: "record", upstreamBaseUrl: upstream.url })),
    ).rejects.toThrow(/approval/);
    const recorded = await provider.create(
      envRequest(root, "rec", {
        httpMode: "record",
        httpApproved: true,
        upstreamBaseUrl: upstream.url,
      }),
    );
    const response = await fetch(`${recorded.baseUrl}/v1/profile`, {
      headers: { authorization: "Bearer local-session-token" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ email: "ada@example.test" });
    const cassette = writes.at(-1) ?? "";
    expect(cassette).not.toContain("local-session-token");
    expect(cassette).not.toContain("ada@example.test");
    expect(cassette).not.toContain("hunter2example");
    expect(cassette).toContain("[redacted]");
    const cassetteKey = recorded.latestCassetteKey();
    expect(cassetteKey).toBeTruthy();
    await provider.destroy("rec");
    const hitsAfterRecord = upstream.hits();
    const fetchesAfterRecord = fetches;
    const replay = await provider.create(
      envRequest(root, "play", { httpMode: "replay", cassetteKey: cassetteKey ?? "" }),
    );
    const replayed = await fetch(`${replay.baseUrl}/v1/profile`);
    expect(replayed.status).toBe(200);
    const replayBody = await replayed.json();
    expect(replayBody.email).toBe("[redacted]");
    expect(replayBody.password).toBe("[redacted]");
    const missed = await fetch(`${replay.baseUrl}/v1/not-recorded`);
    expect(missed.status).toBe(502);
    expect(await missed.json()).toMatchObject({
      error: "UnrecordedHttpRequestError",
      method: "GET",
      url: "/v1/not-recorded",
    });
    expect(() => provider.replayLookup("play", "POST", "/v1/not-recorded")).toThrow(UnrecordedHttpRequestError);
    expect(upstream.hits()).toBe(hitsAfterRecord);
    expect(fetches).toBe(fetchesAfterRecord);
  });

  it("keeps two environments on separate cassettes", async () => {
    const root = await makeTemp("replay-iso-");
    dirs.push(root);
    const upstream = await startUpstream();
    closers.push(() => upstream.close());
    const provider = new HttpRecordReplayProvider({
      store: new FilesystemCassetteStore(root),
      cassetteRoot: root,
    });
    providers.push(provider);
    const [first, second] = await Promise.all([
      provider.create(
        envRequest(root, "env-1", {
          httpMode: "record",
          httpApproved: true,
          upstreamBaseUrl: upstream.url,
        }),
      ),
      provider.create(
        envRequest(root, "env-2", {
          httpMode: "record",
          httpApproved: true,
          upstreamBaseUrl: upstream.url,
        }),
      ),
    ]);
    expect(first.baseUrl).not.toBe(second.baseUrl);
    await fetch(`${first.baseUrl}/v1/env-only?env=one`);
    await fetch(`${second.baseUrl}/v1/env-only?env=two`);
    const firstKey = first.latestCassetteKey();
    const secondKey = second.latestCassetteKey();
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBeTruthy();
    expect(firstKey).not.toBe(secondKey);
    await provider.destroy("env-1");
    await provider.destroy("env-2");
    const replayFirst = await provider.create(
      envRequest(root, "env-1", { httpMode: "replay", cassetteKey: firstKey ?? "" }),
    );
    const replaySecond = await provider.create(
      envRequest(root, "env-2", { httpMode: "replay", cassetteKey: secondKey ?? "" }),
    );
    expect(await (await fetch(`${replayFirst.baseUrl}/v1/env-only?env=one`)).text()).toBe("one");
    expect((await fetch(`${replayFirst.baseUrl}/v1/env-only?env=two`)).status).toBe(502);
    expect(await (await fetch(`${replaySecond.baseUrl}/v1/env-only?env=two`)).text()).toBe("two");
    expect(provider.misses.some((miss) => miss instanceof UnrecordedHttpRequestError)).toBe(true);
  });
});
