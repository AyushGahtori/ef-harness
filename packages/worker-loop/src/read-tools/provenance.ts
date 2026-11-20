import type { SecretRedactorPort } from "./secret-redactor.js";

export type DataTrust = "untrusted" | "kb";

export function wrapData(options: {
  readonly source: string;
  readonly trust: DataTrust;
  readonly body: string;
  readonly redactor: SecretRedactorPort;
}): string {
  const source = sanitizeAttribute(options.redactor.redact(options.source));
  const body = escapeData(options.redactor.redact(options.body));
  return `<data source="${source}" trust="${options.trust}">\n${body}\n</data>`;
}

function sanitizeAttribute(value: string): string {
  return value.replace(/[\r\n"<>&]/g, "_");
}

export function escapeData(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
