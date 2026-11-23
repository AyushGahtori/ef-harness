import path from "node:path";
import { isUserGeminiPath } from "./home-guard.js";
import type { HarnessRunCall, PermissionDecision, PermissionOutcome } from "./ports.js";
import type { LocalHarnessRunRecorder } from "./ports.js";

export interface SupervisionRequest {
  readonly requestId: string;
  readonly kind: string;
  readonly title: string;
  readonly command: string | null;
  readonly filePath: string | null;
}

export interface SupervisionContext {
  readonly mode: "wrapped" | "stripped";
  readonly worktree: string;
  readonly writeScope: readonly string[];
}

const SHELL_KINDS = new Set(["execute", "shell", "terminal", "bash"]);
const WEB_KINDS = new Set(["web", "webfetch", "websearch", "fetch", "web_fetch", "web_search"]);
const WRITE_KINDS = new Set(["write", "edit", "fs/write_text_file", "delete"]);
const READ_KINDS = new Set(["read", "fs/read_text_file"]);

const DENY_COMMAND =
  /\bgit\s+push\b|\bcurl\b|\bwget\b|\binvoke-webrequest\b|\bpnpm\s+add\b|\bnpm\s+install\b|\bsudo\b|\brunas\b/i;

function posixRelative(worktree: string, filePath: string): string | null {
  const root = path.resolve(worktree);
  const abs = path.resolve(worktree, filePath);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.replaceAll("\\", "/");
}

function matchesScope(relPosix: string, scope: readonly string[]): boolean {
  for (const pattern of scope) {
    const norm = pattern.replaceAll("\\", "/");
    if (norm.endsWith("/**")) {
      const prefix = norm.slice(0, -3);
      if (relPosix === prefix || relPosix.startsWith(`${prefix}/`)) return true;
      continue;
    }
    if (relPosix === norm) return true;
  }
  return false;
}

function decision(
  requestId: string,
  outcome: PermissionOutcome,
  reason: string,
  harnessRun: HarnessRunCall | null,
): PermissionDecision {
  return { requestId, outcome, reason, harnessRun };
}

/**
 * Local port of Task 142 DeterministicSupervisionPolicyEngine.
 * Decisions are synchronous and do not call a model.
 */
export class LocalSupervisionPolicyEngine {
  constructor(private readonly harnessRun: LocalHarnessRunRecorder) {}

  decide(request: SupervisionRequest, context: SupervisionContext): PermissionDecision {
    const kind = request.kind.toLowerCase();
    const command = request.command ?? "";
    const filePath = request.filePath;
    if (filePath && (isUserGeminiPath(filePath) || /[/\\]\.ssh[/\\]|id_rsa/i.test(filePath))) {
      return decision(request.requestId, "reject_once", "secret_path_denied", null);
    }
    if (DENY_COMMAND.test(command)) {
      return decision(request.requestId, "reject_once", "command_denied", null);
    }
    if (WEB_KINDS.has(kind)) {
      return decision(request.requestId, "reject_once", "unproxied_web_denied", null);
    }
    if (SHELL_KINDS.has(kind) && context.mode === "stripped") {
      const call = { command: command || request.title, cwd: context.worktree };
      this.harnessRun.record(call.command, call.cwd);
      return decision(request.requestId, "reject_once", "stripped_mode_routes_shell_through_harness_run", call);
    }
    if (WRITE_KINDS.has(kind)) {
      if (!filePath) return decision(request.requestId, "reject_once", "write_path_missing", null);
      const rel = posixRelative(context.worktree, filePath);
      if (!rel || rel.split("/").includes(".git")) {
        return decision(request.requestId, "reject_once", "write_escapes_worktree", null);
      }
      if (!matchesScope(rel, context.writeScope)) {
        return decision(request.requestId, "reject_once", "write_outside_scope", null);
      }
      return decision(request.requestId, "allow_once", "write_in_scope", null);
    }
    if (READ_KINDS.has(kind)) {
      if (!filePath) return decision(request.requestId, "reject_once", "read_path_missing", null);
      const rel = posixRelative(context.worktree, filePath);
      if (!rel) return decision(request.requestId, "reject_once", "read_escapes_worktree", null);
      return decision(request.requestId, "allow_once", "read_in_worktree", null);
    }
    if (SHELL_KINDS.has(kind)) {
      return decision(request.requestId, "allow_once", "wrapped_shell_inside_sandbox", null);
    }
    return decision(request.requestId, "reject_once", "unknown_tool_denied", null);
  }
}

export function parseSupervisionRequest(params: unknown, requestId: string): SupervisionRequest {
  const root = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
  const tool = root.toolCall && typeof root.toolCall === "object" ? (root.toolCall as Record<string, unknown>) : root;
  const raw = tool.rawInput && typeof tool.rawInput === "object" ? (tool.rawInput as Record<string, unknown>) : {};
  const kind = typeof tool.kind === "string" ? tool.kind : typeof tool.title === "string" ? tool.title : "other";
  const title = typeof tool.title === "string" ? tool.title : kind;
  const command =
    typeof raw.command === "string" ? raw.command : typeof tool.command === "string" ? tool.command : null;
  const filePath =
    typeof raw.path === "string" ? raw.path : typeof tool.path === "string" ? tool.path : null;
  return { requestId, kind, title, command, filePath };
}
