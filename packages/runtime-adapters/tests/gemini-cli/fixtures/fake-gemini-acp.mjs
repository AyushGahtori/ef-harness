import readline from "node:readline";

const args = process.argv.slice(2);

function out(line) {
  process.stdout.write(`${line}\n`);
}

if (args.includes("--version")) {
  out(process.env.GEMINI_FAKE_VERSION || "0.21.0");
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  if (process.env.GEMINI_FAKE_HELP === "no-acp") out("gemini interactive");
  else out("Usage: gemini --acp");
  process.exit(0);
}

if (args.includes("--login")) {
  out("Sign in with Google");
  out(`isolated-home ${process.env.GEMINI_CLI_HOME ?? ""}`);
  if (process.env.GEMINI_FAKE_LOGIN_HOLD === "0") process.exit(0);
  setInterval(() => {}, 60_000);
}

const waiters = new Map();
let nextPermission = 9001;

function reply(id, result) {
  out(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

function fail(id, message, data) {
  out(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message, data } }));
}

function permissionParams(kind) {
  if (kind === "ssh") {
    return {
      sessionId: "gemini-session-1",
      toolCall: {
        toolCallId: "t-ssh",
        kind: "read",
        title: "read",
        rawInput: { path: process.env.GEMINI_FAKE_PATH || "" },
      },
    };
  }
  if (kind === "push") {
    return {
      sessionId: "gemini-session-1",
      toolCall: {
        toolCallId: "t-push",
        kind: "execute",
        title: "shell",
        rawInput: { command: "git push origin main" },
      },
    };
  }
  if (kind === "shell") {
    return {
      sessionId: "gemini-session-1",
      toolCall: {
        toolCallId: "t-shell",
        kind: "execute",
        title: "shell",
        rawInput: { command: process.env.GEMINI_FAKE_COMMAND || "npm test" },
      },
    };
  }
  if (kind === "write") {
    return {
      sessionId: "gemini-session-1",
      toolCall: {
        toolCallId: "t-write",
        kind: "write",
        title: "write",
        rawInput: { path: process.env.GEMINI_FAKE_PATH || "src/app.ts" },
      },
    };
  }
  return {
    sessionId: "gemini-session-1",
    toolCall: { toolCallId: "t-other", kind: "other", title: "other", rawInput: {} },
  };
}

async function handlePrompt(message) {
  const limit = process.env.GEMINI_FAKE_LIMIT ?? "";
  if (limit === "exhausted") {
    fail(message.id, "RESOURCE_EXHAUSTED", {
      status: "RESOURCE_EXHAUSTED",
      reason: "daily quota",
    });
    return;
  }
  if (limit === "rpm") {
    fail(message.id, "429", { httpStatus: 429, reason: "rpm" });
    return;
  }
  const kind = process.env.GEMINI_FAKE_PERMISSION ?? "";
  let outcome = "skipped";
  if (kind) {
    const reqId = nextPermission;
    nextPermission += 1;
    out(
      JSON.stringify({
        jsonrpc: "2.0",
        id: reqId,
        method: "session/request_permission",
        params: permissionParams(kind),
      }),
    );
    const response = await new Promise((resolve) => {
      waiters.set(reqId, resolve);
    });
    outcome = response?.result?.outcome?.outcome ?? "missing";
  }
  out(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "gemini-session-1",
        update: {
          sessionUpdate: "usage_update",
          usage: {
            inputTokens: 11,
            outputTokens: 7,
            cachedInputTokens: 3,
            cacheWriteTokens: 1,
            reasoningTokens: 2,
          },
        },
      },
    }),
  );
  reply(message.id, {
    stopReason: "end_turn",
    permissionOutcome: outcome,
    geminiCliHome: process.env.GEMINI_CLI_HOME ?? "",
    hasApiKey: typeof process.env.GEMINI_API_KEY === "string" && process.env.GEMINI_API_KEY.length > 0,
  });
}

function dispatch(message) {
  if (message.method === "initialize") {
    reply(message.id, { protocolVersion: 1, agentCapabilities: { loadSession: true } });
    return;
  }
  if (message.method === "session/new") {
    const servers = Array.isArray(message.params?.mcpServers) ? message.params.mcpServers : [];
    reply(message.id, {
      sessionId: "gemini-session-1",
      mcpNames: servers.map((server) => server.name),
    });
    return;
  }
  if (message.method === "session/prompt") {
    void handlePrompt(message);
    return;
  }
  if (message.method === "session/cancel") {
    reply(message.id, { cancelled: true });
    return;
  }
  if (message.method === "session/load") {
    reply(message.id, { sessionId: message.params?.sessionId ?? "gemini-session-1" });
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.method) {
    dispatch(message);
    return;
  }
  if (message.id !== undefined && message.result !== undefined) {
    const waiter = waiters.get(message.id);
    if (waiter) {
      waiters.delete(message.id);
      waiter(message);
    }
  }
});
rl.on("close", () => {
  setTimeout(() => process.exit(0), 20);
});
