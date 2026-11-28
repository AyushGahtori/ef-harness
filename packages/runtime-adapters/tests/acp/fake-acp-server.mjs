const scenario = process.env.EF_ACP_SCENARIO || "lifecycle";
const allowPath = process.env.EF_ACP_ALLOW_PATH || "";
const denyPath = process.env.EF_ACP_DENY_PATH || "";
const sshPath = process.env.EF_ACP_SSH_PATH || "";
const symlinkPath = process.env.EF_ACP_SYMLINK_PATH || "";

process.stderr.write("acp-diag: stderr stays off the rpc stream\n");
process.stderr.write(`acp-diag: openai ${process.env.OPENAI_API_KEY ? "present" : "absent"}\n`);

if (scenario === "banner" || scenario === "double-banner") {
  process.stdout.write("Welcome to Agent v1.2!\n");
}
if (scenario === "double-banner") {
  process.stdout.write("still not json\n");
}

let buffer = "";
let nextId = 1;
const pending = new Map();
let promptId = null;
const sessionId = "agent-session-1";
let loadRequests = 0;
let cancelled = false;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function request(method, params) {
  const id = nextId;
  nextId += 1;
  send({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).replace(/\r$/, "");
    buffer = buffer.slice(newline + 1);
    if (line.trim()) {
      void handleLine(line);
    }
    newline = buffer.indexOf("\n");
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});

async function handleLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof message.method === "string") {
    await handleClient(message);
    return;
  }
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(message.error);
  else waiter.resolve(message.result);
}

async function handleClient(message) {
  if (message.method === "initialize") {
    if (scenario === "hang-init") return;
    if (scenario === "version-mismatch") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { protocolVersion: 99, agentCapabilities: { loadSession: false } },
      });
      return;
    }
    if (scenario === "capability-mismatch") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: { loadSession: false, requiredClientCapabilities: ["fs.deleteFile"] },
        },
      });
      return;
    }
    const loadSession = scenario !== "no-load";
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession, promptCapabilities: { image: false } },
        agentInfo: { name: "fake-acp", version: "1.2.0" },
      },
    });
    if (scenario === "corrupt") process.stdout.write("NOT_JSON\n");
    if (scenario === "flood") {
      for (let index = 0; index < 9; index += 1) {
        send({ jsonrpc: "2.0", id: `unknown-${index}`, method: "agent/unknown", params: {} });
      }
    }
    return;
  }
  if (message.method === "session/new") {
    const servers = message.params && Array.isArray(message.params.mcpServers) ? message.params.mcpServers : [];
    const first = servers[0] ?? {};
    const headers = Array.isArray(first.headers) ? first.headers : [];
    const header = headers.find((item) => item && item.name === "Authorization");
    const value = header && typeof header.value === "string" ? header.value : "";
    const present = value.startsWith("Bearer ") && value.length > "Bearer ".length;
    const tools = Array.isArray(first.tools) ? first.tools.join(",") : "";
    process.stderr.write(`acp-diag: mcp-bearer ${present ? "present" : "missing"}\n`);
    process.stderr.write(`acp-diag: mcp-tools ${tools}\n`);
    send({ jsonrpc: "2.0", id: message.id, result: { sessionId } });
    return;
  }
  if (message.method === "session/load") {
    loadRequests += 1;
    process.stderr.write(`acp-diag: load-requests ${loadRequests}\n`);
    send({ jsonrpc: "2.0", id: message.id, result: { sessionId } });
    return;
  }
  if (message.method === "session/cancel") {
    cancelled = true;
    process.stderr.write("acp-diag: cancel received\n");
    return;
  }
  if (message.method === "session/prompt") {
    promptId = message.id;
    try {
      await runPrompt();
      if (promptId !== null) {
        const id = promptId;
        promptId = null;
        send({ jsonrpc: "2.0", id, result: { stopReason: cancelled ? "cancelled" : "end_turn" } });
      }
      if (cancelled) setTimeout(() => process.exit(0), 20);
    } catch (error) {
      const detail = error && error.message ? error.message : "failed";
      process.stderr.write(`acp-diag: prompt-error ${detail}\n`);
      if (promptId !== null) {
        const id = promptId;
        promptId = null;
        send({ jsonrpc: "2.0", id, result: { stopReason: "cancelled" } });
      }
    }
  }
}

