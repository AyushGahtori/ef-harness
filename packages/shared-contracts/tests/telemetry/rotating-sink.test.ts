import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SecretRedactor } from "../../src/telemetry/redactor.js";
import { RotatingJsonlSink, type DiskWarning } from "../../src/telemetry/index.js";
import { tempDir } from "./helpers.js";

const directories: string[] = [];
const sinks: RotatingJsonlSink[] = [];

afterEach(() => {
  for (const sink of sinks.splice(0)) sink.close();
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("RotatingJsonlSink", () => {
  it("rotates when the file crosses the size limit and when the utc day changes", () => {
    const directory = trackDir("rotate");
    let now = new Date("2026-06-01T12:00:00.000Z");
    const sink = track(
      new RotatingJsonlSink({
        directory,
        redactor: new SecretRedactor(),
        maxBytes: 80,
        clock: () => now,
      }),
    );
    sink.write(`${"a".repeat(60)}\n`, true);
    sink.write(`${"b".repeat(60)}\n`, true);
    now = new Date("2026-06-02T00:00:01.000Z");
    sink.write("day-two\n", true);
    const dayOne = fs.readdirSync(directory).filter((name) => name.startsWith("efharness-2026-06-01"));
    expect(dayOne.length).toBeGreaterThan(1);
    const combined = dayOne
      .map((name) => fs.readFileSync(path.join(directory, name), "utf8"))
      .join("");
    expect(combined).toContain("aaa");
    expect(combined).toContain("bbb");
    const dayTwo = fs.readFileSync(path.join(directory, "efharness-2026-06-02.jsonl"), "utf8");
    expect(dayTwo).toContain("day-two");
    expect(dayTwo).not.toContain("aaa");
  });

  it("prunes closed files older than 14 days and skips the open target", () => {
    const directory = trackDir("prune");
    fs.writeFileSync(path.join(directory, "efharness-2010-01-01.jsonl"), "old\n");
    fs.writeFileSync(path.join(directory, "efharness-2025-12-17.jsonl"), "too-old\n");
    fs.writeFileSync(path.join(directory, "efharness-2025-12-18.jsonl"), "exactly-fourteen\n");
    fs.writeFileSync(path.join(directory, "notes.jsonl"), "keep-notes\n");
    fs.writeFileSync(path.join(directory, "efharness-2010-01-01.txt"), "keep-txt\n");
    const undated = path.join(directory, "efharness-rotated.jsonl");
    fs.writeFileSync(undated, "undated\n");
    const ancient = new Date("2010-01-01T00:00:00.000Z");
    fs.utimesSync(undated, ancient, ancient);
    let now = new Date("2010-01-02T00:00:00.000Z");
    const sink = track(
      new RotatingJsonlSink({
        directory,
        redactor: new SecretRedactor(),
        maxBytes: 1024 * 1024,
        clock: () => now,
      }),
    );
    sink.write("active-line\n", true);
    now = new Date("2026-01-01T00:00:00.000Z");
    sink.prune();
    expect(fs.existsSync(path.join(directory, "efharness-2010-01-02.jsonl"))).toBe(true);
    expect(fs.readFileSync(path.join(directory, "efharness-2010-01-02.jsonl"), "utf8")).toContain(
      "active-line",
    );
    expect(fs.existsSync(path.join(directory, "efharness-2010-01-01.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(directory, "efharness-2025-12-17.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(directory, "efharness-2025-12-18.jsonl"))).toBe(true);
    expect(fs.existsSync(undated)).toBe(false);
    expect(fs.readFileSync(path.join(directory, "notes.jsonl"), "utf8")).toContain("keep-notes");
    expect(fs.readFileSync(path.join(directory, "efharness-2010-01-01.txt"), "utf8")).toContain("keep-txt");
  });

  it("survives a persistent EPERM rename and a rename that succeeds after EBUSY", () => {
    const blocked = trackDir("eperm");
    const warnings: DiskWarning[] = [];
    const blockedSink = track(
      new RotatingJsonlSink({
        directory: blocked,
        redactor: new SecretRedactor(),
        maxBytes: 40,
        clock: () => new Date("2026-06-01T00:00:00.000Z"),
        onDiskWarning: (warning) => warnings.push(warning),
        renameImpl: () => {
          throw Object.assign(new Error("locked"), { code: "EPERM" });
        },
      }),
    );
    expect(() => {
      blockedSink.write(`${"a".repeat(30)}\n`, true);
      blockedSink.write(`${"b".repeat(30)}\n`, true);
    }).not.toThrow();
    const blockedText = fs.readFileSync(path.join(blocked, "efharness-2026-06-01.jsonl"), "utf8");
    expect(blockedText).toContain("aaa");
    expect(blockedText).toContain("bbb");
    expect(warnings.some((warning) => warning.code === "EPERM" && warning.operation === "rotate")).toBe(
      true,
    );

    const recovered = trackDir("ebusy");
    let attempts = 0;
    const recoveredSink = track(
      new RotatingJsonlSink({
        directory: recovered,
        redactor: new SecretRedactor(),
        maxBytes: 40,
        clock: () => new Date("2026-06-01T00:00:00.000Z"),
        renameImpl: (from, to) => {
          attempts += 1;
          if (attempts < 3) throw Object.assign(new Error("busy"), { code: "EBUSY" });
          fs.renameSync(from, to);
        },
      }),
    );
    recoveredSink.write(`${"c".repeat(30)}\n`, true);
    recoveredSink.write(`${"d".repeat(30)}\n`, true);
    expect(attempts).toBe(3);
    const archived = fs
      .readdirSync(recovered)
      .filter((name) => /^efharness-2026-06-01\.\d+\.jsonl$/.test(name));
    expect(archived.length).toBe(1);
    const archivedName = archived[0];
    expect(archivedName).toBeDefined();
    expect(fs.readFileSync(path.join(recovered, archivedName ?? ""), "utf8")).toContain("ccc");
    expect(fs.readFileSync(path.join(recovered, "efharness-2026-06-01.jsonl"), "utf8")).toContain("ddd");
  });

  it("reports ENOSPC on stderr instead of throwing and keeps the line redacted", () => {
    const directory = trackDir("enospc");
    const secret = "DiskFullSecret99";
    const redactor = new SecretRedactor();
    redactor.register("DISK", secret);
    const warnings: DiskWarning[] = [];
    const stderr: string[] = [];
    const sink = track(
      new RotatingJsonlSink({
        directory,
        redactor,
        onDiskWarning: (warning) => warnings.push(warning),
        stderr: {
          write(chunk) {
            stderr.push(String(chunk));
          },
        },
        writeImpl: () => {
          throw Object.assign(new Error("no space"), { code: "ENOSPC" });
        },
      }),
    );
    expect(() => sink.write(`hello ${secret}\n`, true)).not.toThrow();
    expect(warnings.some((warning) => warning.code === "ENOSPC")).toBe(true);
    const reported = stderr.join("");
    expect(reported).toContain("[disk-warning]");
    expect(reported).not.toContain(secret);
    expect(reported).toContain("[REDACTED:DISK]");
  });

  it("buffers non-critical writes and flushes them on demand and on beforeExit", async () => {
    const directory = trackDir("buffer");
    const sink = track(
      new RotatingJsonlSink({
        directory,
        redactor: new SecretRedactor(),
        clock: () => new Date("2026-04-01T00:00:00.000Z"),
      }),
    );
    sink.write("buffered-line\n");
    const file = sink.activeFile();
    expect(file).toBeUndefined();
    sink.flush();
    const active = sink.activeFile();
    expect(active).toBeDefined();
    expect(fs.readFileSync(active ?? "", "utf8")).toContain("buffered-line");

    const hookedDir = trackDir("shutdown");
    const hooked = track(
      new RotatingJsonlSink({
        directory: hookedDir,
        redactor: new SecretRedactor(),
        bindShutdown: true,
        clock: () => new Date("2026-04-02T00:00:00.000Z"),
      }),
    );
    hooked.write("on-exit\n");
    expect(hooked.activeFile()).toBeUndefined();
    process.emit("beforeExit", 0);
    const flushed = hooked.activeFile();
    expect(flushed).toBeDefined();
    expect(fs.readFileSync(flushed ?? "", "utf8")).toContain("on-exit");
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("redacts at the sink boundary even when the caller passes a raw line", () => {
    const directory = trackDir("boundary");
    const secret = "BoundarySecret99";
    const redactor = new SecretRedactor();
    redactor.register("BOUNDARY", secret);
    const sink = track(
      new RotatingJsonlSink({
        directory,
        redactor,
        clock: () => new Date("2026-04-03T00:00:00.000Z"),
      }),
    );
    sink.write(`leak ${secret}\n`, true);
    const text = fs.readFileSync(sink.activeFile() ?? "", "utf8");
    expect(text).not.toContain(secret);
    expect(text).toContain("[REDACTED:BOUNDARY]");
  });

  it("does not throw when retention unlink hits EPERM", () => {
    const directory = trackDir("unlink");
    fs.writeFileSync(path.join(directory, "efharness-2010-01-01.jsonl"), "old\n");
    const warnings: DiskWarning[] = [];
    const sink = track(
      new RotatingJsonlSink({
        directory,
        redactor: new SecretRedactor(),
        clock: () => new Date("2026-01-01T00:00:00.000Z"),
        onDiskWarning: (warning) => warnings.push(warning),
        unlinkImpl: () => {
          throw Object.assign(new Error("busy"), { code: "EPERM" });
        },
      }),
    );
    expect(() => sink.prune()).not.toThrow();
    expect(warnings.some((warning) => warning.code === "EPERM" && warning.operation === "prune")).toBe(
      true,
    );
    expect(fs.existsSync(path.join(directory, "efharness-2010-01-01.jsonl"))).toBe(true);
  });
});

function trackDir(name: string): string {
  const directory = tempDir(name);
  directories.push(directory);
  return directory;
}

function track(sink: RotatingJsonlSink): RotatingJsonlSink {
  sinks.push(sink);
  return sink;
}
