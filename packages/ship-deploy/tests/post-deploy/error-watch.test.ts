import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ERROR_WATCH_POLL_MS,
  ERROR_WATCH_WINDOW_MS,
  InMemoryCasBlobStore,
  LOCAL_OFFLINE_WATCH_MESSAGE,
  TenMinuteErrorWatchMonitor,
  createFallbackPacketSecurityRedactor,
  describeDockerLogsPoll,
  describeVercelMetricsPoll,
} from "../../src/post-deploy/index.js";
import type { HostObservabilitySource } from "../../src/post-deploy/index.js";
import { healthySample, spikeSample, syntheticLiveKey } from "./helpers.js";

const redactor = createFallbackPacketSecurityRedactor();

afterEach(() => {
  vi.useRealTimers();
});

function source(
  kind: HostObservabilitySource["kind"],
  poll: HostObservabilitySource["poll"],
): HostObservabilitySource {
  return { kind, poll };
}

describe("post-deploy 10-minute error watch", () => {
  it("uses a 10 minute window and a 30 second poll", () => {
    expect(ERROR_WATCH_WINDOW_MS).toBe(10 * 60 * 1000);
    expect(ERROR_WATCH_POLL_MS).toBe(30_000);
    expect(describeVercelMetricsPoll("dpl_abc")).toBe("GET /v2/deployments/dpl_abc/events");
    expect(describeDockerLogsPoll("app", "2026-11-23T12:00:00.000Z")).toBe(
      "docker logs --since 2026-11-23T12:00:00.000Z app",
    );
    expect(() => describeDockerLogsPoll("app;rm", "2026-11-23T12:00:00.000Z")).toThrow(/unsafe container/);
  });

  it("polls every 30s with fake timers and finishes clean at 10 minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-23T12:00:00.000Z"));
    const times: number[] = [];
    const commands: string[] = [];
    const monitor = new TenMinuteErrorWatchMonitor({
      source: source("vercel-metrics", async (input) => {
        times.push(Date.now());
        commands.push(input.pollCommand);
        return healthySample();
      }),
      connectivity: { isOnline: () => true },
      redactor,
      cas: new InMemoryCasBlobStore(),
    });
    const handle = monitor.start({ deploymentId: "dpl_abc", env: "staging" });
    const pending = handle.done;
    await vi.advanceTimersByTimeAsync(ERROR_WATCH_WINDOW_MS);
    const result = await pending;
    expect(result.verdict).toBe("clean");
    expect(result.breach).toBeNull();
    expect(result.pollCount).toBe(20);
    expect(times[1]! - times[0]!).toBe(ERROR_WATCH_POLL_MS);
    expect(commands[0]).toBe("GET /v2/deployments/dpl_abc/events");
  });

  it("catches a 5xx spike at minute 4, three health failures, and a crash loop", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-23T12:00:00.000Z"));
    const start = Date.now();
    const breaches: string[] = [];
    const secret = syntheticLiveKey();
    const cas = new InMemoryCasBlobStore();
    const monitor = new TenMinuteErrorWatchMonitor({
      source: source("docker-logs", async () => {
        if (Date.now() - start >= 4 * 60 * 1000) return spikeSample(`password ${secret}`);
        return healthySample();
      }),
      connectivity: { isOnline: () => true },
      redactor,
      cas,
    });
    const spiked = monitor.start({
      deploymentId: "dep_1",
      env: "staging",
      containerName: "kitchen",
      onBreach: async (breach) => {
        breaches.push(breach.kind);
      },
    });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    const spike = await spiked.done;
    expect(spike.verdict).toBe("breached");
    expect(spike.breach?.kind).toBe("five-xx-spike");
    expect(breaches).toEqual(["five-xx-spike"]);
    expect(cas.blobs.map((blob) => blob.text).join("\n")).not.toContain(secret);
    expect(spike.logs.join("\n")).not.toContain(secret);
    expect(spike.logs.join("\n")).toContain("[REDACTED:STRIPE_LIVE_KEY]");

    vi.setSystemTime(new Date("2026-11-23T13:00:00.000Z"));
    const health = new TenMinuteErrorWatchMonitor({
      source: source("vercel-metrics", async () => ({
        ...healthySample(),
        healthOk: false,
      })),
      connectivity: { isOnline: () => true },
      redactor,
      cas: new InMemoryCasBlobStore(),
    });
    const healthHandle = health.start({ deploymentId: "dep_2", env: "staging" });
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    const healthResult = await healthHandle.done;
    expect(healthResult.breach).toEqual({ kind: "consecutive-health-fails", count: 3 });

    vi.setSystemTime(new Date("2026-11-23T14:00:00.000Z"));
    const crash = new TenMinuteErrorWatchMonitor({
      source: source("docker-logs", async () => ({ ...healthySample(), containerRestarts: 3 })),
      connectivity: { isOnline: () => true },
      redactor,
      cas: new InMemoryCasBlobStore(),
    });
    const crashHandle = crash.start({ deploymentId: "dep_3", env: "staging", containerName: "app" });
    await vi.advanceTimersByTimeAsync(1_000);
    const crashResult = await crashHandle.done;
    expect(crashResult.breach).toEqual({ kind: "crash-loop", restarts: 3 });
  });

  it("pauses on local offline at minute 6 and does not treat it as a remote crash", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-23T12:00:00.000Z"));
    const start = Date.now();
    let breached = false;
    const monitor = new TenMinuteErrorWatchMonitor({
      source: source("vercel-metrics", async () => healthySample()),
      connectivity: { isOnline: () => Date.now() < start + 6 * 60 * 1000 },
      redactor,
      cas: new InMemoryCasBlobStore(),
    });
    const handle = monitor.start({
      deploymentId: "dep_4",
      env: "production",
      onBreach: async () => {
        breached = true;
      },
    });
    await vi.advanceTimersByTimeAsync(ERROR_WATCH_WINDOW_MS);
    const result = await handle.done;
    expect(result.verdict).toBe("paused-local-offline");
    expect(result.logs.filter((line) => line === LOCAL_OFFLINE_WATCH_MESSAGE)).toEqual([
      LOCAL_OFFLINE_WATCH_MESSAGE,
    ]);
    expect(breached).toBe(false);
    expect(result.breach).toBeNull();
  });

  it("lets the developer minimize the watch or dismiss it early", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-23T12:00:00.000Z"));
    const monitor = new TenMinuteErrorWatchMonitor({
      source: source("vercel-metrics", async () => healthySample()),
      connectivity: { isOnline: () => true },
      redactor,
      cas: new InMemoryCasBlobStore(),
    });
    const minimized = monitor.start({ deploymentId: "dep_5", env: "staging" });
    minimized.minimize();
    await vi.advanceTimersByTimeAsync(ERROR_WATCH_WINDOW_MS);
    const finished = await minimized.done;
    expect(finished.minimized).toBe(true);
    expect(finished.verdict).toBe("clean");

    vi.setSystemTime(new Date("2026-11-23T15:00:00.000Z"));
    const early = new TenMinuteErrorWatchMonitor({
      source: source("vercel-metrics", async () => healthySample()),
      connectivity: { isOnline: () => true },
      redactor,
      cas: new InMemoryCasBlobStore(),
    });
    const handle = early.start({ deploymentId: "dep_6", env: "production" });
    handle.dismissEarly();
    const dismissed = await handle.done;
    expect(dismissed.verdict).toBe("dismissed-early");
    expect(dismissed.pollCount).toBe(0);
  });
});
