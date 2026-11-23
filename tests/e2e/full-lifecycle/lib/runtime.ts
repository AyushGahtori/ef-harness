import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function repoRoot(): string {
  return path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
}

export function fullLifecycleDir(): string {
  return path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
}

const textCache = new Map<string, string>();

export function readRepo(rel: string): string {
  const key = rel.replaceAll("\\", "/");
  const cached = textCache.get(key);
  if (cached !== undefined) return cached;
  const text = fs.readFileSync(path.join(repoRoot(), key), "utf8");
  textCache.set(key, text);
  return text;
}

export function assertIncludes(rel: string, needle: string): void {
  if (!readRepo(rel).includes(needle)) {
    throw new Error(`${rel} is missing settled text: ${needle}`);
  }
}

export class LocalPortBroker {
  readonly leases: number[] = [];
  private readonly servers: http.Server[] = [];

  async bind(server: http.Server): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected an ephemeral loopback port");
    }
    this.leases.push(address.port);
    this.servers.push(server);
    return address.port;
  }

  async closeAll(): Promise<void> {
    const servers = this.servers.splice(0);
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            if (!server.listening) {
              resolve();
              return;
            }
            server.close(() => resolve());
          }),
      ),
    );
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    return code === "EPERM";
  }
}

function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        process.kill(pid);
      } catch {
        /* already gone */
      }
      resolve();
    }, 500);
    const command = process.platform === "win32" ? "taskkill.exe" : "kill";
    const args = process.platform === "win32" ? ["/PID", String(pid), "/T", "/F"] : ["-KILL", `-${pid}`];
    const child = spawn(command, args, { windowsHide: true, stdio: "ignore" });
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once("exit", done);
    child.once("error", done);
  });
}

export class HygieneLedger {
  private readonly temps: string[] = [];
  private readonly pids = new Set<number>();

  temp(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    this.temps.push(dir);
    return dir;
  }

  release(dir: string): void {
    const index = this.temps.indexOf(dir);
    if (index >= 0) this.temps.splice(index, 1);
  }

  trackPid(pid: number | undefined): number {
    if (pid === undefined) throw new Error("child process did not expose a pid");
    this.pids.add(pid);
    return pid;
  }

  async cleanup(): Promise<{ leakedPids: number[]; leakedTemps: string[] }> {
    const leakedPids: number[] = [];
    for (const pid of this.pids) {
      await killTree(pid);
      if (processAlive(pid)) leakedPids.push(pid);
    }
    this.pids.clear();
    const leakedTemps: string[] = [];
    for (const dir of this.temps) {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {
        /* Windows may still be releasing git/sqlite handles */
      }
      if (fs.existsSync(dir)) leakedTemps.push(dir);
    }
    this.temps.length = 0;
    return { leakedPids, leakedTemps };
  }
}

export interface LifecycleContext {
  readonly ports: LocalPortBroker;
  readonly hygiene: HygieneLedger;
  temp(prefix: string): string;
  releaseTemp(dir: string): void;
  close(): Promise<{ leakedPids: number[]; leakedTemps: string[] }>;
}

export function createContext(): LifecycleContext {
  const ports = new LocalPortBroker();
  const hygiene = new HygieneLedger();
  return {
    ports,
    hygiene,
    temp(prefix: string) {
      return hygiene.temp(prefix);
    },
    releaseTemp(dir: string) {
      hygiene.release(dir);
    },
    async close() {
      await ports.closeAll();
      return hygiene.cleanup();
    },
  };
}

export async function withLifecycle<T>(fn: (ctx: LifecycleContext) => Promise<T>): Promise<T> {
  const ctx = createContext();
  try {
    return await fn(ctx);
  } finally {
    const leaks = await ctx.close();
    if (leaks.leakedPids.length > 0 || leaks.leakedTemps.length > 0) {
      throw new Error(`cleanup leaked pids=${leaks.leakedPids.join(",")} temps=${leaks.leakedTemps.join(",")}`);
    }
  }
}