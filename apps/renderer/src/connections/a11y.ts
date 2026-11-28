import { meetsContrast } from "./contrast.js";
import { containsForbiddenProvider } from "./catalog.js";
import { themeContrastFailures, themeFor, type ThemeTokens } from "./theme.js";

export function auditConnectionsHtml(html: string, themeName: "light" | "dark"): readonly string[] {
  const findings: string[] = [];
  const tokens = themeFor(themeName);
  for (const failure of themeContrastFailures(tokens)) findings.push(failure);
  if (!html.includes("<main")) findings.push("missing main landmark");
  if (!html.includes('type="password"')) findings.push("missing masked key field");
  if (!html.includes('autocomplete="off"')) findings.push("key field keeps autocomplete");
  if (!html.includes("tabular-nums")) findings.push("numeric columns are not tabular");
  if (containsForbiddenProvider(html)) findings.push("forbidden provider is visible");
  if (/<button\b[^>]*>\s*<\/button>/.test(html)) findings.push("empty button");
  const tags = html.split("<");
  let pairs = 0;
  for (const tag of tags) {
    const fg = /data-fg="(#[0-9A-Fa-f]{6})"/.exec(tag)?.[1];
    const bg = /data-bg="(#[0-9A-Fa-f]{6})"/.exec(tag)?.[1];
    if (!fg || !bg) continue;
    pairs += 1;
    if (!meetsContrast(fg, bg)) findings.push(`contrast ${fg} on ${bg}`);
  }
  if (pairs === 0) findings.push("missing contrast pairs");
  return findings;
}

export function themePairFailures(tokens: ThemeTokens): readonly string[] {
  return themeContrastFailures(tokens);
}
