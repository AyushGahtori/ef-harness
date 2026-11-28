import fs from "node:fs";
import readline from "node:readline";

const scenario = process.env.EF_FAKE_SCENARIO ?? "stream";
const logPath = process.env.EF_FAKE_LOG ?? "";
const pending = new Map();
let nextServerId = 1;
let sessionId = "acp-session-1";

function log(method) {
  if (!logPath) return;
  fs.appendFileSync(logPath, `${process.pid} ${method}\n`);
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function rpcRequest(method, params) {
  const id = `srv-${nextServerId}`;
  nextServerId += 1;
  write({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve) => {
    pending.set(id, resolve);
  });
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
    write({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } });
    return;
  }
  if (method === "session/new") {
    write({ jsonrpc: "2.0", id: message.id, result: { sessionId } });
    return;
  }
  if (method === "session/load") {
    if (process.env.EF_FAKE_RESUME === "fail") {
      write({ jsonrpc: "2.0", id: message.id, error: { code: 1001, message: "SESSION_NOT_FOUND" } });
      return;
    }
    write({
      jsonrpc: "2.0",
      id: message.id,
      result: { sessionId: message.params?.sessionId ?? sessionId, ok: true },
    });
    return;
  }
  if (method === "session/cancel") {
    write({ jsonrpc: "2.0", id: message.id, result: { ok: true } });
    return;
  }
  if (method === "session/prompt") {
    const turnId = `acp-turn-${nextServerId}`;
    nextServerId += 1;
    if (scenario === "approvals") {
      await rpcRequest("session/request_permission", {
        sessionId,
        toolCall: {
          toolCallId: "tool-1",
          kind: "edit",
          path: process.env.EF_FAKE_FILE_PATH ?? "src/ok.ts",
        },
      });
      await rpcRequest("session/request_permission", {
        sessionId,
        toolCall: {
          toolCallId: "tool-2",
          kind: "execute",
          command: process.env.EF_FAKE_COMMAND ?? "git push",
        },
      });
    }
    write({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
      },
    });
    write({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "usage_update",
          usage: { inputTokens: 8, outputTokens: 2, cachedInputTokens: 0, reasoningTokens: 0 },
        },
      },
    });
    write({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn", turnId } });
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
