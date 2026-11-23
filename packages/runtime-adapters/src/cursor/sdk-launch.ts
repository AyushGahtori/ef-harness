import type { CursorRuntimeDeps, CursorSdkCreateRequest, OpenCursorAgent } from "./ports.js";
import type {
  BeforeShellInput,
  CursorLocalSandboxOptions,
  CursorMcpServer,
  HookDecision,
  PreToolUseInput,
} from "./types.js";

export async function openCursorSdk(
  deps: CursorRuntimeDeps,
  input: {
    readonly apiKey: string;
    readonly modelId?: string;
    readonly worktree: string;
    readonly configDir: string;
    readonly sandboxOptions: CursorLocalSandboxOptions;
    readonly mcpServers: readonly CursorMcpServer[];
    readonly hooks: {
      readonly preToolUse: (hookInput: PreToolUseInput) => HookDecision;
      readonly beforeShellExecution: (hookInput: BeforeShellInput) => HookDecision;
    };
  },
): Promise<OpenCursorAgent> {
  const request: CursorSdkCreateRequest = {
    apiKey: input.apiKey,
    ...(input.modelId ? { modelId: input.modelId } : {}),
    local: {
      cwd: input.worktree,
      configDir: input.configDir,
      sandboxOptions: input.sandboxOptions,
      hooks: input.hooks,
      mcpServers: input.mcpServers,
    },
  };
  const handle = await deps.sdk.createLocalAgent(request);
  return {
    vendorId: handle.agentId,
    pid: handle.pid,
    childPids: handle.childPids,
    argv: ["@cursor/sdk", "local"],
    send: (prompt, signal) => handle.send(prompt, signal),
    steer: (note) => handle.steer(note),
    abort: () => handle.abort(),
    resume: (agentHandle) => handle.resume(agentHandle),
    dispose: () => handle.dispose(),
  };
}
