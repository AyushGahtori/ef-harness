import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rename } from "node:fs/promises";
import { ATOMIC_RENAME_ATTEMPTS, atomicWriteFile, retryDelayMs } from "../../src/views-export/atomic-write.js";
import { digestSha256, normalizeLf } from "../../src/views-export/canonical-hash.js";
import { KnowledgeViewExporter } from "../../src/views-export/exporter.js";
import { GitExcludeGuard } from "../../src/views-export/git-exclude-guard.js";
import { VIEW_WATCH_DEBOUNCE_MS, ViewManifestHashScanner } from "../../src/views-export/hash-scanner.js";
import { ExportPauseLock, ExportWriteLease } from "../../src/views-export/locks.js";
import { createParcelWatchBackend, type WatchBackend, type WatchEvent } from "../../src/views-export/watch-backend.js";
import { fakeGit, sampleSource, tempProject, viewNode } from "./fixtures.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

describe("KnowledgeViewExporter", () => {
  it("writes deterministic views and does not touch bytes on a second export", async () => {
    const projectRoot = await tempProject();
    const source = sampleSource();
    const exporter = new KnowledgeViewExporter({
      projectRoot,
      source,
      git: fakeGit(),
      now: () => "2026-01-01T00:00:00.000Z",
    });
    const first = await exporter.exportAll();
    expect(first.written.length).toBeGreaterThan(0);
    expect(first.paused).toEqual([]);
    const decisions = path.join(projectRoot, ".harness", "views", "decisions.md");
    const before = await stat(decisions);
    const hashes = await hashViews(projectRoot);
    const second = await exporter.exportAll();
    const after = await stat(decisions);
    expect(second.written).toEqual([]);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(await hashViews(projectRoot)).toEqual(hashes);
    const exclude = await readFile(path.join(projectRoot, ".git", "info", "exclude"), "utf8");
    expect(exclude).toContain(".harness/views/");
    const manifest = JSON.parse(await readFile(path.join(projectRoot, ".harness", "views", ".manifest.json"), "utf8")) as {
      records: Array<{ filePath: string; nodeId: string; contentSha256: string; fieldsSha256: string; proseSha256: string }>;
    };
    const fileRecord = manifest.records.find((record) => record.filePath === "decisions.md" && record.nodeId === "");
    const nodeRecord = manifest.records.find((record) => record.nodeId === "D1");
    expect(fileRecord?.contentSha256.startsWith("sha256:")).toBe(true);
    expect(nodeRecord?.fieldsSha256.startsWith("sha256:")).toBe(true);
    expect(nodeRecord?.proseSha256.startsWith("sha256:")).toBe(true);
  });

  it("does not clobber a dirty file or a paused file and reports the database head", async () => {
    const projectRoot = await tempProject();
    const source = sampleSource();
    const pauseLock = new ExportPauseLock();
    const exporter = new KnowledgeViewExporter({
      projectRoot,
      source,
      pauseLock,
      git: fakeGit(),
      now: () => "2026-01-01T00:00:00.000Z",
    });
    await exporter.exportAll();
    const orders = path.join(projectRoot, ".harness", "views", "features", "orders.md");
    const original = await readFile(orders, "utf8");
    await writeFile(orders, original.replace("Cutoff is 11:00.", "Cutoff is 10:30."), "utf8");
    source.upsertNode(
      viewNode({
        id: "R17",
        kind: "rule",
        title: "Cutoff",
        feature: "orders",
        text: "Cutoff is 11:30.",
        version: 2,
        updatedRev: 2,
        fields: { touches: ["orders", "billing"], bounds: { max: 11, min: 0 }, basis: "explicit" },
      }),
    );
    source.setRevision(2);
    const drifted = await exporter.exportIncremental();
    expect(await readFile(orders, "utf8")).toBe(original.replace("Cutoff is 11:00.", "Cutoff is 10:30."));
    const paused = drifted.paused.find((file) => file.filePath === "features/orders.md");
    expect(paused?.reason).toBe("disk_drift");
    expect(paused?.dbHead[0]?.updatedRev).toBe(2);
    expect(paused?.dbRevision).toBe(2);
    expect(pauseLock.isPaused("features/orders.md")).toBe(true);

    const lockedRoot = await tempProject();
    const lockedSource = sampleSource();
    const lock = new ExportPauseLock();
    const lockedExporter = new KnowledgeViewExporter({
      projectRoot: lockedRoot,
      source: lockedSource,
      pauseLock: lock,
      git: fakeGit(),
      now: () => "2026-01-01T00:00:00.000Z",
    });
    await lockedExporter.exportAll();
    const lockedOrders = path.join(lockedRoot, ".harness", "views", "features", "orders.md");
    const lockedOriginal = await readFile(lockedOrders, "utf8");
    lock.pause("features/orders.md", "conflict_card");
    lockedSource.upsertNode(
      viewNode({
        id: "R17",
        kind: "rule",
        title: "Cutoff",
        feature: "orders",
        text: "Cutoff is 11:30.",
        version: 2,
        updatedRev: 2,
        fields: { touches: ["orders", "billing"], bounds: { max: 11, min: 0 } },
      }),
    );
    lockedSource.setRevision(2);
    const held = await lockedExporter.exportIncremental();
    expect(await readFile(lockedOrders, "utf8")).toBe(lockedOriginal);
    expect(held.paused.find((file) => file.filePath === "features/orders.md")?.reason).toBe("conflict_card");
    expect(held.paused.find((file) => file.filePath === "features/orders.md")?.dbHead[0]?.version).toBe(2);
  });

  it("regenerates a deleted views directory without changing the graph", async () => {
    const projectRoot = await tempProject();
    const source = sampleSource();
    const exporter = new KnowledgeViewExporter({ projectRoot, source, git: fakeGit(), now: () => "2026-01-01T00:00:00.000Z" });
    await exporter.exportAll();
    const before = source.listNodes().map((node) => node.contentHash);
    await rm(path.join(projectRoot, ".harness", "views"), { recursive: true, force: true });
    const scanner = new ViewManifestHashScanner({
      projectRoot,
      pauseLock: new ExportPauseLock(),
      lease: new ExportWriteLease(),
      backend: silentBackend(),
    });
    expect((await scanner.scanColdOpen()).kind).toBe("missing_views");
    await exporter.exportAll();
    expect(source.listNodes().map((node) => node.contentHash)).toEqual(before);
    const restored = await readFile(path.join(projectRoot, ".harness", "views", "decisions.md"), "utf8");
    expect(restored).toContain("id=D1");
  });

  it("defers a locked rename and leaves the previous file intact", async () => {
    const projectRoot = await tempProject();
    const source = sampleSource();
    let locked = false;
    const exporter = new KnowledgeViewExporter({
      projectRoot,
      source,
      git: fakeGit(),
      now: () => "2026-01-01T00:00:00.000Z",
      sleep: async () => {},
      backoff: () => 0,
      rename: async (from, to) => {
        if (locked) throw busy();
        await rename(from, to);
      },
    });
    await exporter.exportAll();
    const orders = path.join(projectRoot, ".harness", "views", "features", "orders.md");
    const original = await readFile(orders, "utf8");
    locked = true;
    source.upsertNode(
      viewNode({
        id: "R17",
        kind: "rule",
        title: "Cutoff",
        feature: "orders",
        text: "Cutoff moved.",
        version: 2,
        updatedRev: 2,
        fields: { touches: ["orders"] },
      }),
    );
    source.setRevision(2);
    const result = await exporter.exportIncremental();
    expect(result.deferred.some((file) => file.filePath === "features/orders.md" && file.attempts === 5)).toBe(true);
    expect(result.deferred.find((file) => file.filePath === "features/orders.md")?.diagnostic).toContain("EBUSY");
    expect(await readFile(orders, "utf8")).toBe(original);
    const names = await readdir(path.dirname(orders));
    expect(names.filter((name) => name.startsWith(".tmp."))).toEqual([]);
  });
});

