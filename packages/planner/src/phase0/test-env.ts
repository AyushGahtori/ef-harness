import { spawn } from "node:child_process";
import net from "node:net";

import { Phase0Error } from "./errors.js";
import type { TestEnvHandle, TestEnvOrchestratorPort, TestEnvTeardown } from "./ports.js";
import { TEST_ENV_PORT_MAX, TEST_ENV_PORT_MIN } from "./types.js";

const SERVER = `
const http = require("node:http");
const port = Number(process.env.EF_PORT);
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("ok");
});
server.listen(port, "127.0.0.1");
`;

interface ChildHandle extends TestEnvHandle {
  readonly child: ReturnType<typeof spawn>;
}

/**
 * Leases a real loopback HTTP server inside `41000–48999`.
 * `leakTeardowns` leaves that many children alive so Gate 0 can see orphans.
 */
export class LocalTestEnvOrchestrator implements TestEnvOrchestratorPort {
  private readonly children = new Map<number, ChildHandle>();
  private leaksRemaining: number;

  constructor(leakTeardowns = 0) {
    this.leaksRemaining = leakTeardowns;
  }

  async start(): Promise<TestEnvHandle> {
    const port = await leasePort();
    const child = spawn(process.execPath, ["-e", SERVER], {
      windowsHide: true,
      stdio: "ignore",
      env: { ...process.env, EF_PORT: String(port) },
    });
    const pid = child.pid;
    if (!pid) {
      child.kill();
      throw new Phase0Error("test_env", "Test environment process did not receive a pid");
    }
    const handle: ChildHandle = { pid, port, child };
    this.children.set(pid, handle);
    const healthy = await this.health(handle);
    if (!healthy) {
      await this.teardown(handle);
      throw new Phase0Error("test_env", `Test environment did not pass health on ${port}`);
    }
    return { pid, port };
  }

  async health(handle: TestEnvHandle): Promise<boolean> {
    if (handle.port < TEST_ENV_PORT_MIN || handle.port > TEST_ENV_PORT_MAX) return false;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${handle.port}/`, { signal: AbortSignal.timeout(500) });
        if (response.ok && (await response.text()) === "ok") return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.length >= 0) await delay(40);
      }
    }
    return false;
  }

  async teardown(handle: TestEnvHandle): Promise<TestEnvTeardown> {
    const child = this.children.get(handle.pid);
    if (this.leaksRemaining > 0) {
      this.leaksRemaining -= 1;
      return { leakedPids: [handle.pid] };
    }
    if (child) child.child.kill();
    else killPid(handle.pid);
    if (child) await waitForExit(child.child);
    this.children.delete(handle.pid);
    return { leakedPids: [] };
  }

  async dispose(): Promise<void> {
    const pending = [...this.children.values()];
    this.leaksRemaining = 0;
    for (const handle of pending) {
      handle.child.kill();
      await waitForExit(handle.child);
      this.children.delete(handle.pid);
    }
  }
}

export class LocalJobObjectAudit {
  orphanedPids(pids: readonly number[]): number[] {
    const alive: number[] = [];
    for (const pid of pids) {
      if (isAlive(pid)) alive.push(pid);
    }
    return alive;
  }
}

function leasePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const attempt = (port: number): void => {
      if (port > TEST_ENV_PORT_MAX) {
        reject(new Phase0Error("test_env", "No free port in 41000-48999"));
        return;
      }
      const server = net.createServer();
      server.once("error", () => {
        server.close();
        attempt(port + 1);
      });
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(port));
      });
    };
    attempt(TEST_ENV_PORT_MIN);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve();
    }, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    return code !== "ESRCH";
  }
}

function killPid(pid: number): void {
  if (!isAlive(pid)) return;
  try {
    process.kill(pid);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "ESRCH") return;
  }
}
