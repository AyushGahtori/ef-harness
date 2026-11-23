/**
 * OpenCode permission dialect (`permission-object`).
 * A string rule matches every resource.
 * A pattern map is ordered: the last matching glob wins.
 * Unmatched actions stay `ask`.
 */
export type PermissionEffect = "allow" | "deny" | "ask";

const EFFECTS = new Set<PermissionEffect>(["allow", "deny", "ask"]);

function asEffect(value: unknown): PermissionEffect | null {
  return typeof value === "string" && EFFECTS.has(value as PermissionEffect)
    ? (value as PermissionEffect)
    : null;
}

function globMatch(pattern: string, value: string): boolean {
  let expression = "^";
  let index = 0;
  while (index < pattern.length) {
    if (pattern.startsWith("**/", index)) {
      expression += "(?:.*/)?";
      index += 3;
      continue;
    }
    if (pattern.startsWith("**", index)) {
      expression += ".*";
      index += 2;
      continue;
    }
    const char = pattern[index] ?? "";
    if (char === "*") {
      expression += "[^/]*";
      index += 1;
      continue;
    }
    if ("\\^$+?.()|{}[]".includes(char)) {
      expression += `\\${char}`;
    } else {
      expression += char;
    }
    index += 1;
  }
  expression += "$";
  return new RegExp(expression, "i").test(value);
}

export function evaluatePermission(permission: unknown, action: string, resource: string): PermissionEffect {
  if (!permission || typeof permission !== "object" || Array.isArray(permission)) return "ask";
  const rules = (permission as Record<string, unknown>)[action];
  const direct = asEffect(rules);
  if (direct) return direct;
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return "ask";
  const normalized = resource.replaceAll("\\", "/");
  let decision: PermissionEffect = "ask";
  let matched = false;
  for (const [pattern, effect] of Object.entries(rules)) {
    const parsed = asEffect(effect);
    if (!parsed) continue;
    if (globMatch(pattern, normalized) || globMatch(pattern, resource)) {
      decision = parsed;
      matched = true;
    }
  }
  return matched ? decision : "ask";
}
