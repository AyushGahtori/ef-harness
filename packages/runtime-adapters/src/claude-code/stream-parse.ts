import { isRecord, numberField, stringField } from "./records.js";
import type { ClaudeTokenUsage } from "./types.js";

export interface ParsedToolUse {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export type ParsedClaudeLine =
  | { readonly kind: "init"; readonly sessionId: string }
  | {
      readonly kind: "assistant";
      readonly texts: readonly string[];
      readonly toolUses: readonly ParsedToolUse[];
      readonly usage: ClaudeTokenUsage | null;
    }
  | { readonly kind: "tool_result"; readonly toolUseId: string; readonly text: string }
  | {
      readonly kind: "result";
      readonly subtype: string;
      readonly sessionId: string;
      readonly usage: ClaudeTokenUsage;
      readonly totalCostUsd: string | null;
      readonly isError: boolean;
    }
  | {
      readonly kind: "permission";
      readonly requestId: string;
      readonly toolName: string;
      readonly input: Record<string, unknown>;
      readonly toolUseId: string;
    }
  | { readonly kind: "rate_limit" }
  | { readonly kind: "ignore" };

export function parseClaudeLine(line: string): ParsedClaudeLine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    return { kind: "ignore", ...(error ? {} : {}) };
  }
  if (!isRecord(parsed)) return { kind: "ignore" };
  const type = stringField(parsed, "type");
  if (type === "system" && stringField(parsed, "subtype") === "init") {
    return { kind: "init", sessionId: stringField(parsed, "session_id") ?? "" };
  }
  if (type === "assistant") return parseAssistant(parsed);
  if (type === "user") return parseUser(parsed);
  if (type === "result") return parseResult(parsed, line);
  if (type === "control_request") return parseControl(parsed);
  if (type === "rate_limit_event") return { kind: "rate_limit" };
  return { kind: "ignore" };
}

export function emptyUsage(): ClaudeTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
}

function parseAssistant(parsed: Record<string, unknown>): ParsedClaudeLine {
  const message = isRecord(parsed.message) ? parsed.message : {};
  const content = Array.isArray(message.content) ? message.content : [];
  const texts: string[] = [];
  const toolUses: ParsedToolUse[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    const blockType = stringField(block, "type");
    if (blockType === "text") {
      const text = stringField(block, "text");
      if (text) texts.push(text);
    } else if (blockType === "tool_use") {
      toolUses.push({
        id: stringField(block, "id") ?? "",
        name: stringField(block, "name") ?? "",
        input: isRecord(block.input) ? block.input : {},
      });
    }
  }
  const usage = parseUsage(message.usage);
  return { kind: "assistant", texts, toolUses, usage };
}

function parseUser(parsed: Record<string, unknown>): ParsedClaudeLine {
  const message = isRecord(parsed.message) ? parsed.message : {};
  const content = Array.isArray(message.content) ? message.content : [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (stringField(block, "type") !== "tool_result") continue;
    const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
    return { kind: "tool_result", toolUseId: stringField(block, "tool_use_id") ?? "", text };
  }
  return { kind: "ignore" };
}

function parseResult(parsed: Record<string, unknown>, line: string): ParsedClaudeLine {
  return {
    kind: "result",
    subtype: stringField(parsed, "subtype") ?? "success",
    sessionId: stringField(parsed, "session_id") ?? "",
    usage: parseUsage(parsed.usage) ?? emptyUsage(),
    totalCostUsd: extractCost(line, parsed),
    isError: parsed.is_error === true || (stringField(parsed, "subtype") ?? "success") !== "success",
  };
}

function parseControl(parsed: Record<string, unknown>): ParsedClaudeLine {
  const request = isRecord(parsed.request) ? parsed.request : null;
  if (!request || stringField(request, "subtype") !== "can_use_tool") return { kind: "ignore" };
  return {
    kind: "permission",
    requestId: stringField(parsed, "request_id") ?? "",
    toolName: stringField(request, "tool_name") ?? "",
    input: isRecord(request.input) ? request.input : {},
    toolUseId: stringField(request, "tool_use_id") ?? "",
  };
}

function parseUsage(value: unknown): ClaudeTokenUsage | null {
  if (!isRecord(value)) return null;
  return {
    inputTokens: nonNegative(numberField(value, "input_tokens")),
    outputTokens: nonNegative(numberField(value, "output_tokens")),
    cacheReadInputTokens: nonNegative(numberField(value, "cache_read_input_tokens")),
    cacheCreationInputTokens: nonNegative(numberField(value, "cache_creation_input_tokens")),
  };
}

function nonNegative(value: number | null): number {
  if (value === null || value < 0) return 0;
  return Math.floor(value);
}

function extractCost(line: string, parsed: Record<string, unknown>): string | null {
  const match = /"total_cost_usd"\s*:\s*"?(\d+(?:\.\d+)?)"?/.exec(line);
  if (match?.[1]) return match[1];
  const numeric = numberField(parsed, "total_cost_usd");
  if (numeric === null || numeric < 0) return null;
  return numeric.toString();
}
