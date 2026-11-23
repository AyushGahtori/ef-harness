import readline from "node:readline";

const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write("opencode 1.2.3\n");
  process.exit(0);
}
if (args[0] === "acp" && args.includes("--help")) {
  process.stdout.write("Usage: opencode acp [--help]\nAgent Client Protocol\n");
  process.exit(0);
}
if (args[0] !== "acp") {
  process.stderr.write(`unknown command ${args.join(" ")}\n`);
  process.exit(2);
}

process.stderr.write("Welcome to OpenCode ACP\n");
process.stdout.write("Welcome to OpenCode ACP\n");

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let nextId = 1;
const pending = new Map();
let sessionId = "oc-session-1";
const cancelWaiters = [];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function requestPermission(toolCall) {
  const id = nextId;
  nextId += 1;
  send({
    jsonrpc: "2.0",
    id,
    method: "session/request_permission",
    params: {
      sessionId,
      toolCall,
      options: [
        { optionId: "allow", kind: "allow_once", name: "Allow once" },
        { optionId: "reject", kind: "reject_once", name: "Reject once" },
      ],
    },
  });
  return new Promise((resolve) => {
    pending.set(id, resolve);
  });
}

function notify(update) {
  send({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId, update },
  });
}

async function runPrompt(id, text) {
  if (text.includes("MODE:block")) {
    await new Promise((resolve) => {
      cancelWaiters.push(resolve);
    });
    send({ jsonrpc: "2.0", id, result: { stopReason: "cancelled" } });
    return;
  }
  const high = text.includes("MODE:usage-high");
  notify({
    sessionUpdate: "usage_update",
    input: high ? 780 : 1200,
    output: high ? 0 : 300,
    cacheRead: high ? 0 : 40,
    cacheWrite: high ? 0 : 15,
    reasoning: high ? 0 : 80,
  });
  notify({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  });
  if (!high) {
    await requestPermission({
      toolCallId: "bash-1",
      kind: "execute",
      title: "bash",
      rawInput: { tool: "bash", command: "rm -rf /" },
    });
    await requestPermission({
      toolCallId: "web-1",
      kind: "fetch",
      title: "webfetch",
      rawInput: { tool: "webfetch", url: "https://evil.com" },
    });
    await requestPermission({
      toolCallId: "edit-ok",
      kind: "edit",
      title: "edit",
      rawInput: { tool: "edit", path: "src/allowed.ts" },
    });
    await requestPermission({
      toolCallId: "edit-bad",
      kind: "edit",
      title: "edit",
      rawInput: { tool: "edit", path: "../outside.txt" },
    });
    await requestPermission({
      toolCallId: "run-1",
      kind: "other",
      title: "harness.run",
      rawInput: { tool: "harness.run", command: "node -e \"console.log('ok')\"" },
    });
  }
  send({ jsonrpc: "2.0", id, result: { stopReason: "end_turn" } });
}

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (msg.method) {
    if (msg.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: { loadSession: true, mcp: true },
          agentInfo: { name: "opencode", version: "1.2.3" },
        },
      });
      return;
    }
    if (msg.method === "session/new") {
      sessionId = "oc-session-1";
      process.stderr.write(`SESSION_NEW:${JSON.stringify(msg.params)}\n`);
      send({ jsonrpc: "2.0", id: msg.id, result: { sessionId } });
      return;
    }
    if (msg.method === "session/prompt") {
      const blocks = Array.isArray(msg.params?.prompt) ? msg.params.prompt : [];
      const text = blocks.map((block) => (typeof block?.text === "string" ? block.text : "")).join("\n");
      void runPrompt(msg.id, text);
      return;
    }
    if (msg.method === "session/cancel") {
      for (const waiter of cancelWaiters) waiter();
      cancelWaiters.length = 0;
      send({ jsonrpc: "2.0", id: msg.id, result: {} });
      return;
    }
    if (msg.method === "session/load") {
      const requested = msg.params?.sessionId;
      if (requested === "missing") {
        send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32001, message: "SESSION_NOT_FOUND" },
        });
        return;
      }
      send({ jsonrpc: "2.0", id: msg.id, result: { sessionId: requested } });
      return;
    }
    if (msg.id !== undefined) {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `method not found: ${msg.method}` },
      });
    }
    return;
  }
  if (msg.id !== undefined && pending.has(msg.id)) {
    const resolve = pending.get(msg.id);
    pending.delete(msg.id);
    resolve(msg.result ?? null);
  }
});
