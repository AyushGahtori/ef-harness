export const MODEL_LIST_ENDPOINTS = {
  openai: "https://api.openai.com/v1/models",
  anthropic: "https://api.anthropic.com/v1/models",
  openrouter: "https://openrouter.ai/api/v1/models",
  gemini: "https://generativelanguage.googleapis.com/v1beta/models",
} as const;

export const MODEL_LIST_TIMEOUT_MS = 10_000;

const INSECURE_URL_MESSAGE =
  "Custom endpoints must use HTTPS. HTTP is allowed only for loopback 127.0.0.1 and ::1.";

export type UrlCheck = { readonly ok: true; readonly base: URL } | { readonly ok: false; readonly message: string };

export function checkCustomBaseUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, message: "Enter a valid custom base URL." };
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return { ok: false, message: "Custom base URLs cannot embed usernames, passwords, or keys." };
  }
  if (url.searchParams.has("key") || url.searchParams.has("api_key")) {
    return { ok: false, message: "Custom base URLs cannot carry a key query parameter." };
  }
  const host = url.hostname.toLowerCase();
  const loopback = host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (url.protocol === "https:") return { ok: true, base: url };
  if (url.protocol === "http:" && loopback) return { ok: true, base: url };
  if (url.protocol === "http:") return { ok: false, message: INSECURE_URL_MESSAGE };
  return { ok: false, message: INSECURE_URL_MESSAGE };
}

export function customModelListUrl(base: URL): string {
  const next = new URL(base.toString());
  const path = next.pathname.replace(/\/+$/, "");
  next.pathname = `${path}/models`;
  next.search = "";
  next.hash = "";
  next.username = "";
  next.password = "";
  return next.toString();
}

export function isModelListPath(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, "");
    return pathname.endsWith("/models");
  } catch {
    return false;
  }
}
