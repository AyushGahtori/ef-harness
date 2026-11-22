const SECRET_HEADER =
  /(authorization|x-api-key|x-goog-api-key)\s*[:=]\s*[^\r\n]*/gi;

const KEY_QUERY = /([?&#])key=[^&#\s]*/gi;

export function stripKeyQueryFromUrl(url: string): string {
  return url.replace(KEY_QUERY, "$1key=[REDACTED]");
}

export function sanitizeLogText(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    if (!out.includes(secret)) continue;
    out = out.split(secret).join("[REDACTED]");
  }
  out = out.replace(SECRET_HEADER, "$1: [REDACTED]");
  out = stripKeyQueryFromUrl(out);
  return out;
}

export function assertHeaderOnlyKeyTransport(url: string, apiKey: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Model-list URL is not absolute");
  }
  if (parsed.searchParams.has("key") || parsed.searchParams.has("api_key")) {
    throw new Error("API keys must not be placed in URL query strings");
  }
  if (apiKey.length > 0 && (url.includes(apiKey) || parsed.username.length > 0 || parsed.password.length > 0)) {
    throw new Error("API keys must not appear in request URLs");
  }
}
