import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { FrameCodec } from "../../src/bootstrap/frame-codec.js";
import { readSessionToken } from "../../src/bootstrap/session-token.js";

export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

export function uniquePipe(label: string): string {
  return `\\\\.\\pipe\\efharness-test-${label}-${process.pid}-${Math.random().toString(16).slice(2)}`;
}

export interface RunningDaemon {
  readonly profile: string;
  readonly pipe: string;
  readonly pid: number;
  readonly child: ChildProcess | null;
  token(): string;
  stop(): Promise<void>;
}

export async function startDaemon(options: {
  readonly pipe: string;
  readonly profile: string;
  readonly version?: string;
  readonly simTask?: boolean;
  readonly simStepMs?: number;
  readonly idleMs?: number;
  readonly handshakeMs?: number;
  readonly largeDiffBytes?: number;
  readonly diffNote?: string;
  readonly detachedParent?: boolean;
}): Promise<RunningDaemon> {
  fs.mkdirSync(options.profile, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    EF_HARNESS_PROFILE: options.profile,
    EF_HARNESS_PIPE: options.pipe,
    EF_HARNESS_DAEMON_VERSION: options.version ?? "0.0.0",
    EF_HARNESS_SIM_TASK: options.simTask ? "1" : "0",
    EF_HARNESS_SIM_STEP_MS: String(options.simStepMs ?? 40),
    EF_HARNESS_IDLE_MS: String(options.idleMs ?? 60_000),
    EF_HARNESS_HANDSHAKE_MS: String(options.handshakeMs ?? 5_000),
    EF_HARNESS_LARGE_DIFF_BYTES: String(options.largeDiffBytes ?? 0),
    EF_HARNESS_DIFF_NOTE: options.diffNote ?? "worker note: grouped print rows",
    EF_HARNESS_ALLOW_SYSTEM_NODE: "1",
  };
  const runtime = daemonCommand();
  const entry = path.join(repoRoot(), "apps", "daemon", "src", "bootstrap", "harnessd-main.ts");
  const args = ["--import", tsxRegister(), entry];
  const spawnLog = path.join(options.profile, "harnessd-spawn.log");
  let child: ChildProcess | null = null;
  let earlyExit: number | null = null;
  if (options.detachedParent) {
    const parentScript = path.join(options.profile, "parent.mjs");
    fs.writeFileSync(
      parentScript,
      [
        "import { spawn } from 'node:child_process';",
        "const child = spawn(process.argv[2], process.argv.slice(3), { detached: true, stdio: 'ignore', env: process.env, windowsHide: true });",
        "child.on('error', () => process.exit(1));",
        "child.unref();",
      ].join("\n"),
    );
    const parent = spawn(process.execPath, [parentScript, runtime.command, ...args], {
      env,
      stdio: "ignore",
      windowsHide: true,
    });
    const code = await exitCode(parent);
    if (code !== 0) throw new Error(`parent launcher exited ${code}`);
  } else {
    const logFd = fs.openSync(spawnLog, "a");
    child = spawn(runtime.command, args, {
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
    });
    fs.closeSync(logFd);
    child.on("exit", (code) => {
      earlyExit = code ?? 1;
    });
  }
  const ready = await waitForReady(options.profile, 15_000, () => earlyExit);
  return {
    profile: options.profile,
    pipe: options.pipe,
    pid: ready.pid,
    child,
    token: () => readSessionToken(path.join(options.profile, "session.token")),
    stop: async () => {
      const client = await PipeClient.connect(options.pipe, readSessionToken(path.join(options.profile, "session.token"))).catch(
        () => null,
      );
      if (client) {
        await client.request("daemon.shutdown", { op_id: `stop-${process.pid}-${Date.now()}` }).catch(() => undefined);
        client.close();
      }
      await waitForExit(ready.pid, 8_000);
      if (child && child.exitCode === null) child.kill();
    },
  };
}

