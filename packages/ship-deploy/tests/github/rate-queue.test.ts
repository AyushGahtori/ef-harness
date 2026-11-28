import { describe, expect, it, vi } from "vitest";
import { GlobalBrokerDb } from "@ef-harness/db";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  GitHubRateAwareQueue,
  MAX_MUTATIONS_PER_MINUTE,
  MIN_MUTATION_SPACING_MS,
} from "../../src/github/rate-queue.js";
import { githubRateStoreForBroker, openMemoryGitHubRateStore } from "../../src/github/rate-state.js";
import { MockGitHubApi } from "./mock-github-api.js";

describe("GitHubRateAwareQueue", () => {
  it("serializes mutations with minimum spacing", async () => {
    const api = new MockGitHubApi();
    api.route("/mut", { status: 201, body: { ok: true } });
    const sendTimes: number[] = [];
    const queue = new GitHubRateAwareQueue({
      accountKey: "u1",
      transport: {
        send: async (req) => {
          sendTimes.push(Date.now());
          return api.send(req);
        },
      },
    });
    await queue.request({ method: "POST", path: "/mut", body: "{}", mutating: true });
    await queue.request({ method: "POST", path: "/mut", body: "{}", mutating: true });
    expect(sendTimes).toHaveLength(2);
    expect(sendTimes[1]! - sendTimes[0]!).toBeGreaterThanOrEqual(MIN_MUTATION_SPACING_MS - 50);
  });

  it("honors retry-after on secondary rate limits", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const transport = {
      send: async () => {
        calls += 1;
        if (calls === 1) {
          return { status: 403, headers: { "retry-after": "1" }, body: "" };
        }
        return { status: 200, headers: {}, body: "{}" };
      },
    };
    const now = vi.fn(() => 0);
    const pauses: string[] = [];
    const queue = new GitHubRateAwareQueue({
      accountKey: "u2",
      transport,
      now,
      onPause: (e) => pauses.push(e.message),
    });
    now.mockImplementation(() => (calls === 1 ? 0 : 1_200));
    const pending = queue.request({ method: "POST", path: "/x", mutating: true });
    await vi.runAllTimersAsync();
    const response = await pending;
    expect(response.status).toBe(200);
    expect(pauses.some((p) => p.includes("GitHub rate limit"))).toBe(true);
    vi.useRealTimers();
  });

  it("shares mutation counters per GitHub account through global.db", async () => {
    const store = openMemoryGitHubRateStore();
    const api = new MockGitHubApi();
    api.route("/mut", { status: 201, body: { ok: true } });
    let clock = 10_000;
    const a = new GitHubRateAwareQueue({
      accountKey: "octocat",
      transport: api,
      rateStore: store,
      now: () => clock,
    });
    await a.request({ method: "POST", path: "/mut", mutating: true });
    clock = 12_000;
    const b = new GitHubRateAwareQueue({
      accountKey: "octocat",
      transport: api,
      rateStore: store,
      now: () => clock,
    });
    await b.request({ method: "POST", path: "/mut", mutating: true });
    expect(store.load("octocat")?.mutationsThisMinute).toBe(2);
    expect(api.requests.length).toBe(2);
  });

  it("reloads GitHub rate counters after GlobalBrokerDb reopen", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-github-rate-"));
    try {
      const first = GlobalBrokerDb.open({ root });
      const api = new MockGitHubApi();
      api.route("/mut", { status: 201, body: { ok: true } });
      const queue = new GitHubRateAwareQueue({
        accountKey: "octocat",
        transport: api,
        rateStore: githubRateStoreForBroker(first),
        now: () => 10_000,
      });
      await queue.request({ method: "POST", path: "/mut", mutating: true });
      first.close();
      const second = GlobalBrokerDb.open({ root });
      try {
        expect(githubRateStoreForBroker(second).load("octocat")?.mutationsThisMinute).toBe(1);
      } finally {
        second.close();
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("tracks mutation ceilings", () => {
    expect(MAX_MUTATIONS_PER_MINUTE).toBeLessThan(81);
  });
});