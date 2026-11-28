import type { DeterministicSupervisionPolicyEngine, PermissionApplyResult, PermissionKind, PolicyContext } from "./types.js";
import type { CopilotSdkPermissionRequest } from "./ports.js";

export function onPermissionRequest(
  engine: DeterministicSupervisionPolicyEngine,
  context: Omit<PolicyContext, "request">,
  request: CopilotSdkPermissionRequest,
): PermissionApplyResult {
  const started = performance.now();
  const normalized = normalizeSdkPermission(request);
  const decision = engine.decide({ ...context, request: normalized });
  return {
    requestId: normalized.requestId,
    effect: decision.effect,
    reason: decision.reason,
    elapsedMs: performance.now() - started,
  };
}

export function normalizeSdkPermission(request: CopilotSdkPermissionRequest): {
  readonly requestId: string;
  readonly kind: PermissionKind;
  readonly path?: string;
  readonly command?: string;
  readonly url?: string;
  readonly tool?: string;
} {
  const kind = mapKind(request.kind, request.tool);
  return {
    requestId: request.requestId ?? `perm-${kind}`,
    kind,
    ...(request.path !== undefined ? { path: request.path } : {}),
    ...(request.command !== undefined ? { command: request.command } : {}),
    ...(request.url !== undefined ? { url: request.url } : {}),
    ...(request.tool !== undefined ? { tool: request.tool } : {}),
  };
}

function mapKind(kind: string | undefined, tool: string | undefined): PermissionKind {
  const value = `${kind ?? ""} ${tool ?? ""}`.toLowerCase();
  if (/\bmcp\b|\bkb\./.test(value) || (tool ?? "").includes(".")) return "mcp";
  if (/web|fetch|search/.test(value)) return "web";
  if (/shell|bash|powershell|terminal|command/.test(value)) return "shell";
  if (/\bread\b|\bsearch\b/.test(value)) return "read";
  return "write";
}
