import fs from "node:fs";
import readline from "node:readline";

const args = process.argv.slice(2);

function env(name) {
  return process.env[name] ?? "";
}

function writeReceipt() {
  const receiptPath = env("EF_FAKE_CLAUDE_RECEIPT");
  if (!receiptPath) return;
  const captured = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD|ANTHROPIC|AWS_|STRIPE|GITHUB|AUTHORIZATION|CLAUDE_|PROXY|EF_/i.test(key)) {
      captured[key] = value;
    }
  }
  fs.writeFileSync(
    receiptPath,
    JSON.stringify({ argv: args, env: captured, cwd: process.cwd() }, null, 2),
  );
}

if (args.includes("--version")) {
  writeReceipt();
  const version = env("EF_FAKE_CLAUDE_VERSION") || "2.1.0";
  if (version === "missing") process.exit(1);
  process.stdout.write(`${version}\n`);
  process.exit(0);
}

writeReceipt();

const scenario = env("EF_FAKE_CLAUDE_SCENARIO") || "turn";
const resumeAt = args.indexOf("--resume");
const sessionId =
  resumeAt >= 0 && args[resumeAt + 1] ? args[resumeAt + 1] : env("EF_FAKE_CLAUDE_SESSION_ID") || "session-fake-1";
const decisionsPath = env("EF_FAKE_CLAUDE_DECISIONS");
const messagesPath = env("EF_FAKE_CLAUDE_MESSAGES");
const userTexts = [];

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function usage() {
  const raw = env("EF_FAKE_CLAUDE_USAGE_JSON");
  if (!raw) {
    return {
      input_tokens: 11,
      output_tokens: 5,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 2,
    };
  }
  return JSON.parse(raw);
}

let stopping = false;

function resultPayload(subtype, extra) {
  const cost = extra.totalCostUsd ?? env("EF_FAKE_CLAUDE_TOTAL_COST_USD");
  return {
    type: "result",
    subtype,
    is_error: subtype !== "success",
    session_id: sessionId,
    total_cost_usd: cost === "" || cost === undefined ? 0 : Number(cost),
    usage: usage(),
    result: extra.result ?? "",
  };
}

function emitResult(subtype, extra) {
  emit(resultPayload(subtype, extra));
}

function shutdown(subtype, extra) {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`${JSON.stringify(resultPayload(subtype, extra))}\n`, () => {
    process.exit(0);
  });
}

function remember(text) {
  userTexts.push(text);
  if (messagesPath) fs.appendFileSync(messagesPath, `${text}\n`);
}

emit({ type: "system", subtype: "init", session_id: sessionId });

if (scenario === "ignore-interrupt") {
  process.on("SIGINT", () => undefined);
} else {
  process.on("SIGINT", () => {
    shutdown("success", { result: "interrupted", totalCostUsd: env("EF_FAKE_CLAUDE_TOTAL_COST_USD") || "0.001" });
  });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "bad json"}\n`);
    return;
  }
  if (message.type === "control_request" && message.request && message.request.subtype === "interrupt") {
    if (scenario === "ignore-interrupt") return;
    shutdown("success", { result: "interrupted", totalCostUsd: env("EF_FAKE_CLAUDE_TOTAL_COST_USD") || "0.001" });
  }
  if (message.type === "control_response") {
    const behavior = message.response?.response?.behavior ?? "unknown";
    if (decisionsPath) {
      fs.appendFileSync(decisionsPath, `${JSON.stringify({ behavior, request_id: message.response?.request_id })}\n`);
    }
    emit({
      type: "user",
      session_id: sessionId,
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: behavior }],
      },
    });
    emitResult("success", { result: "permitted" });
    return;
  }
  if (message.type !== "user") return;
  const blocks = message.message?.content ?? [];
  const text = blocks.map((block) => (typeof block?.text === "string" ? block.text : "")).join("");
  remember(text);
  if (scenario === "nonzero") {
    process.stderr.write(`fail ${env("ANTHROPIC_API_KEY")}\n`);
    process.exit(2);
  }
  if (scenario === "budget") {
    emitResult("error_max_budget_usd", {
      result: "budget",
      totalCostUsd: env("EF_FAKE_CLAUDE_TOTAL_COST_USD") || "0.50",
    });
    return;
  }
  if (scenario === "permission") {
    const tool = JSON.parse(env("EF_FAKE_CLAUDE_PERMISSION_JSON") || "{\"tool_name\":\"Read\",\"input\":{\"file_path\":\"src/app.ts\"}}");
    emit({
      type: "assistant",
      session_id: sessionId,
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "checking" },
          { type: "tool_use", id: "toolu_1", name: tool.tool_name, input: tool.input },
        ],
        usage: usage(),
      },
    });
    emit({
      type: "control_request",
      request_id: "req-1",
      request: {
        subtype: "can_use_tool",
        tool_name: tool.tool_name,
        input: tool.input,
        tool_use_id: "toolu_1",
      },
    });
    return;
  }
  if (scenario === "hold-for-steer") {
    emit({
      type: "assistant",
      session_id: sessionId,
      message: { role: "assistant", content: [{ type: "text", text: "working" }] },
    });
    if (userTexts.length < 2) return;
    emitResult("success", { result: "steered" });
    return;
  }
  if (scenario === "interrupt" || scenario === "ignore-interrupt") {
    emit({
      type: "assistant",
      session_id: sessionId,
      message: { role: "assistant", content: [{ type: "text", text: "working" }] },
    });
    return;
  }
  emit({
    type: "assistant",
    session_id: sessionId,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      usage: usage(),
    },
  });
  emitResult("success", { result: "ok" });
});
