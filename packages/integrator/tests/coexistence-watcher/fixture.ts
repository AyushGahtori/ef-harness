import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { WatchBackend, WatchEvent, WatchSubscription } from "../../src/coexistence-watcher/watch-backend.js";
import type { RefLeaseAndCasManagerPort } from "../../src/coexistence-watcher/ports.js";
import { HARNESS_INTEGRATION_REF } from "../../src/coexistence-watcher/constants.js";

export class MockWatchBackend implements WatchBackend {
  readonly subscriptions: Array<{ directory: string; callback: (error: Error | null, events: readonly WatchEvent[]) => void }> =
    [];
  private live: MockWatchSubscription[] = [];

  async subscribe(
    directory: string,
    callback: (error: Error | null, events: readonly WatchEvent[]) => void,
  ): Promise<WatchSubscription> {
    const sub = new MockWatchSubscription(directory, callback, () => {
      const index = this.live.indexOf(sub);
      if (index >= 0) this.live.splice(index, 1);
    });
    this.subscriptions.push({ directory, callback });
    this.live.push(sub);
    return sub;
  }

  emit(directory: string, events: readonly WatchEvent[]): void {
    for (const sub of this.live) {
      if (sub.directory === directory) sub.callback(null, events);
    }
  }

  liveCount(): number {
    return this.live.length;
  }
}

class MockWatchSubscription implements WatchSubscription {
  unsubscribed = false;

  constructor(
    readonly directory: string,
    readonly callback: (error: Error | null, events: readonly WatchEvent[]) => void,
    private readonly onUnsub: () => void,
  ) {}

  async unsubscribe(): Promise<void> {
    this.unsubscribed = true;
    this.onUnsub();
  }
}

export class InMemoryRefLease implements RefLeaseAndCasManagerPort {
  private readonly refs = new Map<string, string>();

  seed(repoRoot: string, ref: string, sha: string): void {
    this.refs.set(key(repoRoot, ref), sha);
  }

  readRef(repoRoot: string, ref: string): string | null {
    return this.refs.get(key(repoRoot, ref)) ?? null;
  }

  advanceRefCas(repoRoot: string, ref: string, expected: string, next: string): boolean {
    const k = key(repoRoot, ref);
    if (this.refs.get(k) !== expected) return false;
    this.refs.set(k, next);
    return true;
  }
}

function key(repoRoot: string, ref: string): string {
  return `${repoRoot}\0${ref}`;
}

function git(args: string[], cwd: string): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "git failed").trim());
  }
}

export async function createTempRepo(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ef-coexist-"));
  git(["init"], root);
  git(["config", "user.email", "dev@example.com"], root);
  git(["config", "user.name", "Dev"], root);
  await mkdir(path.join(root, "src", "api"), { recursive: true });
  await mkdir(path.join(root, "src", "marketing"), { recursive: true });
  await writeFile(path.join(root, "README.md"), "# demo\n", "utf8");
  await writeFile(path.join(root, "src", "api", "orders.ts"), "export {}\n", "utf8");
  await writeFile(path.join(root, "package.json"), '{"name":"demo"}\n', "utf8");
  git(["add", "."], root);
  git(["commit", "-m", "init"], root);
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  git(["branch", "-M", "main"], root);
  git(["update-ref", HARNESS_INTEGRATION_REF, head], root);
  return {
    root,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function commitFile(repoRoot: string, relative: string, contents: string, message: string): Promise<string> {
  const full = path.join(repoRoot, relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, contents, "utf8");
  git(["add", relative], repoRoot);
  git(["commit", "-m", message], repoRoot);
  return spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();
}