import { describe, expect, it, vi } from "vitest";
import {
  GitHubRateAwareQueue,
  MAX_MUTATIONS_PER_MINUTE,
  MIN_MUTATION_SPACING_MS,
  resetSharedGitHubQueuesForTests,
  sharedGitHubQueue,
} from "../../src/github/rate-queue.js";
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

  it("shares one queue per GitHub account across projects", async () => {
    resetSharedGitHubQueuesForTests();
    const api = new MockGitHubApi();
    const a = sharedGitHubQueue({ accountKey: "octocat", transport: api });
    const b = sharedGitHubQueue({ accountKey: "octocat", transport: api });
    expect(a).toBe(b);
    api.route("/a", { status: 200, body: {} });
    await a.request({ method: "GET", path: "/a" });
    await b.request({ method: "GET", path: "/a" });
    expect(api.requests.length).toBe(2);
  });

  it("tracks mutation ceilings", () => {
    expect(MAX_MUTATIONS_PER_MINUTE).toBeLessThan(81);
  });
});