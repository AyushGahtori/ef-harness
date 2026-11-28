import { spawn } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";

const scenario = process.env.EF_FAKE_SCENARIO ?? "stream";
const logPath = process.env.EF_FAKE_LOG ?? "";
const threadId = process.env.EF_FAKE_THREAD_ID ?? "thread-1";
const pending = new Map();
const interrupted = new Set();
let nextServerId = 1;

function log(method) {
  if (!logPath) return;
  fs.appendFileSync(logPath, `${process.pid} ${method}\n`);
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function usage() {
  return { inputTokens: 12, outputTokens: 3, cachedInputTokens: 1, reasoningTokens: 0 };
}

function rateLimits() {
  let primary = Number(process.env.EF_FAKE_PRIMARY_PERCENT ?? "10");
  const file = process.env.EF_FAKE_PERCENT_FILE;
  if (file && fs.existsSync(file)) {
    const parsed = Number(fs.readFileSync(file, "utf8").trim());
    if (Number.isFinite(parsed)) primary = parsed;
  }
  return {
    primary: {
      usedPercent: primary,
      window: "5h",
      resetAt: process.env.EF_FAKE_PRIMARY_RESET ?? "2026-11-23T16:00:00.000Z",
    },
    secondary: {
      usedPercent: Number(process.env.EF_FAKE_SECONDARY_PERCENT ?? "4"),
      window: "7d",
      resetAt: process.env.EF_FAKE_SECONDARY_RESET ?? "2026-11-30T00:00:00.000Z",
    },
  };
}

function rpcRequest(method, params) {
  const id = `srv-${nextServerId}`;
  nextServerId += 1;
  write({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve) => {
    pending.set(id, resolve);
  });
}

async function holdUntilRelease(turnId) {
  const hold = process.env.EF_FAKE_HOLD_PATH;
  const release = process.env.EF_FAKE_RELEASE_PATH;
  if (hold) fs.writeFileSync(hold, "holding");
  const started = Date.now();
  while (!release || !fs.existsSync(release)) {
    if (interrupted.has(turnId)) return false;
    if (Date.now() - started > 8000) return false;
    await new Promise((resolve) => {
      setTimeout(resolve, 15);
    });
  }
  return !interrupted.has(turnId);
}

async function handle(message) {
  if (message.id !== undefined && message.method === undefined) {
    const waiter = pending.get(String(message.id));
    if (waiter) {
      pending.delete(String(message.id));
      waiter(message.result ?? {});
    }
    return;
  }
  const method = message.method;
  log(String(method));
  if (method === "initialize") {
    if (scenario === "bad-init") {
      write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "method not found" } });
      return;
    }
    write({
      jsonrpc: "2.0",
      id: message.id,
      result: { protocolVersion: "1", serverInfo: { name: "codex-app-server", version: "9.9.9" } },
    });
    return;
  }
  if (method === "thread/start") {
    write({ jsonrpc: "2.0", id: message.id, result: { threadId } });
    return;
  }
  if (method === "thread/resume") {
    if (scenario === "resume-fail" || process.env.EF_FAKE_RESUME === "fail") {
      write({ jsonrpc: "2.0", id: message.id, error: { code: 1001, message: "SESSION_NOT_FOUND" } });
      return;
    }
    const requested = message.params?.threadId ?? threadId;
    write({ jsonrpc: "2.0", id: message.id, result: { threadId: requested, resumed: true } });
    return;
  }
  if (method === "account/rateLimits/read") {
    write({ jsonrpc: "2.0", id: message.id, result: rateLimits() });
    return;
  }
  if (method === "turn/interrupt") {
    if (scenario === "ignore-interrupt") return;
    const turnId = message.params?.turnId ?? "turn-unknown";
    interrupted.add(turnId);
    write({ jsonrpc: "2.0", id: message.id, result: { turnId, status: "interrupted" } });
    write({ jsonrpc: "2.0", method: "turn/completed", params: { threadId, turnId, status: "interrupted", usage: usage() } });
    return;
  }
  if (method === "turn/start") {
    const turnId = `turn-${nextServerId}`;
    nextServerId += 1;
    write({ jsonrpc: "2.0", id: message.id, result: { turnId } });
    if (scenario === "exit") {
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
        windowsHide: true,
      });
      if (process.env.EF_FAKE_CHILD_PID_FILE && child.pid) {
        fs.writeFileSync(process.env.EF_FAKE_CHILD_PID_FILE, String(child.pid));
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 40);
      });
      process.exit(1);
    }
    if (scenario === "ignore-interrupt") {
      await new Promise(() => undefined);
      return;
    }
    if (scenario === "hold") {
      const continueTurn = await holdUntilRelease(turnId);
      if (!continueTurn) return;
    }
    if (scenario === "approvals") {
      await rpcRequest("item/fileChange/requestApproval", {
        threadId,
        turnId,
        itemId: "item-file",
        path: process.env.EF_FAKE_FILE_PATH ?? "src/ok.ts",
      });
      await rpcRequest("item/commandExecution/requestApproval", {
        threadId,
        turnId,
        itemId: "item-cmd",
        command: process.env.EF_FAKE_COMMAND ?? "git push",
      });
    }
    const text = process.env.EF_FAKE_DELTA ?? "hello";
    write({ jsonrpc: "2.0", method: "item/delta", params: { threadId, turnId, itemId: "item-1", delta: text } });
    write({
      jsonrpc: "2.0",
      method: "turn/completed",
      params: { threadId, turnId, status: "completed", usage: usage() },
    });
    return;
  }
  if (message.id !== undefined) {
    write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `unknown ${method}` } });
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  void handle(message);
});
