import type { ZodError } from "zod/v4";

export interface PacketValidationIssue {
  path: string;
  code: string;
  message: string;
}

/** Structured diagnostics for the single format-repair retry. */
export interface PacketValidationDiagnostic {
  summary: string;
  issues: PacketValidationIssue[];
}

function issuePath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return "$";
  let formatted = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      formatted += `[${segment}]`;
      continue;
    }
    const text = typeof segment === "string" ? segment : String(segment);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) {
      formatted += formatted.length === 0 ? text : `.${text}`;
    } else {
      formatted += `[${JSON.stringify(text)}]`;
    }
  }
  return formatted;
}

export function formatZodError(err: ZodError): PacketValidationDiagnostic {
  const issues = err.issues.map((issue) => {
    const path = issuePath(issue.path);
    const keys =
      "keys" in issue && Array.isArray(issue.keys) ? issue.keys.map((key) => String(key)) : [];
    const message =
      keys.length > 0 && !issue.message.includes(keys[0] ?? "")
        ? `${issue.message} (${keys.join(", ")})`
        : issue.message;
    return {
      path,
      code: issue.code,
      message,
    };
  });
  const summary = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
  return { summary, issues };
}
