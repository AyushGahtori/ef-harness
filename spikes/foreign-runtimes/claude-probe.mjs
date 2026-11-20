import {
  assertClaudeLaunchArgs,
  assertSafeProbePath,
  ClaudeCredentialError,
  resolveClaudeApiKey,
} from "./credentials.ts";
import { decidePermission } from "./policy.ts";
import { normalizeClaudeMessage } from "./events.ts";
import { logIgnored, WireFramer } from "./framing.mjs";
import { interruptRuntime, scrubbedEnv, spawnRuntime } from "./spawn-runtime.mjs";

function behaviorFor(policy, request) {
  const name = request?.tool_name;
  const input = request?.input ?? {};
  if (name === "Bash" || name === "shell") {
    return decidePermission(policy, {
      kind: "shell",
      tool: name,
      command: typeof input.command === "string" ? input.command : "",
    });
  }
  if (name === "WebFetch" || name === "WebSearch") {
    return decidePermission(policy, { kind: "web", tool: name });
  }
  const filePath = typeof input.file_path === "string" ? input.file_path : "";
  return decidePermission(policy, { kind: "edit", tool: name || "edit", path: filePath });
}

export async function runClaudeProbe(options) {
  try {
    assertClaudeLaunchArgs(options.args ?? []);
  } catch (error) {
    if (error instanceof ClaudeCredentialError) {
      return { ok: false, runtime: "claude", code: error.code, message: error.message, spawned: false };
    }
    throw error;
  }
  let apiKey = "";
  try {
    apiKey = resolveClaudeApiKey(options.apiKey, options.env ?? process.env);
  } catch (error) {
    if (error instanceof ClaudeCredentialError) {
      return { ok: false, runtime: "claude", code: error.code, message: error.message, spawned: false };
    }
    throw error;
  }
  for (const target of [options.command, ...(options.args ?? [])]) {
    if (typeof target === "string" && (target.includes("/") || target.includes("\\"))) {
      assertSafeProbePath(target);
    }
  }
  const timeoutMs = options.timeoutMs ?? 15000;
  const handle = await spawnRuntime({
    command: options.command,
    args: options.args ?? [],
    cwd: options.cwd,
    env: scrubbedEnv({
      EF_FAKE_SCENARIO: options.scenario ?? "conformance",
      ANTHROPIC_API_KEY: apiKey,
      ...(options.mcpCommand ? { EF_MCP_COMMAND: options.mcpCommand, EF_MCP_ARGS: JSON.stringify(options.mcpArgs ?? []) } : {}),
    }),
    job: options.job !== false,
  });
  if (handle.status !== "ok") {
    return { ok: false, runtime: "claude", code: "not_installed", command: options.command, spawned: false, detail: handle };
  }
  const framer = new WireFramer();
  const events = [];
  const ignored = [];
  const decisions = [];
  let stderr = "";
  handle.child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  const finished = new Promise((resolve, reject) => {
    const onData = (chunk) => {
      for (const message of framer.push(chunk)) {
        const event = normalizeClaudeMessage(message);
        events.push(event);
        if (event.type === "ignored") {
          ignored.push(event.method);
          logIgnored(event.method);
        }
        if (message?.type === "control_request") {
          const decision = behaviorFor(options.policy, message.request);
          decisions.push({
            id: message.request_id,
            tool: message.request?.tool_name ?? "tool",
            effect: decision.effect,
            rule: decision.rule,
          });
          handle.child.stdin.write(`${JSON.stringify({
            type: "control_response",
            response: {
              subtype: "success",
              request_id: message.request_id,
              response: { behavior: decision.effect === "allow" ? "allow" : "deny" },
            },
          })}\n`);
        }
        if (message?.type === "result") resolve(message);
      }
    };
    handle.child.stdout.on("data", onData);
    handle.child.once("exit", (code) => {
      framer.finish();
      if (code !== 0) {
        const error = new Error(`claude probe child exited ${code}`);
        error.code = "abrupt_exit";
        reject(error);
      }
    });
  });
  finished.catch(() => {});
  handle.child.stdin.write(`${JSON.stringify({
    type: "user",
    cwd: options.cwd,
    message: { role: "user", content: [{ type: "text", text: options.prompt ?? "Implement the brief." }] },
  })}\n`);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("probe timed out");
      error.code = "timeout";
      reject(error);
    }, timeoutMs);
  });
  try {
    await Promise.race([finished, timeout]);
    const assistant = events.find((event) => event.type === "message.delta");
    let summary = null;
    if (assistant && "text" in assistant && assistant.text.startsWith("{")) summary = JSON.parse(assistant.text);
    return {
      ok: true,
      runtime: "claude",
      pid: handle.child.pid,
      decisions,
      summary,
      events,
      ignored,
      diagnostics: framer.diagnostics,
      stderr,
      spawned: true,
    };
  } catch (error) {
    return {
      ok: false,
      runtime: "claude",
      pid: handle.child.pid,
      code: error && typeof error === "object" && "code" in error && error.code ? String(error.code) : "probe_failed",
      message: error instanceof Error ? error.message : String(error),
      decisions,
      events,
      ignored,
      diagnostics: framer.diagnostics,
      stderr,
      spawned: true,
    };
  } finally {
    clearTimeout(timer);
    await interruptRuntime(handle, options.killTimeoutMs ?? 400);
  }
}