describe("ViewManifestHashScanner", () => {
  it("detects an offline edit while the watcher is stopped", async () => {
    const projectRoot = await tempProject();
    const source = sampleSource();
    const pauseLock = new ExportPauseLock();
    const exporter = new KnowledgeViewExporter({
      projectRoot,
      source,
      pauseLock,
      git: fakeGit(),
      now: () => "2026-01-01T00:00:00.000Z",
    });
    await exporter.exportAll();
    const orders = path.join(projectRoot, ".harness", "views", "features", "orders.md");
    await writeFile(orders, `${await readFile(orders, "utf8")}\nEdited offline.\n`, "utf8");
    const scanner = new ViewManifestHashScanner({
      projectRoot,
      pauseLock,
      lease: new ExportWriteLease(),
      backend: silentBackend(),
    });
    const report = await scanner.scanColdOpen();
    expect(report.kind).toBe("offline_edits");
    expect(report.dirtyFiles.some((file) => file.filePath === "features/orders.md")).toBe(true);
    expect(pauseLock.isPaused("features/orders.md")).toBe(true);
    expect((await scanner.scanOnFocusReturn()).dirtyFiles.map((file) => file.filePath)).toContain("features/orders.md");
  });

  it("suppresses self-writes from the lease and from matching hashes", async () => {
    expect(VIEW_WATCH_DEBOUNCE_MS).toBe(300);
    const projectRoot = await tempProject();
    const source = sampleSource();
    for (let index = 1; index <= 12; index += 1) {
      const feature = `slice-${String(index).padStart(2, "0")}`;
      source.upsertNode(viewNode({ id: `S${String(index).padStart(2, "0")}`, kind: "spec_item", title: feature, feature, text: "Slice." }));
    }
    source.setRevision(1);
    const pauseLock = new ExportPauseLock();
    const lease = new ExportWriteLease();
    const watcher = new ScriptedWatcher();
    const exporter = new KnowledgeViewExporter({
      projectRoot,
      source,
      pauseLock,
      lease,
      git: fakeGit(),
      now: () => "2026-01-01T00:00:00.000Z",
    });
    await exporter.exportAll();
    const scanner = new ViewManifestHashScanner({ projectRoot, pauseLock, lease, backend: watcher });
    const dirty: string[] = [];
    scanner.onDirty((view) => {
      dirty.push(view.filePath);
    });
    await scanner.start();
    const views = path.join(projectRoot, ".harness", "views");
    const paths = Array.from({ length: 12 }, (_, index) =>
      path.join(views, "features", `slice-${String(index + 1).padStart(2, "0")}.md`),
    );
    await delay(20);
    watcher.emit(paths);
    await scanner.whenIdle();
    expect(dirty).toEqual([]);
    expect(scanner.suppressedCount()).toBe(12);
    const token = lease.acquire(["features/slice-01.md"]);
    await writeFile(paths[0] ?? "", "user typed during export\n", "utf8");
    watcher.emit([paths[0] ?? ""]);
    await scanner.whenIdle();
    expect(dirty).toEqual([]);
    lease.release(token);
    watcher.emit([paths[0] ?? ""]);
    await scanner.whenIdle();
    expect(dirty).toContain("features/slice-01.md");
    await scanner.stop();
  });

  it("subscribes with @parcel/watcher", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ef-parcel-"));
    const backend = await createParcelWatchBackend();
    let seen = 0;
    const subscription = await backend.subscribe(directory, (_error, events) => {
      seen += events.length;
    });
    await delay(300);
    const note = path.join(directory, "note.md");
    await writeFile(note, "hello\n", "utf8");
    const started = Date.now();
    while (seen === 0 && Date.now() - started < 8000) {
      if (Date.now() - started > 1500) await writeFile(note, `hello ${String(Date.now())}\n`, "utf8");
      await delay(100);
    }
    await subscription.unsubscribe();
    await rm(directory, { recursive: true, force: true });
    expect(seen).toBeGreaterThan(0);
  }, 20000);
});

