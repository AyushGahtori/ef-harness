import { asArray, asFiniteNumber, asRecord, asString, textContent } from "./records.js";
import { exitDisposition, type RuntimeEventDraft } from "./runtime-event.js";
import type { SupervisionRequest, WorkerErrorKind, WorkerToolKind } from "./types.js";
import { isWorkerErrorKind, isWorkerToolKind } from "./types.js";
import { normalizeUsage } from "./usage.js";

export type ForeignRawEvent =
  | { readonly source: "acp"; readonly method: string; readonly params?: unknown }
  | { readonly source: "codex"; readonly method: string; readonly params?: unknown }
  | { readonly source: "claude"; readonly event: unknown }
  | { readonly source: "copilot"; readonly event: unknown }
  | { readonly source: "cursor"; readonly event: unknown }
  | { readonly source: "worker"; readonly event: unknown };

export interface Translation {
  readonly drafts: readonly RuntimeEventDraft[];
  readonly ignored: number;
}

export function translateForeignEvent(raw: ForeignRawEvent): Translation {
  switch (raw.source) {
    case "acp":
      return translateAcp(raw.method, raw.params);
    case "codex":
      return translateCodex(raw.method, raw.params);
    case "claude":
      return translateClaude(raw.event);
    case "copilot":
    case "cursor":
      return translateSdk(raw.event);
    case "worker":
      return translateWorker(raw.event);
    default:
      return { drafts: [], ignored: 1 };
  }
}

function translateAcp(method: string, params: unknown): Translation {
  if (method === "session/request_permission") return permissionFromParams(params);
  if (method !== "session/update") return { drafts: [], ignored: 1 };
  const root = asRecord(params);
  const update = asRecord(root?.update) ?? root;
  const kind = asString(update?.sessionUpdate) ?? "";
  if (kind === "agent_message_chunk") {
    return one(delta(textContent(update?.content ?? update), "message"));
  }
  if (kind === "agent_thought_chunk") {
    return one(delta(textContent(update?.content ?? update), "thought"));
  }
  if (kind === "tool_call" || kind === "tool_call_update") return one(acpTool(update));
  if (kind === "plan") return one(planDraft(update));
  if (kind === "usage_update") return one({ type: "usage_reported", usage: normalizeUsage(update) });
  return { drafts: [], ignored: 1 };
}

function translateCodex(method: string, params: unknown): Translation {
  const record = asRecord(params) ?? {};
  if (method === "turn/start") return one({ type: "turn_started", turnId: asString(record.turnId) ?? "turn" });
  if (method === "item/agentMessage/delta") return one(delta(textContent(record), "message"));
  if (method === "item/commandExecution/requestApproval") {
    return one({
      type: "permission_requested",
      requestId: asString(record.requestId) ?? "approval",
      request: { kind: "shell", command: asString(record.command) ?? "" },
    });
  }
  if (method === "item/fileChange/requestApproval") {
    return one({
      type: "permission_requested",
      requestId: asString(record.requestId) ?? "approval",
      request: { kind: "edit", path: asString(record.path) ?? asString(record.file) ?? "" },
    });
  }
  if (method === "item/commandExecution") return one(codexCommand(record));
  if (method === "item/fileChange/completed" || method === "item/fileChange/delta") {
    const file = asString(record.path) ?? asString(record.file);
    return file ? one({ type: "file_edited", paths: [file] }) : { drafts: [], ignored: 1 };
  }
  if (method === "thread/tokenUsage/updated" || method === "usage") {
    return one({ type: "usage_reported", usage: normalizeUsage(record.usage ?? record) });
  }
  if (method === "account/rateLimits/updated" || method === "account/rateLimits/read") {
    return one(rateLimitDraft(record));
  }
  if (method === "turn/completed") {
    return one({ type: "turn_completed", stopReason: asString(record.stopReason) ?? "end_turn" });
  }
  if (method === "error") {
    return one({
      type: "session_error",
      errorKind: errorKind(record.kind ?? record.type),
      message: asString(record.message) ?? "codex error",
    });
  }
  if (method === "exit") return one(exitDraft(record.exitCode));
  return { drafts: [], ignored: 1 };
}

