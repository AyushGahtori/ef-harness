export interface HttpResponseSnapshot {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly setCookies: readonly string[];
  readonly text: string;
  readonly body: unknown;
}

export async function requestJson(
  url: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<HttpResponseSnapshot> {
  const response = await fetchImpl(url, init);
  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const setCookies =
    typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  return { status: response.status, headers, setCookies, text, body };
}

export function appUrl(vars: Readonly<Record<string, string | undefined>>): string {
  const value = vars.APP_URL;
  if (!value) {
    throw new Error("env.vars().APP_URL is required");
  }
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function joinUrl(base: string, path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export interface ParsedSetCookie {
  readonly name: string;
  readonly value: string;
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: string | null;
}

export function parseSetCookie(header: string): ParsedSetCookie {
  const parts = header.split(";").map((part) => part.trim());
  const first = parts[0] ?? "";
  const eq = first.indexOf("=");
  const name = eq >= 0 ? first.slice(0, eq).trim() : first;
  const value = eq >= 0 ? first.slice(eq + 1).trim() : "";
  let httpOnly = false;
  let secure = false;
  let sameSite: string | null = null;
  for (const part of parts.slice(1)) {
    const splitAt = part.indexOf("=");
    const key = (splitAt >= 0 ? part.slice(0, splitAt) : part).trim().toLowerCase();
    const raw = splitAt >= 0 ? part.slice(splitAt + 1).trim() : "";
    if (key === "httponly") httpOnly = true;
    if (key === "secure") secure = true;
    if (key === "samesite") sameSite = raw;
  }
  return { name, value, httpOnly, secure, sameSite };
}

export function appropriateSessionSameSite(cookie: ParsedSetCookie): boolean {
  if (!cookie.sameSite) return false;
  const value = cookie.sameSite.toLowerCase();
  if (value === "lax" || value === "strict") return true;
  return value === "none" && cookie.secure;
}

export function headerIncludes(
  headers: Readonly<Record<string, string>>,
  name: string,
  expected: string,
): boolean {
  const actual = headers[name.toLowerCase()];
  if (actual === undefined) return false;
  return actual.toLowerCase().includes(expected.toLowerCase());
}