describe("atomic rename", () => {
  it("retries EBUSY with bounded backoff and can still replace the file", async () => {
    expect(retryDelayMs(1, () => 0)).toBe(10);
    expect(retryDelayMs(2, () => 0)).toBe(20);
    expect(retryDelayMs(3, () => 0)).toBe(40);
    expect(retryDelayMs(4, () => 0)).toBe(80);
    expect(retryDelayMs(1, () => 0.5)).toBe(15);
    const directory = await tempProject();
    const target = path.join(directory, "orders.md");
    await atomicWriteFile(target, "one\n", { sleep: async () => {}, backoff: () => 0 });
    const failed = await atomicWriteFile(target, "two\n", {
      sleep: async () => {},
      backoff: () => 0,
      rename: async () => {
        throw busy();
      },
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.attempts).toBe(ATOMIC_RENAME_ATTEMPTS);
      expect(failed.diagnostic).toContain("EBUSY");
    }
    expect(await readFile(target, "utf8")).toBe("one\n");
    expect((await readdir(directory)).filter((name) => name.startsWith(".tmp."))).toEqual([]);
    let succeedAfter = 0;
    const replaced = await atomicWriteFile(target, "two\n", {
      sleep: async () => {},
      backoff: () => 0,
      rename: async (from, to) => {
        succeedAfter += 1;
        if (succeedAfter < 5) throw busy();
        await rename(from, to);
      },
    });
    expect(replaced.ok).toBe(true);
    expect(replaced.attempts).toBe(5);
    expect(await readFile(target, "utf8")).toBe("two\n");
  });
});

