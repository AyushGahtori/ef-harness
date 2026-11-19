import { AmbiguousPromptJsonError, InvalidPromptJsonError } from "./errors.js";

const FENCE_PATTERN = /```([^\r\n]*)\r?\n([\s\S]*?)```/g;

function parseSingleObject(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^\uFEFF/, "");
  if (trimmed.length === 0) {
    throw new InvalidPromptJsonError("empty JSON");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new InvalidPromptJsonError("text is not one JSON object");
  }
  if (!isJsonObject(parsed)) {
    throw new InvalidPromptJsonError("expected a single JSON object");
  }
  return parsed;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Accept either one raw JSON object or one fenced ```json object.
 * Two or more fences are ambiguous and rejected. Surrounding prose is ignored
 * only when exactly one JSON fence is present.
 */
export function extractFencedJson(text: string): Record<string, unknown> {
  const matches = [...text.matchAll(FENCE_PATTERN)];
  if (matches.length > 1) {
    throw new AmbiguousPromptJsonError("multiple fenced blocks");
  }
  const match = matches[0];
  if (!match) {
    return parseSingleObject(text);
  }
  const language = (match[1] ?? "").trim().toLowerCase();
  if (language !== "" && language !== "json") {
    throw new InvalidPromptJsonError("fence is not json");
  }
  return parseSingleObject(match[2] ?? "");
}
