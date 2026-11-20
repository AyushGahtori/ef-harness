import { describe, expect, it } from "vitest";
import { ManualClock, ProjectSharedServerPool, systemClock } from "../../src/services/index.js";

describe("shared project server reference counting", () => {
  it("starts lazily, shares one server, and stops at zero references", async () => {
    const events: string[] = [];
    const pool = new ProjectSharedServerPool<{ id: number }>({
      idleGraceMs: 0,
      clock: systemClock(),
      async start(key) {
        events.push(`start:${key}`);
        return { id: events.length };
      },
      async stop(key) {
        events.push(`stop:${key}`);
      },
    });
    expect(events).toEqual([]);
    const first = await pool.acquire("project-a");
    const second = await pool.acquire("project-a");
    expect(first.runtime).toBe(second.runtime);
    expect(pool.refs("project-a")).toBe(2);
    expect(events).toEqual(["start:project-a"]);
    await pool.release("project-a");
    expect(events).toEqual(["start:project-a"]);
    await pool.release("project-a");
    expect(events).toEqual(["start:project-a", "stop:project-a"]);
  });

  it("waits for the idle grace period and cancels shutdown when a new environment arrives", async () => {
    const clock = new ManualClock();
    const events: string[] = [];
    const pool = new ProjectSharedServerPool<string>({
      idleGraceMs: 1_000,
      clock,
      async start() {
        events.push("start");
        return "server";
      },
      async stop() {
        events.push("stop");
      },
    });
    await pool.acquire("project-a");
    await pool.release("project-a");
    await clock.advance(999);
    expect(events).toEqual(["start"]);
    await pool.acquire("project-a");
    await clock.advance(1);
    expect(events).toEqual(["start"]);
    await pool.release("project-a");
    await clock.advance(1_000);
    expect(events).toEqual(["start", "stop"]);
  });

  it("shuts a shared server down immediately on project close", async () => {
    const clock = new ManualClock();
    const events: string[] = [];
    const pool = new ProjectSharedServerPool<string>({
      idleGraceMs: 5_000,
      clock,
      async start() {
        events.push("start");
        return "server";
      },
      async stop() {
        events.push("stop");
      },
    });
    await pool.acquire("project-a");
    await pool.release("project-a");
    await pool.close("project-a");
    expect(events).toEqual(["start", "stop"]);
    expect(pool.refs("project-a")).toBe(0);
  });

  it("deduplicates concurrent first starts", async () => {
    let releaseStart: (value: { id: number }) => void = () => undefined;
    const gate = new Promise<{ id: number }>((resolve) => {
      releaseStart = resolve;
    });
    let starts = 0;
    const pool = new ProjectSharedServerPool<{ id: number }>({
      idleGraceMs: 0,
      clock: systemClock(),
      async start() {
        starts += 1;
        return gate;
      },
      async stop() {
        return undefined;
      },
    });
    const first = pool.acquire("project-a");
    const second = pool.acquire("project-a");
    await Promise.resolve();
    expect(starts).toBe(1);
    releaseStart({ id: 7 });
    const [left, right] = await Promise.all([first, second]);
    expect(left.runtime).toBe(right.runtime);
    expect(pool.refs("project-a")).toBe(2);
  });
});
