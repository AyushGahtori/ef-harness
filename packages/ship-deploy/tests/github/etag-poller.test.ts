import { describe, expect, it } from "vitest";
import { ConditionalEtagPoller } from "../../src/github/etag-poller.js";
import { GitHubRateAwareQueue } from "../../src/github/rate-queue.js";
import { MockGitHubApi } from "./mock-github-api.js";

describe("ConditionalEtagPoller", () => {
  it("sends If-None-Match and treats 304 as zero quota", async () => {
    const api = new MockGitHubApi();
    api.route("/repos/o/r/commits/sha/check-runs", {
      status: 200,
      body: { check_runs: [{ id: 1, status: "in_progress", conclusion: null }] },
      etag: 'W/"checks-v1"',
    });
    const queue = new GitHubRateAwareQueue({ accountKey: "e1", transport: api });
    const poller = new ConditionalEtagPoller({ queue });
    const first = await poller.pollOnce({ path: "/repos/o/r/commits/sha/check-runs" });
    expect(first.quotaConsumed).toBe(1);
    const second = await poller.pollOnce({
      path: "/repos/o/r/commits/sha/check-runs",
      etag: first.etag ?? undefined,
    });
    expect(second.notModified).toBe(true);
    expect(second.quotaConsumed).toBe(0);
    expect(api.requests[1]?.headers?.["If-None-Match"]).toBe('W/"checks-v1"');
  });

  it("pauses completely when paused", async () => {
    const api = new MockGitHubApi();
    api.route("/repos/o/r/actions/runs", {
      status: 200,
      body: { workflow_runs: [{ id: 2, status: "completed", conclusion: "success" }] },
    });
    const queue = new GitHubRateAwareQueue({ accountKey: "e2", transport: api });
    const poller = new ConditionalEtagPoller({ queue });
    poller.pause();
    const tick = await poller.pollOnce({ path: "/repos/o/r/actions/runs" });
    expect(tick.snapshot.completed).toBe(true);
  });
});