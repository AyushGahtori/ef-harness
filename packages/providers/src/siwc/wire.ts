import { SIWC_BANNED_TOOL_TYPES, SIWC_FORBIDDEN_WIRE_FIELDS } from "./constants.js";

const CLIENT_ONLY_FIELDS = new Set(["connectionId", "safety", "extAgentHostId", "accessToken"]);
const BANNED_TOOLS = new Set<string>(SIWC_BANNED_TOOL_TYPES);

/**
 * Build the Responses body for ChatGPT direct preview.
 * store is always false, stream is always true, and unsupported fields are removed.
 */
export function buildSiwcWireBody(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (CLIENT_ONLY_FIELDS.has(key)) continue;
    if ((SIWC_FORBIDDEN_WIRE_FIELDS as readonly string[]).includes(key)) continue;
    body[key] = value;
  }
  const normalized = normalizeInput(body["input"], body["instructions"]);
  body["input"] = normalized.input;
  if (normalized.instructions !== undefined) body["instructions"] = normalized.instructions;
  else delete body["instructions"];
  if ("tools" in body) {
    const tools = filterTools(body["tools"]);
    if (tools.length === 0) delete body["tools"];
    else body["tools"] = tools;
  }
  body["store"] = false;
  body["stream"] = true;
  return body;
}

function normalizeInput(input: unknown, instructions: unknown): { input: unknown; instructions?: string } {
  const base = typeof instructions === "string" ? instructions : "";
  if (!Array.isArray(input)) {
    return base ? { input, instructions: base } : { input };
  }
  const kept: unknown[] = [];
  const systemTexts: string[] = [];
  for (const item of input) {
    if (isSystemItem(item)) systemTexts.push(textOf(item));
    else kept.push(item);
  }
  const merged = [base, ...systemTexts].map((part) => part.trim()).filter((part) => part.length > 0).join("\n");
  return merged ? { input: kept, instructions: merged } : { input: kept };
}

function isSystemItem(item: unknown): boolean {
  if (typeof item !== "object" || item === null) return false;
  const record = item as Record<string, unknown>;
  return record["role"] === "system";
}

function textOf(item: unknown): string {
  if (typeof item !== "object" || item === null) return "";
  const record = item as Record<string, unknown>;
  if (typeof record["content"] === "string") return record["content"];
  if (Array.isArray(record["content"])) {
    return record["content"]
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
        return "";
      })
      .filter((part) => part.length > 0)
      .join("");
  }
  return "";
}

function filterTools(tools: unknown): unknown[] {
  if (!Array.isArray(tools)) return [];
  return tools.filter((tool) => {
    if (typeof tool !== "object" || tool === null) return true;
    const type = (tool as { type?: unknown }).type;
    return typeof type !== "string" || !BANNED_TOOLS.has(type);
  });
}
