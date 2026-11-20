export type DataTrust = "untrusted" | "kb";

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Quote tool payloads so prompt injection inside notes, logs, or docs
 * cannot close the envelope and impersonate a kernel instruction.
 */
export function wrapDataEnvelope(source: string, trust: DataTrust, body: unknown): string {
  const safeSource = source.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "");
  const json = JSON.stringify(body).replaceAll("<", "\\u003c");
  return `<data source="${safeSource}" trust="${trust}">${json}</data>`;
}

export function parseDataEnvelope(text: string): { source: string; trust: DataTrust; body: unknown } | undefined {
  const match = /^<data source="([^"]*)" trust="(untrusted|kb)">([\s\S]*)<\/data>$/.exec(text);
  if (!match) return undefined;
  const source = match[1] ?? "";
  const trust = match[2] === "kb" ? "kb" : "untrusted";
  const raw = match[3] ?? "";
  return { source, trust, body: JSON.parse(raw) as unknown };
}