export function tempProfile(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ef-m1-${label}-`));
}

export class PipeClient {
  private readonly socket: net.Socket;
  private readonly codec = new FrameCodec();
  private nextId = 1;
  private readonly waiters = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly notes: unknown[] = [];
  private readonly binary = new Map<number, Buffer[]>();

  private constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => {
      const frames = this.codec.push(chunk);
      for (const frame of frames) {
        if (frame.channel === 1 && frame.streamId !== null) {
          const list = this.binary.get(frame.streamId) ?? [];
          list.push(Buffer.from(frame.payload));
          this.binary.set(frame.streamId, list);
          continue;
        }
        const message = JSON.parse(Buffer.from(frame.payload).toString("utf8")) as {
          id?: number;
          result?: unknown;
          error?: { message?: string };
          method?: string;
          params?: unknown;
        };
        if (typeof message.id === "number" && this.waiters.has(message.id)) {
          const waiter = this.waiters.get(message.id);
          this.waiters.delete(message.id);
          if (!waiter) continue;
          if (message.error) waiter.reject(new Error(message.error.message ?? "rpc error"));
          else waiter.resolve(message.result);
        } else {
          this.notes.push(message);
        }
      }
    });
  }

  static connect(pipePath: string, token: string): Promise<PipeClient> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(pipePath);
      const client = new PipeClient(socket);
      const timer = setTimeout(() => reject(new Error("connect timeout")), 15_000);
      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.on("connect", () => {
        void client
          .request("session.hello", { token, protocol: "1.1", client: { name: "test", version: "0" } })
          .then(() => {
            clearTimeout(timer);
            resolve(client);
          })
          .catch((error: unknown) => {
            clearTimeout(timer);
            reject(error instanceof Error ? error : new Error("hello failed"));
          });
      });
    });
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.waiters.set(id, { resolve, reject });
      this.socket.write(FrameCodec.encodeJson(Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method, params }))));
      setTimeout(() => {
        if (this.waiters.has(id)) {
          this.waiters.delete(id);
          reject(new Error(`timeout ${method}`));
        }
      }, 20_000);
    });
  }

  notifications(): readonly unknown[] {
    return this.notes;
  }

  binaryBytes(streamId: number): Buffer {
    return Buffer.concat(this.binary.get(streamId) ?? []);
  }

  close(): void {
    this.socket.end();
    this.socket.destroy();
  }
}

export function daemonCommand(): { command: string; viaElectron: boolean } {
  try {
    const require = createRequire(path.join(repoRoot(), "package.json"));
    const resolved: unknown = require("electron");
    if (typeof resolved === "string" && resolved.length > 0 && fs.existsSync(resolved)) {
      return { command: resolved, viaElectron: true };
    }
  } catch {
    return { command: process.execPath, viaElectron: false };
  }
  return { command: process.execPath, viaElectron: false };
}

function tsxRegister(): string {
  const require = createRequire(path.join(repoRoot(), "package.json"));
  // Electron's Node rejects a bare Windows path in `--import` (`protocol 'c:'`).
  return pathToFileURL(require.resolve("tsx")).href;
}

async function waitForReady(
  profile: string,
  timeoutMs: number,
  exited?: () => number | null,
): Promise<{ pid: number; daemonVersion: string }> {
  const file = path.join(profile, "harnessd.ready.json");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8")) as { pid: number; daemonVersion: string };
    }
    const fatal = readIfExists(path.join(profile, "harnessd-fatal.log"));
    if (fatal.length > 0) throw new Error(fatal);
    const code = exited?.() ?? null;
    if (code !== null) throw new Error(`harnessd exited ${code} before ready\n${readIfExists(path.join(profile, "harnessd-spawn.log"))}`);
    await delay(40);
  }
  throw new Error(`harnessd did not write a ready file\n${readIfExists(path.join(profile, "harnessd-spawn.log"))}`);
}

function readIfExists(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

export async function waitForExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive(pid)) return;
    await delay(40);
  }
  throw new Error(`pid ${pid} is still running`);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function exitCode(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    child.on("exit", (code) => resolve(code));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