describe("GitExcludeGuard", () => {
  it("excludes .harness/views in a normal repo and a linked worktree without editing gitignore", async () => {
    const main = await mkdtemp(path.join(os.tmpdir(), "ef-git-"));
    const linked = await mkdtemp(path.join(os.tmpdir(), "ef-git-wt-"));
    cleanups.push(async () => {
      await git(main, ["worktree", "remove", "--force", linked]);
      await rm(linked, { recursive: true, force: true }).catch(() => undefined);
      await rm(main, { recursive: true, force: true }).catch(() => undefined);
    });
    expect((await git(main, ["init"])).code).toBe(0);
    await writeFile(path.join(main, "README.md"), "hello\n", "utf8");
    expect((await git(main, ["add", "README.md"])).code).toBe(0);
    expect((await git(main, ["commit", "-m", "init"])).code).toBe(0);
    expect((await git(main, ["worktree", "add", "--detach", linked])).code).toBe(0);
    const guard = new GitExcludeGuard();
    const listed = (await git(main, ["rev-parse", "--git-path", "info/exclude"])).stdout.trim();
    const excludePath = path.isAbsolute(listed) ? listed : path.resolve(main, listed);
    await rm(excludePath, { force: true });
    const mainExclude = await guard.ensure(main);
    const linkedExclude = await guard.ensure(linked);
    expect(await readFile(mainExclude, "utf8")).toContain(".harness/views/");
    expect(await readFile(linkedExclude, "utf8")).toContain(".harness/views/");
    expect(await ignored(main, ".harness/views/decisions.md")).toBe(true);
    expect(await ignored(linked, ".harness/views/decisions.md")).toBe(true);
    const source = sampleSource();
    const exporter = new KnowledgeViewExporter({
      projectRoot: main,
      source,
      now: () => "2026-01-01T00:00:00.000Z",
    });
    await exporter.exportAll();
    const status = await git(main, ["status", "--porcelain", "--untracked-files=all"]);
    expect(status.stdout).not.toContain(".harness/views");
    const gitignore = path.join(main, ".gitignore");
    expect(await exists(gitignore)).toBe(false);
  });
});

class ScriptedWatcher implements WatchBackend {
  private callback: ((error: Error | null, events: readonly WatchEvent[]) => void) | null = null;

  async subscribe(
    _directory: string,
    callback: (error: Error | null, events: readonly WatchEvent[]) => void,
  ): Promise<{ unsubscribe(): Promise<void> }> {
    this.callback = callback;
    return {
      unsubscribe: async () => {
        this.callback = null;
      },
    };
  }

  emit(paths: readonly string[]): void {
    this.callback?.(
      null,
      paths.map((filePath) => ({ type: "update", path: filePath })),
    );
  }
}

function silentBackend(): WatchBackend {
  return {
    async subscribe() {
      return {
        async unsubscribe() {
          return undefined;
        },
      };
    },
  };
}

function busy(): NodeJS.ErrnoException {
  const error = new Error("busy") as NodeJS.ErrnoException;
  error.code = "EBUSY";
  return error;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function hashViews(projectRoot: string): Promise<Record<string, string>> {
  const root = path.join(projectRoot, ".harness", "views");
  const files: Record<string, string> = {};
  await walk(root, root, files);
  return files;
}

async function walk(root: string, directory: string, files: Record<string, string>): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(root, absolute, files);
      continue;
    }
    const relative = path.relative(root, absolute).replaceAll("\\", "/");
    files[relative] = digestSha256(normalizeLf(await readFile(absolute, "utf8")));
  }
}

function git(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "EF Harness",
          GIT_AUTHOR_EMAIL: "foundation@ef-harness.local",
          GIT_COMMITTER_NAME: "EF Harness",
          GIT_COMMITTER_EMAIL: "foundation@ef-harness.local",
        },
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const status = "status" in error && typeof error.status === "number" ? error.status : 1;
        resolve({ code: status, stdout, stderr });
      },
    );
  });
}

async function ignored(cwd: string, relative: string): Promise<boolean> {
  const result = await git(cwd, ["check-ignore", "-q", "--", relative]);
  return result.code === 0;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}
