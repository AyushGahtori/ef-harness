export type OpenCodeEffect = "allow" | "deny" | "ask";

export type OpenCodeRule = string | Readonly<Record<string, string>>;

export interface OpenCodePermissionConfig {
  readonly permission: Readonly<Record<string, OpenCodeRule>>;
}

/**
 * Ordered OpenCode permission rules. A string rule matches every resource.
 * Object rules are globs; the last match wins. Unmatched actions stay `ask`.
 */
export function decideOpenCodePermission(
  config: OpenCodePermissionConfig,
  action: string,
  resource: string,
): OpenCodeEffect {
  const rules = config.permission[action];
  if (typeof rules === "string") {
    return asEffect(rules);
  }
  if (!rules) return "ask";
  const normalized = resource.replaceAll("\\", "/");
  let decision: OpenCodeEffect = "ask";
  let matched = false;
  for (const [pattern, effect] of Object.entries(rules)) {
    if (globMatch(pattern, normalized) || globMatch(pattern, resource)) {
      decision = asEffect(effect);
      matched = true;
    }
  }
  return matched ? decision : "ask";
}

export const OPENCODE_DENY_SHELL_WEB: OpenCodePermissionConfig = {
  permission: {
    bash: { "*": "deny" },
    webfetch: "deny",
    websearch: "deny",
    external_directory: "deny",
  },
};

export const OPENCODE_PERMISSION_KEYS = [
  "bash",
  "read",
  "edit",
  "webfetch",
  "websearch",
  "external_directory",
  "glob",
  "grep",
  "list",
] as const;

function asEffect(value: string): OpenCodeEffect {
  if (value === "allow" || value === "deny" || value === "ask") return value;
  return "ask";
}

function globMatch(pattern: string, value: string): boolean {
  const doubled = "\u0000";
  const source = pattern
    .replaceAll("**", doubled)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll(doubled, "\u0001")
    .replaceAll("*", ".*")
    .replaceAll("\u0001", ".*");
  return new RegExp(`^${source}$`, "i").test(value);
}