function translateClaude(event: unknown): Translation {
  const record = asRecord(event);
  if (!record) return { drafts: [], ignored: 1 };
  const type = asString(record.type) ?? "";
  if (type === "system") return { drafts: [], ignored: 1 };
  if (type === "assistant") return { drafts: claudeContent(record), ignored: 0 };
  if (type === "user") {
    const finished = claudeToolResults(record);
    return finished.length > 0 ? { drafts: finished, ignored: 0 } : { drafts: [], ignored: 1 };
  }
  if (type === "result") {
    return {
      drafts: [
        { type: "usage_reported", usage: normalizeUsage(record) },
        { type: "turn_completed", stopReason: asString(record.stop_reason) ?? "end_turn" },
      ],
      ignored: 0,
    };
  }
  if (type === "error") {
    const nested = asRecord(record.error);
    return one({
      type: "session_error",
      errorKind: errorKind(nested?.type ?? record.kind),
      message: asString(nested?.message) ?? asString(record.message) ?? "claude error",
    });
  }
  return { drafts: [], ignored: 1 };
}

function translateSdk(event: unknown): Translation {
  const record = asRecord(event);
  if (!record) return { drafts: [], ignored: 1 };
  const type = asString(record.type) ?? "";
  if (type === "text_delta" || type === "message_delta") return one(delta(textContent(record), "message"));
  if (type === "permission_request" || type === "onPermissionRequest") return permissionFromParams(record);
  if (type === "tool_start" || type === "tool_end") return one(sdkTool(record, type === "tool_end"));
  if (type === "file_edit") {
    const paths = stringList(record.paths ?? record.path);
    return paths.length > 0 ? one({ type: "file_edited", paths }) : { drafts: [], ignored: 1 };
  }
  if (type === "usage") return one({ type: "usage_reported", usage: normalizeUsage(record.metrics ?? record.usage ?? record) });
  if (type === "rate_limit") return one(rateLimitDraft(record));
  if (type === "turn_complete" || type === "turn_completed") {
    return one({ type: "turn_completed", stopReason: asString(record.stopReason) ?? "end_turn" });
  }
  if (type === "error") {
    return one({
      type: "session_error",
      errorKind: errorKind(record.kind),
      message: asString(record.message) ?? "runtime error",
    });
  }
  if (type === "exit") return one(exitDraft(record.exitCode));
  if (type === "turn_started") return one({ type: "turn_started", turnId: asString(record.turnId) ?? "turn" });
  return { drafts: [], ignored: 1 };
}

function translateWorker(event: unknown): Translation {
  const record = asRecord(event);
  if (!record) return { drafts: [], ignored: 1 };
  const type = asString(record.type) ?? "";
  if (type === "turn.started") return one({ type: "turn_started", turnId: asString(record.turnId) ?? "turn" });
  if (type === "message.delta") return one(delta(textContent(record), "message"));
  if (type === "plan.updated") return one(planDraft(record));
  if (type === "tool.requested") {
    return one({
      type: "tool_call_requested",
      callId: asString(record.callId) ?? "tool",
      toolKind: toolKind(record.kind),
      title: asString(record.title) ?? asString(record.name) ?? "tool",
    });
  }
  if (type === "tool.completed") {
    return one({
      type: "tool_call_finished",
      callId: asString(record.callId) ?? "tool",
      toolKind: toolKind(record.kind),
      title: asString(record.title) ?? "tool",
      exitCode: exitCode(record.exitCode),
    });
  }
  if (type === "file.changed") {
    const paths = stringList(record.paths ?? record.path);
    return paths.length > 0 ? one({ type: "file_edited", paths }) : { drafts: [], ignored: 1 };
  }
  if (type === "permission.requested") return permissionFromParams(record);
  if (type === "usage") return one({ type: "usage_reported", usage: normalizeUsage(record.usage ?? record) });
  if (type === "rate_limit") return one(rateLimitDraft(record));
  if (type === "turn.completed") {
    return one({ type: "turn_completed", stopReason: asString(record.stopReason) ?? "end_turn" });
  }
  if (type === "error") {
    return one({
      type: "session_error",
      errorKind: errorKind(record.kind),
      message: asString(record.message) ?? "worker error",
    });
  }
  if (type === "session.ended" || type === "session.exited") return one(exitDraft(record.exitCode));
  return { drafts: [], ignored: 1 };
}

