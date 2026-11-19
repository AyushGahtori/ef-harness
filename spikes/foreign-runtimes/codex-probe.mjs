import path from "node:path";
import { fileURLToPath } from "node:url";
import { commandFromUnknown, decidePermission, pathFromUnknown } from "./policy.ts";
import { ignoredEvent, normalizeCodexMessage, rateLimitFromCodex } from "./events.ts";
import { RpcPeer } from "./rpc-peer.mjs";
import { assertSafeProbePath } from "./credentials.ts";
import { interruptRuntime, scrubbedEnv, spawnRuntime } from "./spawn-runtime.mjs";

function rootDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}

export function harnessMcpServer(brief) {
  return {
    name: "harness",
    command: process.execPath,
    args: [path.join(rootDir(), "mini-mcp.mjs")],
    env: [{ name: "HARNESS_BRIEF_JSON", value: JSON.stringify(brief) }],
  };
}

function decisionForApproval(policy, method, params) {
  if (method === "item/commandExecution/requestApproval") {
    return decidePermission(policy, {
      kind: "shell",
      tool: "shell",
      command: commandFromUnknown(params) || (typeof params.command === "string" ? params.command : ""),
    });
  }
  return decidePermission(policy, {
    kind: "edit",
    tool: "edit",
    path: pathFromUnknown(params) || (typeof params.grantRoot === "string" ? params.grantRoot : ""),
  });
}

export async function runCodexProbe(options) {
  const timeoutMs = options.timeoutMs ?? 15000;
  for (const target of [options.command, ...(options.args ?? [])]) {
    if (typeof target === "string" && (target.includes("/") || target.includes("\\"))) {
      assertSafeProbePath(target);
    }
  }
  const handle = await spawnRuntime({
    command: options.command,
    args: options.args ?? [],
    cwd: options.cwd,
    env: scrubbedEnv({ EF_FAKE_SCENARIO: options.scenario ?? "conformance" }),
    job: options.job !== false,
  });
  if (handle.status !== "ok") {
    return { ok: false, code: "not_installed", command: options.command, detail: handle };
  }
  const peer = new RpcPeer(handle.child.stdout, handle.child.stdin, {
    style: "codex",
    chunked: options.scenario === "chunked",
  });
  const events = [];
  const ignored = [];
  const decisions = [];
  peer.onMessage = async (message) => {
    const event = normalizeCodexMessage(message);
    if (event.type === "ignored" && event.method !== "response") {
      ignored.push(event.method);
      events.push(event);
      return ignoredEvent("codex", event.method);
    }
    if (event.type !== "ignored") events.push(event);
    if (message.id === undefined || typeof message.method !== "string") return event;
    if (!message.method.endsWith("requestApproval")) {
      peer.fail(message.id, -32601, "unsupported server request");
      return event;
    }
    const decision = decisionForApproval(options.policy, message.method, message.params ?? {});
    decisions.push({
      method: message.method,
      effect: decision.effect,
      rule: decision.rule,
      threadId: message.params?.threadId ?? null,
    });
    peer.respond(message.id, { decision: decision.effect === "allow" ? "accept" : "decline" });
    return event;
  };
  const work = (async () => {
    const initialized = await peer.request("initialize", {
      clientInfo: { name: "ef-harness-spike", version: "0.0.0" },
    });
    peer.notify("initialized", {});
    const first = await peer.request("thread/start", { model: "fake", cwd: options.cwd });
    const second = options.multiplex === false
      ? null
      : await peer.request("thread/start", { model: "fake", cwd: options.cwd });
    const resumed = await peer.request("thread/resume", { threadId: first.thread.id });
    const limits = await peer.request("account/rateLimits/read", {});
    events.push(rateLimitFromCodex(limits));
    let turn = null;
    if (options.turn !== false) {
      turn = await peer.request("turn/start", {
        threadId: first.thread.id,
        cwd: options.cwd,
        mcpServers: options.mcpServers ?? [],
        input: [{ type: "text", text: options.prompt ?? "Implement the brief." }],
      });
    }
    return { initialized, first, second, resumed, limits, turn };
  })();
  work.catch(() => {});
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("probe timed out");
      error.code = "timeout";
      reject(error);
    }, timeoutMs);
  });
  try {
    const value = await Promise.race([work, timeout]);
    const threads = [value.first.thread.id, value.second?.thread?.id].filter(Boolean);
    return {
      ok: true,
      runtime: "codex",
      pid: handle.child.pid,
      userAgent: value.initialized.userAgent ?? null,
      capabilities: value.initialized.capabilities ?? {},
      threads,
      multiplexes: new Set(threads).size > 1,
      resumed: value.resumed.thread.id,
      rateLimit: rateLimitFromCodex(value.limits),
      decisions,
      turn: value.turn,
      events,
      ignored,
      diagnostics: peer.framer.diagnostics,
    };
  } catch (error) {
    return {
      ok: false,
      runtime: "codex",
      pid: handle.child.pid,
      code: error && typeof error === "object" && "code" in error && error.code ? String(error.code) : "probe_failed",
      message: error instanceof Error ? error.message : String(error),
      decisions,
      events,
      ignored,
      diagnostics: peer.framer.diagnostics,
    };
  } finally {
    clearTimeout(timer);
    await interruptRuntime(handle, options.killTimeoutMs ?? 400);
  }
}