async function runPrompt() {
  if (scenario === "permission-cancel") {
    const outcome = await request("session/request_permission", {
      sessionId,
      toolCall: {
        toolCallId: "perm-1",
        title: "edit src",
        kind: "edit",
        rawInput: { path: allowPath || "src/app.ts" },
      },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject once", kind: "reject_once" },
      ],
    });
    process.stderr.write(`acp-diag: permission ${JSON.stringify(outcome.outcome)}\n`);
    return;
  }
  if (scenario === "lifecycle" || scenario === "banner" || scenario === "fs-terminal" || scenario === "no-load") {
    sendUpdate("agent_message_chunk", { content: { type: "text", text: "Hello from ACP" } });
    sendUpdate("agent_thought_chunk", { content: { type: "text", text: "planning the edit" } });
    sendUpdate("plan", { entries: [{ content: "edit src", priority: "high", status: "pending" }] });
    sendUpdate("tool_call", { toolCallId: "t1", title: "read", kind: "read", status: "pending" });
    sendUpdate("tool_call_update", { toolCallId: "t1", status: "completed" });
    sendUpdate("usage_update", {
      inputTokens: 10,
      cachedInputTokens: 1,
      outputTokens: 4,
      reasoningTokens: 2,
      costMicroUsd: 5,
    });
    sendUpdate("future_widget", { note: "ignore me" });
  }
  if (scenario !== "fs-terminal" && scenario !== "pool") return;
  if (scenario === "pool") {
    const results = await Promise.all([
      request("terminal/create", { sessionId, command: "node hold-a" }),
      request("terminal/create", { sessionId, command: "node hold-b" }),
      request("terminal/create", { sessionId, command: "vitest run" }),
    ]);
    process.stderr.write(`acp-diag: pool ${results.length}\n`);
    return;
  }
  const allowed = await request("fs/read_text_file", { sessionId, path: allowPath, line: 1, limit: 2 });
  process.stderr.write(`acp-diag: read-allow ${allowed.content}\n`);
  const denied = await request("fs/read_text_file", { sessionId, path: sshPath }).catch((error) => error);
  process.stderr.write(`acp-diag: read-ssh ${denied.code}\n`);
  const symlink = await request("fs/read_text_file", { sessionId, path: symlinkPath }).catch((error) => error);
  process.stderr.write(`acp-diag: read-symlink ${symlink.code}\n`);
  const write = await request("fs/write_text_file", { sessionId, path: allowPath, content: "updated\n" });
  process.stderr.write(`acp-diag: write-allow ${write.bytesWritten}\n`);
  const writeDeny = await request("fs/write_text_file", { sessionId, path: denyPath, content: "nope" }).catch(
    (error) => error,
  );
  process.stderr.write(`acp-diag: write-deny ${writeDeny.code}\n`);
  const push = await request("terminal/create", { sessionId, command: "git push --force origin main" }).catch(
    (error) => error,
  );
  process.stderr.write(`acp-diag: push ${push.code}\n`);
  const created = await request("terminal/create", { sessionId, command: "vitest run" });
  const exit = await request("terminal/wait_for_exit", { sessionId, terminalId: created.terminalId });
  const output = await request("terminal/output", { sessionId, terminalId: created.terminalId });
  await request("terminal/release", { sessionId, terminalId: created.terminalId });
  process.stderr.write(`acp-diag: vitest ${exit.exitCode} ${output.output}\n`);
  const permission = await request("session/request_permission", {
    sessionId,
    toolCall: { toolCallId: "perm-ssh", title: "read ssh", kind: "read", rawInput: { path: sshPath } },
    options: [
      { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
      { optionId: "reject-once", name: "Reject once", kind: "reject_once" },
    ],
  });
  process.stderr.write(`acp-diag: permission ${JSON.stringify(permission.outcome)}\n`);
}

function sendUpdate(sessionUpdate, fields) {
  send({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId, update: { sessionUpdate, ...fields } },
  });
}