function one(draft: RuntimeEventDraft | null): Translation {
  if (!draft) return { drafts: [], ignored: 1 };
  return { drafts: [draft], ignored: 0 };
}

function delta(text: string, channel: "message" | "thought" | "plan"): RuntimeEventDraft {
  return { type: "assistant_delta", text, channel };
}

function planDraft(record: Readonly<Record<string, unknown>> | null): RuntimeEventDraft {
  const entries = asArray(record?.entries ?? record?.steps);
  const steps = entries
    .map((entry) => {
      if (typeof entry === "string") return entry;
      const item = asRecord(entry);
      return asString(item?.content) ?? asString(item?.title) ?? asString(item?.step) ?? "";
    })
    .filter((step) => step.length > 0);
  return { type: "assistant_delta", text: steps.join("\n"), channel: "plan", steps };
}

function acpTool(update: Readonly<Record<string, unknown>> | null): RuntimeEventDraft | null {
  if (!update) return null;
  const status = (asString(update.status) ?? "pending").toLowerCase();
  const callId = asString(update.toolCallId) ?? asString(update.id) ?? "tool";
  const kind = toolKind(update.kind ?? update.toolKind);
  const title = asString(update.title) ?? asString(update.name) ?? kind;
  if (status === "completed" || status === "failed" || status === "finished") {
    return { type: "tool_call_finished", callId, toolKind: kind, title, exitCode: exitCode(update.exitCode) };
  }
  if (status === "in_progress" || status === "running" || status === "started") {
    return { type: "tool_call_started", callId, toolKind: kind, title };
  }
  return { type: "tool_call_requested", callId, toolKind: kind, title };
}

function codexCommand(record: Readonly<Record<string, unknown>>): RuntimeEventDraft {
  const status = (asString(record.status) ?? "").toLowerCase();
  const callId = asString(record.id) ?? asString(record.itemId) ?? "command";
  const title = asString(record.command) ?? "command";
  if (status === "completed" || status === "failed") {
    return { type: "tool_call_finished", callId, toolKind: "shell", title, exitCode: exitCode(record.exitCode) };
  }
  return { type: "tool_call_started", callId, toolKind: "shell", title };
}

function sdkTool(record: Readonly<Record<string, unknown>>, finished: boolean): RuntimeEventDraft {
  const callId = asString(record.callId) ?? "tool";
  const kind = toolKind(record.kind);
  const title = asString(record.title) ?? asString(record.command) ?? kind;
  if (finished) {
    return { type: "tool_call_finished", callId, toolKind: kind, title, exitCode: exitCode(record.exitCode) };
  }
  return { type: "tool_call_started", callId, toolKind: kind, title };
}

function claudeContent(record: Readonly<Record<string, unknown>>): RuntimeEventDraft[] {
  const message = asRecord(record.message) ?? record;
  const drafts: RuntimeEventDraft[] = [];
  for (const block of asArray(message.content)) {
    const item = asRecord(block);
    if (!item) continue;
    const type = asString(item.type) ?? "";
    if (type === "text") drafts.push(delta(asString(item.text) ?? "", "message"));
    if (type === "tool_use") {
      drafts.push({
        type: "tool_call_requested",
        callId: asString(item.id) ?? "tool",
        toolKind: toolKind(item.name),
        title: asString(item.name) ?? "tool",
      });
    }
  }
  return drafts;
}

