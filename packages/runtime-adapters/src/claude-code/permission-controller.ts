import { stringField } from "./records.js";
import { DeterministicSupervisionPolicyEngine, type PolicyContext } from "./supervision-policy.js";
import type { ClaudePermissionDecision, PermissionOutcome, SupervisionRequest } from "./types.js";

export interface PermissionPrompt {
  readonly requestId: string;
  readonly toolName: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly toolUseId?: string;
}

const FILE_TOOLS = new Set(["edit", "write", "read", "multiedit", "notebookedit"]);
const SEARCH_TOOLS = new Set(["glob", "grep"]);
const SHELL_TOOLS = new Set(["bash"]);
const WEB_TOOLS = new Set(["webfetch", "websearch"]);

/**
 * `--permission-prompt-tool stdio` decisions. Same allow/deny matrix in wrapped and stripped modes.
 * Stripped mode also passes `--disallowedTools` so the CLI does not offer native mutation tools.
 */
export class ClaudeStdioPermissionController {
  constructor(private readonly policy = new DeterministicSupervisionPolicyEngine()) {}

  decide(prompt: PermissionPrompt, context: PolicyContext): PermissionOutcome {
    const request = classifyPrompt(prompt);
    const decision = this.policy.evaluate(request, context);
    if (decision.effect === "deny") {
      return {
        decision: { behavior: "deny", message: decision.reason },
        elapsedMs: decision.elapsedMs,
        request,
      };
    }
    const updated = updatedInput(prompt, request);
    const allow: ClaudePermissionDecision = updated
      ? { behavior: "allow", updatedInput: updated }
      : { behavior: "allow" };
    return { decision: allow, elapsedMs: decision.elapsedMs, request };
  }
}

export function classifyPrompt(prompt: PermissionPrompt): SupervisionRequest {
  const inner = unwrapMcp(prompt.toolName);
  const folded = inner.toLowerCase();
  if (folded.startsWith("kb.") || folded === "harness.read_result") {
    return { kind: "mcp", tool: inner };
  }
  if (folded === "harness.run") {
    return { kind: "shell", command: stringField(prompt.input, "command") ?? "" };
  }
  if (folded === "harness.read_file") {
    return { kind: "read", path: pathOf(prompt.input) };
  }
  if (folded === "harness.write_file" || folded === "harness.edit_file") {
    return { kind: "edit", path: pathOf(prompt.input) };
  }
  if (inner !== prompt.toolName && (folded.startsWith("harness.") || folded.startsWith("kb."))) {
    return { kind: "mcp", tool: inner };
  }
  if (SHELL_TOOLS.has(folded)) {
    return { kind: "shell", command: stringField(prompt.input, "command") ?? "" };
  }
  if (WEB_TOOLS.has(folded)) {
    const url = stringField(prompt.input, "url") ?? undefined;
    return url ? { kind: "web", tool: inner, url } : { kind: "web", tool: inner };
  }
  if (SEARCH_TOOLS.has(folded)) {
    return { kind: "read", path: pathOf(prompt.input) || "." };
  }
  if (FILE_TOOLS.has(folded)) {
    const kind = folded === "read" ? "read" : folded === "write" ? "write" : "edit";
    return { kind, path: pathOf(prompt.input) };
  }
  if (folded.startsWith("mcp")) return { kind: "mcp", tool: inner };
  return { kind: "mcp", tool: inner };
}

function unwrapMcp(toolName: string): string {
  if (!toolName.startsWith("mcp__")) return toolName;
  const parts = toolName.split("__");
  return parts[parts.length - 1] ?? toolName;
}

function pathOf(input: Readonly<Record<string, unknown>>): string {
  return (
    stringField(input, "file_path") ??
    stringField(input, "path") ??
    stringField(input, "notebook_path") ??
    stringField(input, "target") ??
    ""
  );
}

function updatedInput(
  prompt: PermissionPrompt,
  request: SupervisionRequest,
): Record<string, unknown> | null {
  if (request.kind !== "edit" && request.kind !== "write" && request.kind !== "read") return null;
  if (!request.path) return null;
  if (stringField(prompt.input, "file_path") === request.path) return null;
  return { ...prompt.input, file_path: request.path };
}
