import { z } from "zod";

const SAFE_SCHEMA_NAME = /^[A-Za-z0-9@._-]{1,80}$/;

export function formatIssuePath(path: readonly (string | number)[]): string {
  if (path.length === 0) return "<root>";
  return path.map((segment) => String(segment)).join(".");
}

function constraintOf(issue: z.ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return `expected ${issue.expected}`;
    case "unrecognized_keys":
      return `unrecognized keys ${issue.keys.join(", ")}`;
    case "invalid_enum_value":
      return `allowed ${issue.options.map((option) => JSON.stringify(option)).join(" | ")}`;
    case "invalid_literal":
      return `required literal ${JSON.stringify(issue.expected)}`;
    case "too_small":
      return `minimum ${String(issue.minimum)}`;
    case "too_big":
      return `maximum ${String(issue.maximum)}`;
    case "invalid_string":
      return typeof issue.validation === "string"
        ? `string format ${issue.validation}`
        : "string format check";
    case "invalid_union":
    case "invalid_union_discriminator":
      return "matched no allowed branch";
    case "custom":
      return issue.message;
    default:
      return issue.code;
  }
}

function flattenIssues(issues: readonly z.ZodIssue[], prefix: string): string[] {
  const lines: string[] = [];
  for (const issue of issues) {
    const local = formatIssuePath(issue.path);
    const path =
      prefix.length > 0 && local !== "<root>" ? `${prefix}.${local}` : prefix || local;
    if (issue.code === "invalid_union") {
      issue.unionErrors.forEach((unionError, index) => {
        lines.push(...flattenIssues(unionError.issues, `${path}#branch${index}`));
      });
      continue;
    }
    const constraint = constraintOf(issue).replaceAll(/\s+/g, " ").slice(0, 200);
    lines.push(`- path: ${path}; code: ${issue.code}; constraint: ${constraint}`);
  }
  return lines;
}

/**
 * The single format-repair turn. Contains validator paths and constraints only.
 * Callers must not invoke a model with this message more than once.
 */
export function buildFormatRepairMessage(error: z.ZodError, schemaName = "output"): string {
  if (!SAFE_SCHEMA_NAME.test(schemaName)) {
    throw new Error("schema name is not a contract identifier");
  }
  const lines = flattenIssues(error.issues, "").sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return [
    `FORMAT_REPAIR schema=${schemaName} attempt=1 max_attempts=1`,
    "Return one JSON object that satisfies the closed schema.",
    "Do not include prose, markdown fences, or any text outside the JSON object.",
    "This is the only format-repair attempt. Do not request another repair.",
    "Validator errors:",
    ...lines,
  ].join("\n");
}
