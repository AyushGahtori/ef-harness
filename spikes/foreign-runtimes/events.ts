export type RuntimeName = "acp" | "codex" | "copilot" | "claude" | "gemini" | "opencode";

export type ErrorKind =
  | "auth"
  | "rate_limit"
  | "usage_limit"
  | "billing"
  | "overloaded"
  | "context_overflow"
  | "abrupt_exit"
  | "malformed"
  | "other";

export type NormalizedEvent =
  | { readonly type: "session.started"; readonly runtime: RuntimeName; readonly sessionId: string }
  | { readonly type: "session.ended"; readonly runtime: RuntimeName; readonly sessionId: string }
  | { readonly type: "turn.started"; readonly runtime: RuntimeName; readonly turnId: string }
  | { readonly type: "turn.completed"; readonly runtime: RuntimeName; readonly stopReason: string }
  | { readonly type: "plan.updated"; readonly runtime: RuntimeName; readonly steps: readonly string[] }
  | {
      readonly type: "tool.requested";
      readonly runtime: RuntimeName;
      readonly kind: string;
      readonly args: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: "permission.requested";
      readonly runtime: RuntimeName;
      readonly id: string;
      readonly tool: string;
      readonly args: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: "tool.completed";
      readonly runtime: RuntimeName;
      readonly result: string;
      readonly exitCode: number | null;
    }
  | { readonly type: "file.changed"; readonly runtime: RuntimeName; readonly paths: readonly string[] }
  | { readonly type: "input.requested"; readonly runtime: RuntimeName; readonly question: string }
  | { readonly type: "subagent.started"; readonly runtime: RuntimeName; readonly id: string }
  | { readonly type: "subagent.stopped"; readonly runtime: RuntimeName; readonly id: string }
  | {
      readonly type: "usage";
      readonly runtime: RuntimeName;
      readonly tokens: number | null;
      readonly cost: number | null;
    }
  | {
      readonly type: "rate_limit";
      readonly runtime: RuntimeName;
      readonly status: string;
      readonly resetsAt: string | null;
      readonly usedPercent: number | null;
    }
  | { readonly type: "error"; readonly runtime: RuntimeName; readonly kind: ErrorKind; readonly message: string }
  | { readonly type: "message.delta"; readonly runtime: RuntimeName; readonly text: string }
  | { readonly type: "ignored"; readonly runtime: RuntimeName; readonly method: string };

