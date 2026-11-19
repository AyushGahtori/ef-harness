import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WindowsJob } from "../src/job-object.ts";
import { canConnect, reserveLoopbackPort, type ReservedPort } from "../src/ports.ts";
import { isProcessAlive, readProcessIdentity, sameProcessAlive, terminateProcess } from "../src/process-table.ts";
import { delay } from "../src/readiness.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("Job Object kill-on-close", () => {
  it("kills an assigned child when the last job handle closes", async () => {
    const reserved = await reserveLoopbackPort();
    const job = await WindowsJob.open();
    await reserved.unhold();
    const sleeper = path.join(here, "../src/sleeper.mjs");
    const pid = await job.spawn({
      application: process.execPath,
      args: [sleeper, String(reserved.port), "redis"],
    });
    const listening = await waitUntil(() => canConnect("127.0.0.1", reserved.port, 200), 8_000);
    expect(listening).toBe(true);
    await job.release();
    await waitForExit(pid);
    expect(isProcessAlive(pid)).toBe(false);
    expect(await canConnect("127.0.0.1", reserved.port, 300)).toBe(false);
    await reserved.release();
  }, 60_000);

  it("leaves zero stand-in service processes after the orchestrator is hard-killed", async () => {
    const reserved: ReservedPort[] = [];
    for (let index = 0; index < 4; index += 1) reserved.push(await reserveLoopbackPort());
    for (const port of reserved) await port.unhold();
    const script = path.join(here, "../src/kill-orchestrator.ts");
    const child = spawn(process.execPath, [script, ...reserved.map((port) => String(port.port))], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const ready = await readJsonLine(child, () => stderr);
    const identities = [];
    for (const pid of ready.pids) {
      const identity = await readProcessIdentity(pid);
      expect(identity).not.toBeNull();
      if (identity) identities.push(identity);
      expect(isProcessAlive(pid)).toBe(true);
    }
    for (const port of ready.ports) {
      expect(await canConnect("127.0.0.1", port, 3000)).toBe(true);
    }
    await terminateProcess(child.pid ?? 0);
    for (const identity of identities) {
      const alive = await waitUntil(async () => !(await sameProcessAlive(identity)), 10_000);
      expect(alive).toBe(true);
    }
    if (child.pid) {
      const gone = await waitUntil(async () => !isProcessAlive(child.pid ?? 0), 10_000);
      expect(gone).toBe(true);
    }
    for (const port of ready.ports) {
      expect(await canConnect("127.0.0.1", port, 400)).toBe(false);
    }
    for (const port of reserved) await port.release();
  }, 90_000);
});

async function readJsonLine(
  child: ReturnType<typeof spawn>,
  stderr: () => string,
): Promise<{ pids: number[]; ports: number[]; roles: string[] }> {
  let buffer = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`orchestrator produced no ready line\n${buffer}\n${stderr()}`));
    }, 60_000);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      const index = buffer.indexOf("\n");
      if (index < 0) return;
      clearTimeout(timer);
      resolve(JSON.parse(buffer.slice(0, index)) as { pids: number[]; ports: number[]; roles: string[] });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`orchestrator exited ${code} before ready\n${buffer}\n${stderr()}`));
    });
  });
}

async function waitForExit(pid: number): Promise<void> {
  const finished = await waitUntil(async () => !isProcessAlive(pid), 10_000);
  expect(finished).toBe(true);
}

async function waitUntil(probe: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await probe()) return true;
    await delay(100);
  }
  return false;
}