function claudeToolResults(record: Readonly<Record<string, unknown>>): RuntimeEventDraft[] {
  const message = asRecord(record.message) ?? record;
  const drafts: RuntimeEventDraft[] = [];
  for (const block of asArray(message.content)) {
    const item = asRecord(block);
    if (!item || asString(item.type) !== "tool_result") continue;
    drafts.push({
      type: "tool_call_finished",
      callId: asString(item.tool_use_id) ?? "tool",
      toolKind: "read",
      title: "tool_result",
      exitCode: item.is_error === true ? 1 : 0,
    });
  }
  return drafts;
}

function permissionFromParams(params: unknown): Translation {
  const record = asRecord(params);
  if (!record) return { drafts: [], ignored: 1 };
  const requestId =
    asString(record.requestId) ?? asString(record.id) ?? asString(record.toolCallId) ?? "permission";
  const tool = asRecord(record.toolCall) ?? asRecord(record.tool) ?? record;
  const request = supervisionRequest(tool);
  if (!request) return { drafts: [], ignored: 1 };
  return one({ type: "permission_requested", requestId, request });
}

function supervisionRequest(record: Readonly<Record<string, unknown>>): SupervisionRequest | null {
  const kind = (asString(record.kind) ?? asString(record.toolKind) ?? "").toLowerCase();
  const path = asString(record.path) ?? asString(record.file);
  const command = asString(record.command);
  const tool = asString(record.tool) ?? asString(record.name);
  if (kind === "shell" || command) return { kind: "shell", command: command ?? "" };
  if (kind === "web" || kind === "fetch" || kind === "search") {
    const url = asString(record.url);
    return url ? { kind: "web", tool: tool ?? kind, url } : { kind: "web", tool: tool ?? kind };
  }
  if (kind === "mcp" && tool) return { kind: "mcp", tool };
  if (kind === "read" && path) return { kind: "read", path };
  if (path && (kind === "write" || kind === "edit" || kind === "delete")) {
    return { kind, path };
  }
  if (path) return { kind: "edit", path };
  return null;
}

function rateLimitDraft(record: Readonly<Record<string, unknown>>): RuntimeEventDraft {
  const primary = asRecord(record.primary) ?? asRecord(asRecord(record.rateLimits)?.primary) ?? record;
  const used = asFiniteNumber(primary.usedPercent ?? record.usedPercent);
  const resets = primary.resetsAt ?? record.resetsAt;
  return {
    type: "rate_limited",
    usedPercent: used,
    resetsAt: resetsAt(resets),
    window: asString(record.window) ?? "primary",
  };
}

function exitDraft(code: unknown): RuntimeEventDraft {
  const exitCodeValue = exitCode(code);
  const disposition = exitDisposition(exitCodeValue);
  return {
    type: "session_exited",
    disposition,
    exitCode: exitCodeValue,
    handoff: disposition === "abnormal" ? "Task 150" : null,
  };
}

function toolKind(value: unknown): WorkerToolKind {
  const kind = (asString(value) ?? "").toLowerCase();
  if (isWorkerToolKind(kind)) return kind;
  if (kind.includes("shell") || kind === "execute" || kind === "bash" || kind === "command") return "shell";
  if (kind.includes("edit") || kind === "write" || kind === "delete") return "edit";
  if (kind.includes("search") || kind === "grep") return "search";
  if (kind.includes("web") || kind === "fetch") return "web";
  if (kind.includes("mcp")) return "mcp";
  return "read";
}

function errorKind(value: unknown): WorkerErrorKind {
  const kind = asString(value) ?? "";
  return isWorkerErrorKind(kind) ? kind : "other";
}

function exitCode(value: unknown): number | null {
  const numeric = asFiniteNumber(value);
  if (numeric === null) return null;
  return Math.trunc(numeric);
}

function resetsAt(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  const numeric = asFiniteNumber(value);
  if (numeric === null) return null;
  const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  return new Date(millis).toISOString();
}

function stringList(value: unknown): string[] {
  if (typeof value === "string" && value.length > 0) return [value];
  return asArray(value).filter((item): item is string => typeof item === "string" && item.length > 0);
}