export function ignoredEvent(runtime: RuntimeName, method: string): NormalizedEvent {
  return { type: "ignored", runtime, method };
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textOf(value: unknown): string {
  const item = record(value);
  if (!item) return "";
  return typeof item.text === "string" ? item.text : "";
}

export function normalizeAcpUpdate(runtime: RuntimeName, update: unknown): NormalizedEvent {
  const body = record(update);
  const sessionUpdate = typeof body?.sessionUpdate === "string" ? body.sessionUpdate : "";
  if (sessionUpdate === "agent_message_chunk" || sessionUpdate === "agent_thought_chunk") {
    return { type: "message.delta", runtime, text: textOf(body?.content) };
  }
  if (sessionUpdate === "user_message_chunk") {
    return { type: "message.delta", runtime, text: textOf(body?.content) };
  }
  if (sessionUpdate === "tool_call" || sessionUpdate === "tool_call_update") {
    const kind = typeof body?.kind === "string" ? body.kind : "other";
    const args = record(body?.rawInput) ?? {};
    return { type: "tool.requested", runtime, kind, args };
  }
  if (sessionUpdate === "plan") {
    const entries = Array.isArray(body?.entries) ? body.entries : [];
    const steps = entries.map((entry) => {
      const row = record(entry);
      return typeof row?.content === "string" ? row.content : "";
    });
    return { type: "plan.updated", runtime, steps };
  }
  if (sessionUpdate === "usage_update") {
    const used = typeof body?.used === "number" ? body.used : null;
    const cost = typeof body?.cost === "number" ? body.cost : null;
    const size = record(body?.size);
    const tokens = typeof size?.inputTokens === "number" ? size.inputTokens : used;
    return { type: "usage", runtime, tokens, cost };
  }
  return ignoredEvent(runtime, sessionUpdate || "session/update");
}

export function normalizeCodexMessage(message: unknown): NormalizedEvent {
  const body = record(message);
  const method = typeof body?.method === "string" ? body.method : "";
  const params = record(body?.params) ?? {};
  if (method === "thread/started") {
    const thread = record(params.thread);
    const sessionId = typeof thread?.id === "string" ? thread.id : "";
    return { type: "session.started", runtime: "codex", sessionId };
  }
  if (method === "turn/started") {
    const turn = record(params.turn);
    const turnId = typeof turn?.id === "string" ? turn.id : "";
    return { type: "turn.started", runtime: "codex", turnId };
  }
  if (method === "turn/completed") {
    const turn = record(params.turn);
    const stopReason = typeof turn?.status === "string" ? turn.status : "end_turn";
    return { type: "turn.completed", runtime: "codex", stopReason };
  }
  if (method === "item/commandExecution/requestApproval") {
    return {
      type: "permission.requested",
      runtime: "codex",
      id: typeof params.itemId === "string" ? params.itemId : "",
      tool: "shell",
      args: params,
    };
  }
  if (method === "item/fileChange/requestApproval" || method === "item/permissions/requestApproval") {
    return {
      type: "permission.requested",
      runtime: "codex",
      id: typeof params.itemId === "string" ? params.itemId : "",
      tool: "edit",
      args: params,
    };
  }
  if (method === "error") {
    return {
      type: "error",
      runtime: "codex",
      kind: "other",
      message: typeof params.message === "string" ? params.message : method,
    };
  }
  if (!method) {
    return ignoredEvent("codex", "response");
  }
  return ignoredEvent("codex", method);
}

export function normalizeClaudeMessage(message: unknown): NormalizedEvent {
  const body = record(message);
  const type = typeof body?.type === "string" ? body.type : "";
  if (type === "system" && body?.subtype === "init") {
    const sessionId = typeof body.session_id === "string" ? body.session_id : "";
    return { type: "session.started", runtime: "claude", sessionId };
  }
  if (type === "assistant") {
    const messageBody = record(body.message);
    const content = Array.isArray(messageBody?.content) ? messageBody.content : [];
    const text = content
      .map((block) => textOf(block))
      .filter((part) => part.length > 0)
      .join("");
    return { type: "message.delta", runtime: "claude", text };
  }
  if (type === "control_request") {
    const request = record(body.request);
    const requestId = typeof body.request_id === "string" ? body.request_id : "";
    const tool = typeof request?.tool_name === "string" ? request.tool_name : "tool";
    const args = record(request?.input) ?? {};
    return { type: "permission.requested", runtime: "claude", id: requestId, tool, args };
  }
  if (type === "result") {
    const usage = record(body.usage);
    const input = typeof usage?.input_tokens === "number" ? usage.input_tokens : 0;
    const output = typeof usage?.output_tokens === "number" ? usage.output_tokens : 0;
    const cost = typeof body.total_cost_usd === "number" ? body.total_cost_usd : null;
    return { type: "usage", runtime: "claude", tokens: input + output, cost };
  }
  if (type === "rate_limit_event") {
    const info = record(body.rate_limit_info);
    const used = typeof info?.used_percentage === "number" ? info.used_percentage : null;
    const status = typeof body.status === "string" ? body.status : "rate_limit";
    return { type: "rate_limit", runtime: "claude", status, resetsAt: null, usedPercent: used };
  }
  if (!type) return ignoredEvent("claude", "empty");
  return ignoredEvent("claude", type);
}

export function rateLimitFromCodex(result: unknown): NormalizedEvent {
  const body = record(result);
  const limits = record(body?.rateLimits);
  const primary = record(limits?.primary) ?? record(body?.rateLimits);
  const used = typeof primary?.usedPercent === "number" ? primary.usedPercent : null;
  const resets = primary?.resetsAt;
  const resetsAt = typeof resets === "string" || typeof resets === "number" ? String(resets) : null;
  return {
    type: "rate_limit",
    runtime: "codex",
    status: used === null ? "unknown" : "ok",
    resetsAt,
    usedPercent: used,
  };
}
