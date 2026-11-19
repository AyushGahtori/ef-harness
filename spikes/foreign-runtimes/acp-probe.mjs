import path from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { client, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { assertSafeProbePath } from "./credentials.ts";
import { ignoredEvent, normalizeAcpUpdate } from "./events.ts";
import { logIgnored, WireFramer } from "./framing.mjs";
import { commandFromUnknown, decidePermission, pathFromUnknown } from "./policy.ts";
import { interruptRuntime, scrubbedEnv, spawnRuntime } from "./spawn-runtime.mjs";

function probeRoot() {
  return path.dirname(fileURLToPath(import.meta.url));
}

function queryFromToolCall(toolCall) {
  const kind = toolCall?.kind;
  const raw = toolCall?.rawInput;
  const location = toolCall?.locations?.[0]?.path;
  if (kind === "execute") {
    return {
      kind: "shell",
      tool: toolCall?.title || "shell",
      command: commandFromUnknown(raw) || toolCall?.title || "",
    };
  }
  if (kind === "edit" || kind === "delete" || kind === "move") {
    return { kind: "edit", tool: toolCall?.title || "edit", path: location || pathFromUnknown(raw) };
  }
  if (kind === "fetch") return { kind: "web", tool: "web" };
  if (kind === "read" || kind === "search") {
    return { kind: kind, tool: kind, path: location || pathFromUnknown(raw) };
  }
  return { kind: "other", tool: toolCall?.title || "other" };
}

function selectOption(options, effect) {
  const primary = effect === "allow" ? "allow_once" : "reject_once";
  const secondary = effect === "allow" ? "allow_always" : "reject_always";
  return options.find((option) => option.kind === primary) ?? options.find((option) => option.kind === secondary) ?? null;
}

function summaryFromUpdates(updates) {
  for (let index = updates.length - 1; index >= 0; index -= 1) {
    const update = updates[index]?.update;
    if (update?.sessionUpdate !== "agent_message_chunk") continue;
    const text = update.content?.text ?? "";
    if (text.startsWith("{")) return JSON.parse(text);
  }
  return null;
}

function pipeSanitized(stdout) {
  const clean = new PassThrough();
  const framer = new WireFramer();
  stdout.on("data", (chunk) => {
    for (const message of framer.push(chunk)) {
      clean.write(`${JSON.stringify(message)}\n`);
    }
  });
  stdout.on("end", () => {
    framer.finish();
    clean.end();
  });
  stdout.on("error", (error) => clean.destroy(error));
  return { clean, framer };
}

export function harnessMcpServer(brief) {
  return {
    name: "harness",
    command: process.execPath,
    args: [path.join(probeRoot(), "mini-mcp.mjs")],
    env: [{ name: "HARNESS_BRIEF_JSON", value: JSON.stringify(brief) }],
  };
}

export async function runAcpProbe(options) {
  const timeoutMs = options.timeoutMs ?? 15000;
  const policy = options.policy;
  for (const target of [options.command, ...(options.args ?? [])]) {
    if (typeof target === "string" && (target.includes("/") || target.includes("\\"))) {
      assertSafeProbePath(target);
    }
  }
  const handle = await spawnRuntime({
    command: options.command,
    args: options.args ?? [],
    cwd: options.cwd,
    env: scrubbedEnv({ EF_FAKE_SCENARIO: options.scenario ?? "conformance", ...(options.env ?? {}) }),
    job: options.job !== false,
  });
  if (handle.status !== "ok") {
    return { ok: false, code: "not_installed", command: options.command, detail: handle };
  }
  const decisions = [];
  const updates = [];
  const ignored = [];
  const events = [];
  const { clean, framer } = pipeSanitized(handle.child.stdout);
  let stderr = "";
  handle.child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  const app = client({ name: "ef-harness-spike" });
  app.onRequest("session/request_permission", async (ctx) => {
    const params = ctx.params;
    const query = queryFromToolCall(params.toolCall);
    const decision = decidePermission(policy, query);
    decisions.push({ tool: query.tool, kind: query.kind, effect: decision.effect, rule: decision.rule });
    events.push({
      type: "permission.requested",
      runtime: options.runtime,
      id: params.toolCall?.toolCallId ?? "",
      tool: query.tool,
      args: params.toolCall?.rawInput ?? {},
    });
    const option = selectOption(params.options ?? [], decision.effect);
    if (!option) return { outcome: { outcome: "cancelled" } };
    return { outcome: { outcome: "selected", optionId: option.optionId } };
  });
  app.onNotification("session/update", (ctx) => {
    updates.push(ctx.params);
    const event = normalizeAcpUpdate(options.runtime, ctx.params?.update);
    events.push(event);
    if (event.type === "ignored") {
      ignored.push(event.method);
      logIgnored(event.method);
    }
  });
  app.onNotification("*", (ctx) => {
    const method = ctx.method ?? "unknown";
    if (method === "session/update" || method === "session/request_permission") return;
    ignored.push(method);
    events.push(ignoredEvent(options.runtime, method));
    logIgnored(method);
  });
  const stream = ndJsonStream(Writable.toWeb(handle.child.stdin), Readable.toWeb(clean));
  const work = app.connectWith(stream, async (agent) => {
    const initialized = await agent.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: "ef-harness-spike", version: "0.0.0" },
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    });
    events.push({ type: "session.started", runtime: options.runtime, sessionId: "" });
    const created = await agent.request("session/new", {
      cwd: options.cwd,
      mcpServers: options.mcpServers ?? [],
    });
    events[0] = { type: "session.started", runtime: options.runtime, sessionId: created.sessionId };
    const prompted = await agent.request("session/prompt", {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: options.prompt ?? "Implement the brief inside the write scope." }],
    });
    events.push({ type: "turn.completed", runtime: options.runtime, stopReason: prompted.stopReason });
    if (options.cancel !== false) {
      await agent.notify("session/cancel", { sessionId: created.sessionId });
    }
    return { initialized, created, prompted };
  });
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
    return {
      ok: true,
      runtime: options.runtime,
      pid: handle.child.pid,
      sessionId: value.created.sessionId,
      stopReason: value.prompted.stopReason,
      authMethods: value.initialized.authMethods ?? [],
      decisions,
      summary: summaryFromUpdates(updates),
      events,
      ignored,
      diagnostics: framer.diagnostics,
      stderr,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let code = error && typeof error === "object" && "code" in error && error.code ? String(error.code) : "probe_failed";
    const truncated = framer.diagnostics.some((item) => item.kind === "truncated");
    if (code === "probe_failed" && (truncated || /connection closed/i.test(message))) {
      code = "abrupt_exit";
    }
    return {
      ok: false,
      runtime: options.runtime,
      pid: handle.child.pid,
      code,
      message,
      decisions,
      events,
      ignored,
      diagnostics: framer.diagnostics,
      stderr,
    };
  } finally {
    clearTimeout(timer);
    await interruptRuntime(handle, options.killTimeoutMs ?? 400);
  }
}
