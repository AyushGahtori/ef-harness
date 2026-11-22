import { LOCAL_RESPONSE_BYTE_CAP } from "./constants.js";
import { OpenRouterLocalError } from "./errors.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function booleanField(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

export function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

export function arrayField(record: Record<string, unknown>, key: string): readonly unknown[] | null {
  const value = record[key];
  return Array.isArray(value) ? value : null;
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new OpenRouterLocalError("bad-json", "response was not JSON");
  }
}

export async function readCappedText(response: Response, maxBytes = LOCAL_RESPONSE_BYTE_CAP): Promise<string> {
  const text = await response.text();
  if (text.length > maxBytes) {
    throw new OpenRouterLocalError("response-too-large", "response exceeded the local byte cap");
  }
  return text;
}

export async function readJsonResponse(response: Response): Promise<unknown> {
  return parseJson(await readCappedText(response));
}
