import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, WalCheckpointScheduler } from "../../src/driver/index.js";
import { tempDatabaseDir } from "./temp.js";

const opened: Array<{ close: () => void }> = [];
const temps: Array<{ cleanup: () => void }> = [];

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  for (const temp of temps.splice(0)) temp.cleanup();
});

describe("WAL checkpoint scheduler", () => {
  it("runs PASSIVE after idle, RESTART over the threshold, and TRUNCATE on shutdown", () => {
    const temp = trackTemp();
    const db = track(openDatabase({ location: temp.file("state.db"), role: "state" }));
    const now = 0;
    let walBytes = 0;
    const scheduler = new WalCheckpointScheduler(db, {
      now: () => now,
      walFileBytes: () => walBytes,
      passiveIdleMs: 1_000,
      dailyIdleMs: 50_000,
      restartWalBytes: 100,
      pollMs: 60_000,
    });
    scheduler.noteWrite(0);
    expect(scheduler.evaluate(999)).toBeNull();
    expect(scheduler.evaluate(1_000)).toBe("PASSIVE");
    expect(scheduler.evaluate(1_500)).toBeNull();
    walBytes = 101;
    expect(scheduler.evaluate(1_500)).toBe("RESTART");
    walBytes = 0;
    scheduler.noteWrite(2_000);
    expect(scheduler.evaluate(52_000)).toBe("TRUNCATE");
    scheduler.shutdown();
    expect(scheduler.checkpoints).toEqual(["PASSIVE", "RESTART", "TRUNCATE", "TRUNCATE"]);
  });

  it("fires PASSIVE from the timer and truncates the WAL file when the writer closes", async () => {
    const temp = trackTemp();
    const location = temp.file("state.db");
    const db = openDatabase({ location, role: "state" });
    const scheduler = new WalCheckpointScheduler(db, {
      passiveIdleMs: 30,
      pollMs: 10,
      restartWalBytes: 64 * 1024 * 1024,
      dailyIdleMs: 24 * 60 * 60 * 1000,
    });
    db.exec("CREATE TABLE docs(id INTEGER PRIMARY KEY, body TEXT)");
    db.run("INSERT INTO docs(body) VALUES ('wal')");
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(scheduler.checkpoints).toContain("PASSIVE");
    db.close();
    const { existsSync, statSync } = await import("node:fs");
    const wal = `${location}-wal`;
    expect(!existsSync(wal) || statSync(wal).size === 0).toBe(true);
  });
});

function track<T extends { close: () => void }>(db: T): T {
  opened.push(db);
  return db;
}

function trackTemp() {
  const temp = tempDatabaseDir();
  temps.push(temp);
  return temp;
}
